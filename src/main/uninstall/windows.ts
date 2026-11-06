import { spawn } from 'node:child_process'
import { readdir, writeFile } from 'node:fs/promises'
import { join, win32 } from 'node:path'
import si from 'systeminformation'
import { parseCommand } from '../../shared/engine/startup'
import { MIN_TOP_LEVEL, classifyApp, isGenericName, matchFolders, normalize, parseUninstallString, productKeys, vendorKeys, type ProductKeys } from '../../shared/engine/uninstall'
import { isInside } from '../cleaner/fsops'
import { powershell, run } from '../engine/exec'
import { windowsAdapter } from '../startup/windows'
import { childDirs, exists, isDirectory, sizeOf } from './fsutil'
import type { AppRecord, LeftoverRecord, PlatformUninstaller, RunOutcome } from './types'

export const UNINSTALL_KEYS: Record<string, string> = {
  HKLM64: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  HKLM32: 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  HKCU: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
}

/** Registry parents searched for `<Product>` and `<Vendor>\<Product>` keys. */
const REG_PARENTS = ['HKCU\\Software', 'HKLM\\SOFTWARE', 'HKLM\\SOFTWARE\\WOW6432Node']
/** Orphan registry keys are only looked for in the user hive, paired with an orphan folder. */
export const REG_PARENTS_USER = ['HKCU\\Software']

/** Read-only inventory: classic uninstall entries (all three hives) and removable Store apps. */
const INVENTORY = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$out = New-Object System.Collections.ArrayList
$roots = @(
  @{ h = 'HKLM64'; p = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' },
  @{ h = 'HKLM32'; p = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall' },
  @{ h = 'HKCU'; p = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' }
)
foreach ($r in $roots) {
  Get-ChildItem -LiteralPath $r.p | ForEach-Object {
    $v = Get-ItemProperty -LiteralPath $_.PSPath
    if (-not $v.DisplayName -or $v.SystemComponent -eq 1 -or $v.ParentKeyName -or $v.ReleaseType -match 'Update|Hotfix|Security') { return }
    if (-not $v.UninstallString -and -not $v.QuietUninstallString) { return }
    [void]$out.Add([pscustomobject]@{
      src = 'reg'; hive = $r.h; key = $_.PSChildName; name = [string]$v.DisplayName; pub = [string]$v.Publisher
      ver = [string]$v.DisplayVersion; loc = [string]$v.InstallLocation; un = [string]$v.UninstallString
      quiet = [string]$v.QuietUninstallString; size = [int64]$v.EstimatedSize; date = [string]$v.InstallDate
      icon = [string]$v.DisplayIcon; msi = ($v.WindowsInstaller -eq 1)
    })
  }
}
Get-AppxPackage -PackageTypeFilter Main | Where-Object { -not $_.IsFramework -and -not $_.NonRemovable -and $_.SignatureKind -ne 'System' } | ForEach-Object {
  $name = $null; $pub = $null
  try {
    [xml]$m = Get-Content -LiteralPath (Join-Path $_.InstallLocation 'AppxManifest.xml') -Raw
    $name = $m.Package.Properties.DisplayName; $pub = $m.Package.Properties.PublisherDisplayName
  } catch {}
  if (-not $name -or $name -like 'ms-resource:*') { $name = $_.Name }
  if ($pub -like 'ms-resource:*') { $pub = $null }
  [void]$out.Add([pscustomobject]@{ src = 'store'; key = $_.PackageFullName; fam = $_.PackageFamilyName; name = [string]$name; pub = [string]$pub; ver = [string]$_.Version; loc = [string]$_.InstallLocation; sig = [string]$_.SignatureKind })
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 3
`

interface Row {
  src: 'reg' | 'store'
  hive?: string
  key: string
  fam?: string
  name: string
  pub?: string
  ver?: string
  loc?: string
  un?: string
  quiet?: string
  size?: number
  date?: string
  icon?: string
  msi?: boolean
  sig?: string
}

const STORE_FULL_NAME = /^[\w.\-~]+$/
const REG_KEY_NAME = /^[^\\\u0000-\u001f]+$/

function env(name: string): string {
  return process.env[name] ?? ''
}

/** Install folder: declared one, else the uninstaller's/icon's folder when it is named after the product. */
function installDir(row: Row, products: ProductKeys): string | undefined {
    const declared = row.loc?.trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '')
  if (declared) return win32.resolve(declared)
  for (const p of [parseUninstallString(row.un ?? ''), row.icon ? { kind: 'exe' as const, exe: row.icon.split(',')[0].replace(/^"|"$/g, ''), args: '' } : null]) {
    if (p?.kind !== 'exe') continue
    const dir = win32.dirname(p.exe)
    if (products.primary.includes(normalize(win32.basename(dir)))) return dir
  }
  return undefined
}

function toRecord(row: Row, elevated: boolean): AppRecord {
  const products = productKeys({ name: row.name, publisher: row.pub, installLocation: row.loc, regKey: row.src === 'reg' ? row.key : undefined })
  const { kind, risk } = classifyApp(row.name, row.pub)
  const loc = row.src === 'store' ? row.loc : installDir(row, products)
  const parsed = parseUninstallString(row.un ?? '')
  const date = row.date && /^\d{8}$/.test(row.date) ? `${row.date.slice(0, 4)}-${row.date.slice(4, 6)}-${row.date.slice(6)}` : undefined
  const microsoftStore = row.src === 'store' && /^microsoft/i.test(row.fam ?? '')
  return {
    app: {
      id: row.src === 'store' ? `store:${row.key}` : `reg:${row.hive}:${row.key}`,
      name: row.name.trim(),
      publisher: row.pub?.trim() || undefined,
      version: row.ver?.trim() || undefined,
      installDate: date,
      sizeBytes: row.size ? row.size * 1024 : undefined,
      installLocation: loc || undefined,
      source: row.src === 'store' ? 'store' : row.msi || parsed?.kind === 'msi' ? 'msi' : 'win32',
      scope: row.hive === 'HKCU' || row.src === 'store' ? 'user' : 'machine',
      kind,
      // Inbox Microsoft Store apps can be reinstalled from the Store, but say so first.
      risk: risk === 'safe' && microsoftStore ? 'caution' : risk,
      hasQuiet: !!row.quiet || parsed?.kind === 'msi' || row.src === 'store',
      uninstallerMissing: false,
      requiresAdmin: row.src === 'reg' && row.hive !== 'HKCU' && !elevated,
      runningPids: []
    },
    products,
    vendors: vendorKeys(row.pub),
    data: { src: row.src, hive: row.hive ?? '', key: row.key, fam: row.fam ?? '', un: row.un ?? '', quiet: row.quiet ?? '' }
  }
}

/** Runs a vendor command line as stored (quoting preserved) and resolves with its exit code. */
function launch(exe: string, args: string): Promise<{ code: number | null; error?: string }> {
  return new Promise((resolve) => {
    // argv0 + verbatim args reproduce the original command line exactly, without a shell.
    const child = spawn(exe, args ? [args] : [], { windowsVerbatimArguments: true, argv0: `"${exe}"`, windowsHide: false, detached: false, stdio: 'ignore' })
    child.on('error', (e) => resolve({ code: null, error: e.message }))
    child.on('exit', (code) => resolve({ code }))
  })
}

const FOLLOW_UP = /^(au_|un_a|un_|unins\d*|uninst|uninstall|setup|_iu14d2n|_is\w*|msiexec)/i

/**
 * Many uninstallers (NSIS, Inno, InstallShield) copy themselves to %TEMP% and
 * relaunch, so the launched process exits immediately. Wait until no process
 * started since the launch looks like an uninstaller or runs from the app's
 * folder / %TEMP%, up to `maxMs`.
 */
async function waitForFollowUps(before: Set<number>, appDir: string | undefined, maxMs = 20 * 60 * 1000): Promise<void> {
  const temp = env('TEMP')
  const deadline = Date.now() + maxMs
  await new Promise((r) => setTimeout(r, 1500))
  while (Date.now() < deadline) {
    const { list } = await si.processes()
    const busy = list.some(
      (p) =>
        !before.has(p.pid) &&
        (FOLLOW_UP.test(p.name) || (!!p.path && ((!!appDir && isInside(p.path, appDir)) || (!!temp && isInside(p.path, temp) && /\.(exe|tmp)$/i.test(p.name)))))
    )
    if (!busy) return
    await new Promise((r) => setTimeout(r, 1500))
  }
}

export async function regSubkeys(key: string): Promise<string[]> {
  const res = await run('reg.exe', ['query', key], { timeoutMs: 15000 })
  if (!res.ok) return []
  const prefix = key.toLowerCase() + '\\'
  // reg.exe prints full hive names (HKEY_CURRENT_USER\…) even when queried with HKCU\….
  return res.stdout
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^HKEY_CURRENT_USER(?=\\)/i, 'HKCU').replace(/^HKEY_LOCAL_MACHINE(?=\\)/i, 'HKLM'))
    .filter((l) => l.toLowerCase().startsWith(prefix))
    .map((l) => l.slice(prefix.length))
    .filter((n) => n && !n.includes('\\'))
}

async function regKeyExists(key: string): Promise<boolean> {
  return (await run('reg.exe', ['query', key], { timeoutMs: 10000 })).ok
}

/** Folders and shortcuts that RePID will never offer, whatever the name match says. */
function protectedRoots(): string[] {
  return [
    env('SystemRoot') || 'C:\\Windows',
    env('USERPROFILE'),
    env('APPDATA'),
    env('LOCALAPPDATA'),
    join(env('LOCALAPPDATA'), 'Programs'),
    join(env('USERPROFILE'), 'AppData', 'LocalLow'),
    env('PROGRAMDATA'),
    env('ProgramFiles'),
    env('ProgramFiles(x86)'),
    env('PUBLIC'),
    join(env('APPDATA'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    join(env('PROGRAMDATA'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ].filter(Boolean)
}

/** A folder may be offered only if it is at least 3 levels deep, not a well-known root, and not inside Windows. */
export function isOfferablePath(p: string, roots = protectedRoots()): boolean {
  const n = win32.resolve(p).replace(/[\\/]+$/, '').toLowerCase()
  if (n.split('\\').filter(Boolean).length < 3) return false
  if (roots.some((r) => win32.resolve(r).toLowerCase() === n)) return false
  const windows = (env('SystemRoot') || 'C:\\Windows').toLowerCase()
  return !(n === windows || n.startsWith(windows + '\\'))
}

function isOfferableKey(key: string): boolean {
  const parts = key.split('\\')
  const parentOk = REG_PARENTS.some((p) => key.toLowerCase().startsWith(p.toLowerCase() + '\\')) || Object.values(UNINSTALL_KEYS).some((u) => key.toLowerCase().startsWith(u.toLowerCase() + '\\'))
  return parentOk && parts.length >= 3 && REG_KEY_NAME.test(parts[parts.length - 1])
}

export async function resolveShortcuts(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!paths.length) return out
  const res = await powershell(
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8; $sh = New-Object -ComObject WScript.Shell; $list = $env:REPID_LNK | ConvertFrom-Json; " +
      '$r = foreach ($x in $list) { [pscustomobject]@{ p = $x; t = $sh.CreateShortcut($x).TargetPath } }; ConvertTo-Json -InputObject @($r) -Compress',
    { REPID_LNK: JSON.stringify(paths) }
  )
  try {
    for (const row of JSON.parse(res.stdout || '[]') as Array<{ p: string; t?: string }>) if (row?.p && row.t) out.set(row.p, row.t)
  } catch {
    // unresolved shortcuts are simply not matched by target
  }
  return out
}

export async function shortcutsUnder(dir: string, depth = 2): Promise<string[]> {
  const out: string[] = []
  const walk = async (d: string, level: number) => {
    let names: string[] = []
    try {
      names = await readdir(d)
    } catch {
      return
    }
    for (const n of names) {
      const p = join(d, n)
      if (/\.lnk$/i.test(n)) out.push(p)
      else if (level < depth && (await isDirectory(p))) await walk(p, level + 1)
    }
  }
  await walk(dir, 0)
  return out
}

let seq = 0
const nextId = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`

export const windowsUninstaller: PlatformUninstaller = {
  async inventory() {
    const res = await powershell(INVENTORY, undefined, 60000)
    if (!res.ok && !res.stdout.trim()) throw new Error(res.stderr.trim() || 'inventory failed')
    const rows = JSON.parse(res.stdout || '[]') as Row[]
    const elevated = (await run('net.exe', ['session'], { timeoutMs: 5000 })).ok
    const seen = new Set<string>()
    const records: AppRecord[] = []
    for (const row of rows) {
      if (!row?.name || !row.key) continue
      const dedupe = `${normalize(row.name)}|${row.ver ?? ''}`
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
      const rec = toRecord(row, elevated)
      const parsed = parseUninstallString(row.un ?? '')
      if (row.src === 'reg' && parsed?.kind === 'exe' && !(await exists(parsed.exe)) && !row.quiet) rec.app.uninstallerMissing = true
      records.push(rec)
    }
    return records
  },

  async run(record, mode): Promise<RunOutcome> {
    const { src, key, un, quiet } = record.data
    if (src === 'store') {
      if (!STORE_FULL_NAME.test(key)) return { status: 'failed', error: 'invalid package name' }
      const res = await powershell('Remove-AppxPackage -Package $env:REPID_PKG -ErrorAction Stop', { REPID_PKG: key }, 10 * 60 * 1000)
      return res.ok ? { status: 'done' } : { status: 'failed', error: res.stderr.trim().split(/\r?\n/)[0] }
    }
    const parsed = parseUninstallString(mode === 'quiet' && quiet ? quiet : un)
    if (!parsed) return { status: 'missing' }
    const before = new Set((await si.processes()).list.map((p) => p.pid))
    let result: { code: number | null; error?: string }
    if (parsed.kind === 'msi') {
      const args = ['/x', parsed.productCode, ...(mode === 'quiet' ? ['/qn', '/norestart'] : [])]
      result = await new Promise((resolve) => {
        const child = spawn('msiexec.exe', args, { windowsHide: false, stdio: 'ignore' })
        child.on('error', (e) => resolve({ code: null, error: e.message }))
        child.on('exit', (code) => resolve({ code }))
      })
      // 1602 user cancelled · 1605 not installed (already gone) · 3010 success, reboot needed.
      if (result.code === 1602) return { status: 'cancelled', exitCode: 1602 }
      if (result.code === 1925 || result.code === 1730) return { status: 'needs-admin', exitCode: result.code }
      if (result.code !== 0 && result.code !== 3010 && result.code !== 1605) return { status: 'failed', exitCode: result.code ?? undefined, error: result.error }
      return { status: 'done', exitCode: result.code ?? undefined }
    }
    if (!(await exists(parsed.exe))) return { status: 'missing' }
    result = await launch(parsed.exe, parsed.args)
    if (result.error) return /EACCES|EPERM|elevation/i.test(result.error) ? { status: 'needs-admin', error: result.error } : { status: 'failed', error: result.error }
    await waitForFollowUps(before, record.app.installLocation)
    return { status: 'done', exitCode: result.code ?? undefined }
  },

  async leftovers(record, others) {
    const out: LeftoverRecord[] = []
    const add = (l: Omit<LeftoverRecord, 'id'>) => out.push({ ...l, id: nextId() })
    const otherLocations = others.map((o) => o.app.installLocation).filter((x): x is string => !!x)
    const claimed = new Set(others.flatMap((o) => [...o.products.primary, ...o.products.vendorScoped]))
    // Never offer a folder that holds (or is inside) another installed app.
    const sharedWithOthers = (p: string) => otherLocations.some((o) => win32.resolve(o).toLowerCase() === win32.resolve(p).toLowerCase() || isInside(o, p) || isInside(p, o))
    const folders = new Map<string, LeftoverRecord['reason']>()

    // An install folder shared with another app (Office suites, plugins, vendor roots) is not this app's to remove.
    const declaredLoc = record.app.installLocation
    const loc = declaredLoc && !sharedWithOthers(declaredLoc) && !isGenericName(win32.basename(declaredLoc)) && isOfferablePath(declaredLoc) ? declaredLoc : undefined
    if (loc && record.data.src === 'reg' && (await isDirectory(loc))) folders.set(loc, 'install-dir')
    if (record.data.src === 'store' && record.data.fam) {
      const pkgData = join(env('LOCALAPPDATA'), 'Packages', record.data.fam)
      if (await isDirectory(pkgData)) folders.set(pkgData, 'install-dir')
    }

    const roots = [env('APPDATA'), env('LOCALAPPDATA'), join(env('LOCALAPPDATA'), 'Programs'), join(env('USERPROFILE'), 'AppData', 'LocalLow'), env('PROGRAMDATA'), env('ProgramFiles'), env('ProgramFiles(x86)')].filter(Boolean)
    const startMenus = [join(env('APPDATA'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), join(env('PROGRAMDATA'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')]
    if (record.data.src === 'reg') {
      const listing = new Map<string, string[]>()
      for (const dir of [...roots, ...startMenus]) {
        listing.set(dir, await childDirs(dir))
        for (const child of listing.get(dir)!) if (record.vendors.includes(normalize(child))) listing.set(join(dir, child), await childDirs(join(dir, child)))
      }
      for (const dir of [...roots, ...startMenus]) {
        for (const c of matchFolders(dir, (d) => listing.get(d) ?? [], record.products, record.vendors, claimed, '\\')) {
          if (!folders.has(c.path) && isOfferablePath(c.path) && !sharedWithOthers(c.path)) folders.set(c.path, c.reason)
        }
      }
    }
    // Drop folders nested in another candidate: removing the parent covers them.
    const all = [...folders.keys()]
    for (const [path, reason] of folders) {
      if (all.some((o) => o !== path && isInside(path, o))) continue
      add({ kind: 'folder', location: path, sizeBytes: await sizeOf(path), confidence: 'high', reason, target: { type: 'path', path } })
    }
    const appFolders = out.map((o) => o.location)
    const pointsToApp = (target: string) => !!target && appFolders.some((f) => isInside(target, f))

    // Startup leftovers: Run values, Startup-folder shortcuts and logon tasks that launch something from the app's folders.
    try {
      for (const e of await windowsAdapter.list([])) {
        const exe = e.exe || parseCommand(e.command).exe
        if (!pointsToApp(exe) && !(loc && isInside(exe, loc))) continue
        if (e.source === 'hkcu-run' || e.source === 'hklm-run' || e.source === 'hklm-run32') {
          const runKey = e.source === 'hkcu-run' ? 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' : e.source === 'hklm-run' ? 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run' : 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'
          add({ kind: 'registry-value', location: `${runKey}\\${e.label}`, sizeBytes: 0, confidence: 'high', reason: 'points-to-app', target: { type: 'reg-value', key: runKey, value: e.label } })
        } else if (e.source === 'task') {
          add({ kind: 'task', location: e.label, sizeBytes: 0, confidence: 'high', reason: 'points-to-app', target: { type: 'task', name: e.label } })
        }
      }
    } catch {
      // startup inventory is best-effort here
    }

    // Shortcuts (Start Menu, Desktop, Startup folder) whose target lives in the app's folders.
    if (record.data.src === 'reg') {
      const dirs = [...startMenus, join(env('USERPROFILE'), 'Desktop'), join(env('PUBLIC'), 'Desktop')]
      const lnks = (await Promise.all(dirs.map((d) => shortcutsUnder(d)))).flat().filter((p) => !appFolders.some((f) => isInside(p, f)))
      const targets = await resolveShortcuts(lnks)
      for (const [lnk, target] of targets) {
        if (pointsToApp(target) || (loc && isInside(target, loc))) add({ kind: 'shortcut', location: lnk, sizeBytes: 0, confidence: 'high', reason: 'points-to-app', target: { type: 'path', path: lnk } })
      }
    }

    // Registry: Software\<Product>, Software\<Vendor>\<Product> (both views), and the uninstall entry itself.
    if (record.data.src === 'reg') {
      const top = new Set(record.products.primary.filter((p) => p.length >= MIN_TOP_LEVEL && !claimed.has(p)))
      const underVendor = new Set([...record.products.primary, ...record.products.vendorScoped].filter((p) => !claimed.has(p)))
      for (const parent of REG_PARENTS) {
        for (const sub of await regSubkeys(parent)) {
          const n = normalize(sub)
          if (top.has(n)) {
            const key = `${parent}\\${sub}`
            if (isOfferableKey(key)) add({ kind: 'registry-key', location: key, sizeBytes: 0, confidence: 'high', reason: 'name-match', target: { type: 'reg-key', key } })
          } else if (record.vendors.includes(n)) {
            for (const sub2 of await regSubkeys(`${parent}\\${sub}`)) {
              if (!underVendor.has(normalize(sub2))) continue
              const key = `${parent}\\${sub}\\${sub2}`
              if (isOfferableKey(key)) add({ kind: 'registry-key', location: key, sizeBytes: 0, confidence: 'high', reason: 'vendor-dir', target: { type: 'reg-key', key } })
            }
          }
        }
      }
      const uninstallKey = `${UNINSTALL_KEYS[record.data.hive]}\\${record.data.key}`
      // Still present after the uninstaller ran (or the uninstaller is broken): the app's own registration.
      if (UNINSTALL_KEYS[record.data.hive] && REG_KEY_NAME.test(record.data.key) && (await regKeyExists(uninstallKey))) {
        add({ kind: 'registry-key', location: uninstallKey, sizeBytes: 0, confidence: 'high', reason: 'uninstall-entry', target: { type: 'reg-key', key: uninstallKey } })
      }
    }
    return out
  },

  async removeNonFile(l, backupDir) {
    const t = l.target
    const stamp = `${Date.now()}-${l.id}`
    const denied = (s: string) => /denied|denegado|acceso/i.test(s)
    if (t.type === 'reg-key' || t.type === 'reg-value') {
      if (!isOfferableKey(t.type === 'reg-key' ? t.key : `${t.key}\\${t.value}`)) return { ok: false, error: 'refused' }
      // Back up first: the .reg file restores the key with a double-click.
      const exp = await run('reg.exe', ['export', t.key, join(backupDir, `${stamp}.reg`), '/y'], { timeoutMs: 30000 })
      if (!exp.ok) return { ok: false, needsAdmin: denied(exp.stderr + exp.stdout), error: `backup failed: ${(exp.stderr || exp.stdout).trim()}` }
      const del = t.type === 'reg-key' ? await run('reg.exe', ['delete', t.key, '/f'], { timeoutMs: 30000 }) : await run('reg.exe', ['delete', t.key, '/v', t.value, '/f'], { timeoutMs: 30000 })
      return del.ok ? { ok: true } : { ok: false, needsAdmin: denied(del.stderr + del.stdout), error: (del.stderr || del.stdout).trim() }
    }
    if (t.type === 'task') {
      if (!/^\\[^"\u0000-\u001f]+$/.test(t.name)) return { ok: false, error: 'refused' }
      const xml = await run('schtasks.exe', ['/Query', '/TN', t.name, '/XML'], { timeoutMs: 15000 })
      if (!xml.ok) return { ok: false, needsAdmin: denied(xml.stderr), error: xml.stderr.trim() }
      await writeFile(join(backupDir, `${stamp}-task.xml`), xml.stdout, 'utf8')
      const del = await run('schtasks.exe', ['/Delete', '/TN', t.name, '/F'], { timeoutMs: 15000 })
      return del.ok ? { ok: true } : { ok: false, needsAdmin: denied(del.stderr), error: del.stderr.trim() }
    }
    return { ok: false, error: 'unsupported' }
  }
}
