import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RawStartup, StartupAdapter, ToggleResult } from './types'

/**
 * XDG autostart (freedesktop spec). A file in ~/.config/autostart overrides
 * the system one with the same name, so disabling a system entry writes a
 * user copy with `Hidden=true` (marked X-RePID-Override) and enabling removes
 * that copy again. System files under /etc are never modified.
 */

const FILE = /^[\w.\-@+]+\.desktop$/

function userDir(env = process.env): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autostart')
}

function systemDirs(env = process.env): string[] {
  return (env.XDG_CONFIG_DIRS || '/etc/xdg').split(':').filter(Boolean).map((d) => join(d, 'autostart'))
}

/** Keys of the [Desktop Entry] group (non-localized). */
export function parseDesktopEntry(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  let inMain = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inMain = line === '[Desktop Entry]'
      continue
    }
    if (!inMain || !line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return out
}

export function desktopEnabled(fields: Record<string, string>): boolean {
  return fields.Hidden?.toLowerCase() !== 'true' && fields['X-GNOME-Autostart-enabled']?.toLowerCase() !== 'false'
}

/** Sets (or adds) `key=value` inside the [Desktop Entry] group, leaving everything else intact. */
export function withDesktopKey(text: string, key: string, value: string): string {
  const lines = text.split(/\r?\n/)
  let start = lines.findIndex((l) => l.trim() === '[Desktop Entry]')
  if (start < 0) {
    lines.unshift('[Desktop Entry]')
    start = 0
  }
  let end = lines.findIndex((l, i) => i > start && l.trim().startsWith('['))
  if (end < 0) end = lines.length
  for (let i = start + 1; i < end; i++) {
    if (lines[i].trim().startsWith(`${key}=`)) {
      lines[i] = `${key}=${value}`
      return lines.join('\n')
    }
  }
  // Insert after the last non-empty line of the group so trailing blank lines stay put.
  let at = end
  while (at > start + 1 && !lines[at - 1].trim()) at--
  lines.splice(at, 0, `${key}=${value}`)
  return lines.join('\n')
}

/** Removes %f %U … field codes from Exec=. */
export function stripFieldCodes(exec: string): string {
  return exec.replace(/\s+%[fFuUdDnNickvm]/g, '').trim()
}

function visibleOn(fields: Record<string, string>, env = process.env): boolean {
  const desktops = (env.XDG_CURRENT_DESKTOP || '').toLowerCase().split(':').filter(Boolean)
  if (!desktops.length) return true
  const list = (k: string) => (fields[k] || '').toLowerCase().split(';').filter(Boolean)
  const only = list('OnlyShowIn')
  if (only.length && !only.some((d) => desktops.includes(d))) return false
  return !list('NotShowIn').some((d) => desktops.includes(d))
}

async function readDir(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const names = await readdir(dir).catch(() => [] as string[])
  for (const name of names) {
    if (!FILE.test(name)) continue
    const text = await readFile(join(dir, name), 'utf8').catch(() => null)
    if (text !== null) out.set(name, text)
  }
  return out
}

export const linuxAdapter: StartupAdapter = {
  async list(): Promise<RawStartup[]> {
    const user = await readDir(userDir())
    const system = new Map<string, string>()
    // Earlier XDG_CONFIG_DIRS entries take precedence.
    for (const dir of systemDirs()) for (const [n, t] of await readDir(dir)) if (!system.has(n)) system.set(n, t)

    const out: RawStartup[] = []
    for (const name of new Set([...system.keys(), ...user.keys()])) {
      const text = user.get(name) ?? system.get(name)!
      const fields = parseDesktopEntry(text)
      if ((fields.Type && fields.Type !== 'Application') || !visibleOn(fields)) continue
      const command = stripFieldCodes(fields.Exec || fields.TryExec || '')
      if (!command) continue
      out.push({
        id: `xdg:${name}`,
        source: system.has(name) ? 'xdg-system' : 'xdg-user',
        label: name,
        command,
        declaredName: fields.Name,
        enabled: desktopEnabled(fields),
        data: { file: name }
      })
    }
    return out
  },

  async setEnabled(entry, enabled): Promise<ToggleResult> {
    const name = entry.data?.file ?? ''
    if (!FILE.test(name)) return { ok: false, error: 'failed', message: 'invalid file' }
    const dir = userDir()
    const userPath = join(dir, name)
    try {
      const userText = await readFile(userPath, 'utf8').catch(() => null)
      if (enabled) {
        if (userText === null) return { ok: true }
        if (parseDesktopEntry(userText)['X-RePID-Override'] === 'true') {
          await unlink(userPath)
          return { ok: true }
        }
        let next = withDesktopKey(userText, 'Hidden', 'false')
        if (parseDesktopEntry(next)['X-GNOME-Autostart-enabled']) next = withDesktopKey(next, 'X-GNOME-Autostart-enabled', 'true')
        await writeFile(userPath, next, 'utf8')
        return { ok: true }
      }
      let base = userText
      if (base === null) {
        for (const d of systemDirs()) {
          base = await readFile(join(d, name), 'utf8').catch(() => null)
          if (base !== null) break
        }
        if (base === null) return { ok: false, error: 'failed', message: 'not found' }
        base = withDesktopKey(base, 'X-RePID-Override', 'true')
      }
      await mkdir(dir, { recursive: true })
      await writeFile(userPath, withDesktopKey(base, 'Hidden', 'true'), 'utf8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: 'failed', message: err instanceof Error ? err.message : String(err) }
    }
  }
}
