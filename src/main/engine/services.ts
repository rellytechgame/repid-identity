import { readFile } from 'node:fs/promises'
import type { ServiceRef, ServiceStopResult } from '../../shared/types'
import { run } from './exec'

const SERVICE_NAME = /^[A-Za-z0-9_.@:\-]{1,256}$/
const CACHE_MS = 20000

let cache: { at: number; map: Map<number, ServiceRef[]> } | null = null
let pending: Promise<Map<number, ServiceRef[]>> | null = null

/**
 * pid → services hosted by that process. Ending a service's process is futile
 * when the service manager restarts it, so the UI offers "Stop service" instead.
 * Cached because the underlying commands take 100–500 ms.
 */
export async function getServiceMap(pids: number[]): Promise<Map<number, ServiceRef[]>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.map
  pending ??= load(pids)
    .catch(() => new Map<number, ServiceRef[]>())
    .then((map) => {
      cache = { at: Date.now(), map }
      pending = null
      return map
    })
  return pending
}

function add(map: Map<number, ServiceRef[]>, pid: number, ref: ServiceRef): void {
  if (!SERVICE_NAME.test(ref.name)) return
  const list = map.get(pid)
  if (list) list.push(ref)
  else map.set(pid, [ref])
}

async function load(pids: number[]): Promise<Map<number, ServiceRef[]>> {
  const map = new Map<number, ServiceRef[]>()
  if (process.platform === 'win32') {
    // CSV output: "svchost.exe","1234","Dnscache,LanmanWorkstation". Localized "N/A" values fail the name regex.
    const res = await run('tasklist.exe', ['/svc', '/fo', 'csv', '/nh'])
    for (const line of res.stdout.split(/\r?\n/)) {
      const cells = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1])
      const pid = Number(cells[1])
      if (!Number.isInteger(pid) || !cells[2]) continue
      for (const name of cells[2].split(',')) add(map, pid, { name: name.trim(), manager: 'windows-scm' })
    }
  } else if (process.platform === 'linux') {
    await Promise.all(
      pids.map(async (pid) => {
        try {
          const cgroup = await readFile(`/proc/${pid}/cgroup`, 'utf8')
          const path = cgroup.trim().split('\n').pop()?.split(':').pop() ?? ''
          const unit = path.split('/').pop() ?? ''
          if (unit.endsWith('.service') && !/^user@\d+\.service$/.test(unit)) {
            add(map, pid, { name: unit, manager: 'systemd', scope: path.includes('/user@') ? 'user' : 'system' })
          }
        } catch {
          // process exited or /proc entry not readable — not a service we can manage
        }
      })
    )
  } else if (process.platform === 'darwin') {
    const res = await run('launchctl', ['list'])
    for (const line of res.stdout.split('\n').slice(1)) {
      const [pidText, , label] = line.split('\t')
      const pid = Number(pidText)
      // "application.*" labels are ordinary GUI app instances, not services.
      if (Number.isInteger(pid) && label && !label.startsWith('application.')) add(map, pid, { name: label, manager: 'launchd' })
    }
  }
  return map
}

export function invalidateServices(): void {
  cache = null
}

// sc.exe reports Win32 error 5 (localized text varies, the code does not).
const DENIED = /access is denied|acceso denegado|(failed|error) 5:|interactive authentication|permission denied|not permitted|access denied|operation not permitted/i

/** Stops the service hosted by `pid`. The name comes from our own lookup, never from the UI. */
export async function stopServiceOf(pid: number, pids: number[]): Promise<ServiceStopResult> {
  const services = (await getServiceMap(pids)).get(pid) ?? []
  if (services.length !== 1) {
    return {
      service: services.map((s) => s.name).join(', '),
      ok: false,
      needsElevation: false,
      error: services.length === 0 ? 'not-a-service' : 'shared-host'
    }
  }
  const svc = services[0]
  let res
  if (svc.manager === 'windows-scm') {
    res = await run('sc.exe', ['stop', svc.name])
  } else if (svc.manager === 'systemd') {
    const scope = svc.scope === 'user' ? ['--user'] : []
    res = await run('systemctl', [...scope, '--no-ask-password', 'stop', svc.name])
    // System units need root: polkit's pkexec shows the desktop's own password dialog.
    if (!res.ok && svc.scope !== 'user' && DENIED.test(res.stderr + res.stdout)) {
      res = await run('pkexec', ['systemctl', 'stop', svc.name], { timeoutMs: 120000 })
    }
  } else {
    res = await run('launchctl', ['stop', svc.name])
  }
  invalidateServices()
  const output = `${res.stdout}\n${res.stderr}`
  return {
    service: svc.name,
    ok: res.ok,
    needsElevation: !res.ok && DENIED.test(output),
    error: res.ok ? undefined : output.trim().split('\n').slice(-2).join(' ').slice(0, 300)
  }
}
