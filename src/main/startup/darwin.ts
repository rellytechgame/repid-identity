import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { run } from '../engine/exec'
import type { JournalEntry, RawStartup, StartupAdapter, ToggleResult } from './types'

/**
 * macOS: LaunchAgents are disabled with `launchctl disable gui/<uid>/<label>`
 * (a per-user override launchd keeps until `enable`; the plist is untouched).
 * Legacy login items have no disabled state, so RePID removes them and keeps
 * their path in its journal to add them back on enable/restore.
 */

const LABEL = /^[\w.\-]+$/

function uid(): number {
  return typeof process.getuid === 'function' ? process.getuid() : 501
}

/** `launchctl print-disabled` lines: `"com.foo.agent" => disabled` (or `=> true` on older macOS). */
export function parseDisabled(output: string): Map<string, boolean> {
  const out = new Map<string, boolean>()
  for (const m of output.matchAll(/"([^"]+)"\s*=>\s*(disabled|enabled|true|false)/g)) out.set(m[1], m[2] === 'disabled' || m[2] === 'true')
  return out
}

interface LaunchPlist {
  Label?: string
  Program?: string
  ProgramArguments?: string[]
  RunAtLoad?: boolean
  KeepAlive?: unknown
  Disabled?: boolean
}

async function agents(dir: string, disabled: Map<string, boolean>, source: 'user' | 'machine'): Promise<RawStartup[]> {
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.plist'))
  const out: RawStartup[] = []
  for (const file of files) {
    const res = await run('plutil', ['-convert', 'json', '-o', '-', join(dir, file)], { timeoutMs: 5000 })
    if (!res.ok) continue
    let plist: LaunchPlist
    try {
      plist = JSON.parse(res.stdout) as LaunchPlist
    } catch {
      continue
    }
    const label = plist.Label
    if (!label || !LABEL.test(label) || !(plist.RunAtLoad || plist.KeepAlive)) continue
    const args = plist.ProgramArguments ?? (plist.Program ? [plist.Program] : [])
    const exe = plist.Program ?? args[0]
    if (!exe) continue
    const override = disabled.get(label)
    out.push({
      id: `launch-agent:${label}`,
      source: 'launch-agent',
      label,
      command: args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '),
      exe,
      enabled: override === undefined ? plist.Disabled !== true : !override,
      data: { scope: source }
    })
  }
  return out
}

/** JXA reads values from the environment so names and paths are never spliced into script source. */
const JXA_LIST = 'JSON.stringify(Application("System Events").loginItems().map(function (i) { return { name: i.name(), path: i.path(), hidden: i.hidden() } }))'
const JXA_ENV = 'ObjC.import("Foundation"); var env = $.NSProcessInfo.processInfo.environment; function v(k) { return ObjC.unwrap(env.objectForKey(k)) }; var se = Application("System Events");'
const JXA_DELETE = `${JXA_ENV} se.loginItems.byName(v("REPID_NAME")).delete(); "ok"`
const JXA_ADD = `${JXA_ENV} se.make({ new: "loginItem", at: se.loginItems.end, withProperties: { path: v("REPID_PATH"), hidden: v("REPID_HIDDEN") === "true" } }); "ok"`

function jxa(script: string, env?: Record<string, string>) {
  return run('osascript', ['-l', 'JavaScript', '-e', script], { timeoutMs: 15000, env: env ? { ...process.env, ...env } : undefined })
}

export const darwinAdapter: StartupAdapter = {
  async list(journal: JournalEntry[]): Promise<RawStartup[]> {
    const disabled = parseDisabled((await run('launchctl', ['print-disabled', `gui/${uid()}`], { timeoutMs: 5000 })).stdout)
    const out = [
      ...(await agents(join(homedir(), 'Library', 'LaunchAgents'), disabled, 'user')),
      ...(await agents('/Library/LaunchAgents', disabled, 'machine'))
    ]
    // Needs the Automation permission for System Events; without it, login items are simply not listed.
    const res = await jxa(JXA_LIST)
    const items = res.ok ? (JSON.parse(res.stdout || '[]') as Array<{ name: string; path: string; hidden: boolean }>) : []
    for (const item of items) {
      if (!item?.name || !item.path) continue
      out.push({ id: `login-item:${item.name}`, source: 'login-item', label: item.name, command: item.path, exe: item.path, declaredName: item.name, enabled: true, data: { path: item.path, hidden: String(item.hidden) } })
    }
    for (const j of journal) {
      if (!j.id.startsWith('login-item:') || out.some((o) => o.id === j.id) || !j.data?.path) continue
      out.push({ id: j.id, source: 'login-item', label: j.name, command: j.data.path, exe: j.data.path, declaredName: j.name, enabled: false, data: j.data })
    }
    return out
  },

  async setEnabled(entry, enabled): Promise<ToggleResult> {
    if (entry.source === 'launch-agent') {
      if (!LABEL.test(entry.label)) return { ok: false, error: 'failed', message: 'invalid label' }
      const res = await run('launchctl', [enabled ? 'enable' : 'disable', `gui/${uid()}/${entry.label}`], { timeoutMs: 5000 })
      return res.ok ? { ok: true } : { ok: false, error: 'failed', message: res.stderr.trim() }
    }
    if (entry.source === 'login-item') {
      const res = enabled
        ? await jxa(JXA_ADD, { REPID_PATH: entry.data?.path ?? '', REPID_HIDDEN: entry.data?.hidden ?? 'false' })
        : await jxa(JXA_DELETE, { REPID_NAME: entry.label })
      return res.ok ? { ok: true } : { ok: false, error: /-1743|not allowed/i.test(res.stderr) ? 'needs-admin' : 'failed', message: res.stderr.trim() }
    }
    return { ok: false, error: 'failed', message: 'unsupported source' }
  }
}
