import { join, win32 } from 'node:path'
import { parseCommand } from '../../shared/engine/startup'
import { isOwnedName, isProtectedDirName, normalize, orphanVerdict, ownedNameSet } from '../../shared/engine/uninstall'
import { isInside } from '../cleaner/fsops'
import { powershell } from '../engine/exec'
import { windowsAdapter } from '../startup/windows'
import { childDirs, exists, inspectFolder } from './fsutil'
import type { AppRecord, LeftoverRecord } from './types'
import { REG_PARENTS_USER, UNINSTALL_KEYS, isOfferablePath, regSubkeys, resolveShortcuts, shortcutsUnder } from './windows'

const env = (n: string) => process.env[n] ?? ''
const ABSOLUTE = /^[a-z]:\\/i

let seq = 0
const nextId = () => `o${Date.now().toString(36)}${(seq++).toString(36)}`

/** Executables of every service and driver (Program Files\Realtek, \Intel… have no "installed app" entry). */
async function servicePaths(): Promise<string[]> {
  const res = await powershell(
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8; $p = @(Get-CimInstance Win32_Service | ForEach-Object { $_.PathName }) + @(Get-CimInstance Win32_SystemDriver | ForEach-Object { $_.PathName }); ConvertTo-Json -InputObject @($p | Where-Object { $_ }) -Compress",
    undefined,
    60000
  )
  try {
    const sysRoot = env('SystemRoot') || 'C:\\Windows'
    return (JSON.parse(res.stdout || '[]') as string[])
      .map((s) => parseCommand(s).exe.replace(/^\\\?\?\\/, '').replace(/^\\SystemRoot\\/i, sysRoot + '\\').replace(/^system32\\/i, sysRoot + '\\System32\\'))
      .filter((p) => ABSOLUTE.test(p))
  } catch {
    return []
  }
}

/** Is the drive of this path present? A target on an unplugged USB disk is not "broken". */
async function driveExists(p: string): Promise<boolean> {
  return ABSOLUTE.test(p) && exists(p.slice(0, 3))
}

/**
 * Leftovers of apps that are no longer installed. Evidence of use (any of
 * these keeps a folder out of the list): an installed app's folder or name,
 * a running process, a service or driver, a startup entry or task, or a
 * shortcut target inside it; a protected/shared name; or any change in the
 * last 60 days. Broken shortcuts, startup entries, tasks and uninstall
 * entries are reported only when their target's drive is present.
 */
export async function windowsOrphans(records: AppRecord[], processPaths: string[]): Promise<LeftoverRecord[]> {
  const out: LeftoverRecord[] = []
  const add = (l: Omit<LeftoverRecord, 'id'>) => out.push({ ...l, id: nextId() })

  const [services, startup] = await Promise.all([servicePaths(), windowsAdapter.list([]).catch(() => [])])
  const startMenus = [join(env('APPDATA'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), join(env('PROGRAMDATA'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')]
  const lnks = (await Promise.all([...startMenus.map((d) => shortcutsUnder(d, 3)), shortcutsUnder(join(env('USERPROFILE'), 'Desktop'), 0), shortcutsUnder(join(env('PUBLIC'), 'Desktop'), 0)])).flat()
  const targets = await resolveShortcuts(lnks)

  const startupExes = startup.map((e) => ({ e, exe: e.exe || parseCommand(e.command).exe }))
  // A startup entry is evidence of use only if what it starts still exists (a broken entry is itself a leftover).
  const liveStartup: typeof startupExes = []
  for (const s of startupExes) if (!ABSOLUTE.test(s.exe) || (await exists(s.exe))) liveStartup.push(s)
  const evidence = [
    ...records.map((r) => r.app.installLocation).filter((x): x is string => !!x),
    ...processPaths,
    ...services,
    ...liveStartup.map((s) => s.exe).filter((x) => ABSOLUTE.test(x)),
    ...[...targets.values()].filter((t) => ABSOLUTE.test(t))
  ]
  const inUse = (folder: string) => evidence.some((p) => isInside(p, folder) || win32.resolve(p).toLowerCase() === win32.resolve(folder).toLowerCase() || isInside(folder, p))
  const owned = ownedNameSet([
    ...records.map((r) => ({ name: r.app.name, publisher: r.app.publisher, installLocation: r.app.installLocation, products: r.products, vendors: r.vendors })),
    ...liveStartup.map(({ e }) => ({ name: e.declaredName ?? e.label.replace(/\.(lnk|url)$/i, '') }))
  ])

  // 1. Folders nobody claims.
  const localLow = join(env('USERPROFILE'), 'AppData', 'LocalLow')
  const roots = [env('APPDATA'), env('LOCALAPPDATA'), join(env('LOCALAPPDATA'), 'Programs'), localLow, env('PROGRAMDATA'), env('ProgramFiles'), env('ProgramFiles(x86)')].filter(Boolean)
  const orphanNames = new Map<string, LeftoverRecord['confidence']>()
  for (const root of roots) {
    for (const name of await childDirs(root)) {
      const path = join(root, name)
      if (isProtectedDirName(name) || isOwnedName(name, owned) || !isOfferablePath(path) || inUse(path)) continue
      const facts = await inspectFolder(path)
      const programsRoot = [env('ProgramFiles'), env('ProgramFiles(x86)'), join(env('LOCALAPPDATA'), 'Programs')].includes(root)
      const verdict = orphanVerdict({ ...facts, gameSaves: root === localLow, programsRoot })
      if (verdict === 'skip') continue
      add({ kind: 'folder', location: path, sizeBytes: facts.bytes, confidence: verdict, reason: 'orphan', lastModified: facts.newest || undefined, target: { type: 'path', path } })
      orphanNames.set(normalize(name), verdict)
    }
  }

  // 2. Shortcuts whose target is gone (the drive is there, the file is not).
  for (const [lnk, target] of targets) {
    if (ABSOLUTE.test(target) && (await driveExists(target)) && !(await exists(target)) && isOfferablePath(lnk)) {
      add({ kind: 'shortcut', location: lnk, sizeBytes: 0, confidence: 'high', reason: 'broken-target', target: { type: 'path', path: lnk } })
    }
  }

  // 3. Run entries and logon tasks that start a program that no longer exists.
  for (const { e, exe } of startupExes) {
    if (!ABSOLUTE.test(exe) || !(await driveExists(exe)) || (await exists(exe))) continue
    if (e.source === 'hkcu-run' || e.source === 'hklm-run' || e.source === 'hklm-run32') {
      const key = e.source === 'hkcu-run' ? 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' : e.source === 'hklm-run' ? 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run' : 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'
      add({ kind: 'registry-value', location: `${key}\\${e.label}`, sizeBytes: 0, confidence: 'high', reason: 'broken-target', target: { type: 'reg-value', key, value: e.label } })
    } else if (e.source === 'task') {
      add({ kind: 'task', location: e.label, sizeBytes: 0, confidence: 'high', reason: 'broken-target', target: { type: 'task', name: e.label } })
    }
  }

  // 4. "Installed apps" entries whose uninstaller AND folder are gone.
  for (const r of records) {
    if (!r.app.uninstallerMissing || r.data.src !== 'reg' || !UNINSTALL_KEYS[r.data.hive]) continue
    if (r.app.installLocation && (await exists(r.app.installLocation))) continue
    const key = `${UNINSTALL_KEYS[r.data.hive]}\\${r.data.key}`
    add({ kind: 'registry-key', location: key, sizeBytes: 0, confidence: 'high', reason: 'broken-entry', target: { type: 'reg-key', key } })
  }

  // 5. HKCU\Software keys named exactly like an orphan folder (two independent traces of the same removed app).
  for (const parent of REG_PARENTS_USER) {
    for (const sub of await regSubkeys(parent)) {
      const confidence = orphanNames.get(normalize(sub))
      if (!confidence || isProtectedDirName(sub) || isOwnedName(sub, owned)) continue
      const key = `${parent}\\${sub}`
      add({ kind: 'registry-key', location: key, sizeBytes: 0, confidence, reason: 'orphan', target: { type: 'reg-key', key } })
    }
  }
  return out
}
