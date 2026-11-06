import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MIN_TOP_LEVEL, classifyApp, normalize, productKeys } from '../../shared/engine/uninstall'
import { run } from '../engine/exec'
import { isDirectory, sizeOf } from './fsutil'
import type { LeftoverRecord, PlatformUninstaller } from './types'

/**
 * Linux: Flatpak apps (the only format with a per-app sandbox that can be
 * removed without root and whose data location is known: ~/.var/app/<id>).
 * Distribution packages are left to the system package manager.
 */
const APP_ID = /^[A-Za-z][\w-]*(\.[\w-]+)+$/

/** `flatpak list --app --columns=application,name,version,installation` output. */
export function parseFlatpakList(output: string): Array<{ id: string; name: string; version?: string; installation: 'user' | 'system' }> {
  return output
    .split(/\r?\n/)
    .map((l) => l.split('\t'))
    .filter((c) => c.length >= 4 && APP_ID.test(c[0].trim()))
    .map((c) => ({ id: c[0].trim(), name: c[1].trim() || c[0].trim(), version: c[2].trim() || undefined, installation: c[3].trim() === 'user' ? 'user' : 'system' }))
}

let seq = 0
const nextId = () => `x${Date.now().toString(36)}${(seq++).toString(36)}`

export const linuxUninstaller: PlatformUninstaller = {
  async inventory() {
    const res = await run('flatpak', ['list', '--app', '--columns=application,name,version,installation'], { timeoutMs: 20000 })
    if (!res.ok) return []
    return parseFlatpakList(res.stdout).map((f) => {
      const { kind, risk } = classifyApp(f.name)
      return {
        app: {
          id: `flatpak:${f.installation}:${f.id}`,
          name: f.name,
          version: f.version,
          installLocation: join(homedir(), '.var', 'app', f.id),
          source: 'flatpak' as const,
          scope: f.installation === 'user' ? ('user' as const) : ('machine' as const),
          kind,
          risk,
          hasQuiet: true,
          uninstallerMissing: false,
          requiresAdmin: false,
          runningPids: []
        },
        products: productKeys({ name: f.name }),
        vendors: [],
        data: { appId: f.id, installation: f.installation }
      }
    })
  },

  async run(record) {
    const { appId, installation } = record.data
    if (!APP_ID.test(appId)) return { status: 'failed', error: 'invalid app id' }
    // System installations prompt through polkit by themselves.
    const res = await run('flatpak', ['uninstall', '-y', '--noninteractive', installation === 'user' ? '--user' : '--system', appId], { timeoutMs: 10 * 60 * 1000 })
    return res.ok ? { status: 'done' } : { status: /not allowed|authoriz/i.test(res.stderr) ? 'needs-admin' : 'failed', error: res.stderr.trim() }
  },

  async leftovers(record, others) {
    const out: LeftoverRecord[] = []
    const claimed = new Set(others.flatMap((o) => o.products.primary))
    const want = new Set(record.products.primary.filter((p) => p.length >= MIN_TOP_LEVEL && !claimed.has(p)))
    const sandbox = join(homedir(), '.var', 'app', record.data.appId)
    if (APP_ID.test(record.data.appId) && (await isDirectory(sandbox))) {
      out.push({ id: nextId(), kind: 'folder', location: sandbox, sizeBytes: await sizeOf(sandbox), confidence: 'high', reason: 'bundle-id', target: { type: 'path', path: sandbox } })
    }
    for (const base of [join(homedir(), '.config'), join(homedir(), '.local', 'share'), join(homedir(), '.cache')]) {
      for (const entry of await readdir(base).catch(() => [] as string[])) {
        if (!want.has(normalize(entry))) continue
        const path = join(base, entry)
        if (await isDirectory(path)) out.push({ id: nextId(), kind: 'folder', location: path, sizeBytes: await sizeOf(path), confidence: 'medium', reason: 'name-match', target: { type: 'path', path } })
      }
    }
    return out
  }
}
