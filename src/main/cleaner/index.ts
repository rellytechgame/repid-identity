import os from 'node:os'
import path from 'node:path'
import type { AppGroup, CleanOutcome, CleanRequest, CleanResult, CleanerReport, CleanerTarget, Platform } from '../../shared/types'
import { normalizeName } from '../../shared/engine/protection'
import type { Engine } from '../engine'
import { powershell, run } from '../engine/exec'
import { isElevated, runElevated, wasCancelled } from '../engine/privileges'
import { clearFirefoxHistory } from './firefox'
import { dirExists, emptyTally, listDirs, processSpec, type Tally } from './fsops'
import {
  APP_CACHE_DIRS,
  APP_CACHE_EXCLUDE,
  CHROMIUM_MARKERS,
  chromiumBrowsers,
  chromiumTargets,
  firefoxLayout,
  firefoxTargets,
  isSafeCleanRoot,
  safariTargets,
  systemTargets,
  type CleanerEnv,
  type PathSpec,
  type TargetDef
} from './targets'
import { existsSync } from 'node:fs'

const MAX_IDS = 200

function currentEnv(): CleanerEnv {
  const home = os.homedir()
  return {
    platform: process.platform as Exclude<Platform, 'web'>,
    home,
    appData: process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
    localAppData: process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'),
    temp: os.tmpdir(),
    systemRoot: process.env.SystemRoot ?? 'C:\\Windows',
    programData: process.env.ProgramData ?? 'C:\\ProgramData'
  }
}

/** Chromium profiles are the sub-folders holding a "Preferences" file (Default, Profile 1, Guest Profile…). */
async function chromiumProfiles(userData: string, single: boolean): Promise<string[]> {
  if (!(await dirExists(userData))) return []
  const dirs = await listDirs(userData)
  const profiles = dirs.filter((d) => d === 'Default' || /^Profile \d+$/.test(d) || d === 'Guest Profile').map((d) => path.join(userData, d))
  // Older Opera builds keep the single profile in the root; recent ones use "Default" like Chrome.
  return profiles.length || !single ? profiles : [userData]
}

/**
 * Electron/Chromium apps (Discord, Slack, VS Code, Postman, Notion…) keep
 * HTTP, code and GPU caches in their user-data folder. A folder only counts
 * when Chromium's own markers sit next to the cache (Local State, Local
 * Storage…), so an unrelated app's "Cache" folder with real data is never touched.
 */
export async function appCacheSpecs(env: CleanerEnv): Promise<PathSpec[]> {
  const roots =
    env.platform === 'win32'
      ? [env.appData, env.localAppData]
      : env.platform === 'darwin'
        ? [path.join(env.home, 'Library', 'Application Support')]
        : [path.join(env.home, '.config')]
  const specs: PathSpec[] = []
  const consider = (userData: string) => {
    if (!CHROMIUM_MARKERS.some((m) => existsSync(path.join(userData, m)))) return
    for (const c of APP_CACHE_DIRS) {
      const dir = path.join(userData, c)
      if (existsSync(dir)) specs.push({ mode: 'contents', dir })
    }
  }
  for (const root of roots) {
    for (const child of await listDirs(root)) {
      if (APP_CACHE_EXCLUDE.has(child.toLowerCase())) continue
      const dir = path.join(root, child)
      consider(dir)
      // Vendor\App layouts (e.g. "Postman\Postman Agent"): one level deeper.
      for (const sub of await listDirs(dir)) if (!APP_CACHE_EXCLUDE.has(sub.toLowerCase())) consider(path.join(dir, sub))
    }
  }
  return specs
}

/** Disk Cleanup handlers for Windows.old and applied-update leftovers (constants; Windows does the deletion with its own ACL rights). */
const SETUP_CLEANUP = String.raw`
$h = 'Previous Installations', 'Temporary Setup Files', 'Windows Upgrade Log Files', 'Setup Log Files', 'Windows ESD installation files', 'Update Cleanup'
$base = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\VolumeCaches'
foreach ($x in $h) { $k = Join-Path $base $x; if (Test-Path -LiteralPath $k) { New-ItemProperty -LiteralPath $k -Name StateFlags0777 -Value 2 -PropertyType DWord -Force | Out-Null } }
try { Start-Process -FilePath "$env:SystemRoot\System32\cleanmgr.exe" -ArgumentList '/sagerun:777' -Wait -WindowStyle Hidden }
finally { foreach ($x in $h) { Remove-ItemProperty -LiteralPath (Join-Path $base $x) -Name StateFlags0777 -ErrorAction SilentlyContinue } }
`

async function windowsRecycleBin(measureOnly: boolean): Promise<Tally> {
  const t = emptyTally()
  const res = await powershell(
    "$i = (New-Object -ComObject Shell.Application).NameSpace(10).Items(); $s = 0; foreach ($x in $i) { $s += [int64]$x.ExtendedProperty('Size') }; \"$($i.Count)|$s\"" +
      (measureOnly ? '' : '; Clear-RecycleBin -Force -ErrorAction SilentlyContinue')
  )
  const [count, bytes] = res.stdout.trim().split('|').map(Number)
  if (Number.isFinite(count)) t.count = count
  if (Number.isFinite(bytes)) t.bytes = bytes
  if (!res.ok) t.skipped++
  return t
}

/**
 * Cleanup module. The UI only ever sends target ids; every path is derived
 * here from fixed templates and the OS environment, checked with
 * `isSafeCleanRoot`, and deletion is confined to each spec directory.
 */
export class Cleaner {
  private defs: TargetDef[] = []
  private env = currentEnv()

  constructor(private readonly engine: Engine) {}

  private async discover(): Promise<TargetDef[]> {
    const env = this.env
    const defs: TargetDef[] = [...systemTargets(env)]
    for (const b of chromiumBrowsers(env)) {
      const profiles = await chromiumProfiles(b.userData, !!b.singleProfile)
      if (profiles.length) defs.push(...chromiumTargets(b, profiles, env.platform))
    }
    const ff = firefoxLayout(env)
    const ffProfiles = (await listDirs(ff.profilesRoot)).filter((n) => !n.startsWith('.'))
    if (ffProfiles.length) defs.push(...firefoxTargets(env, ffProfiles))
    if (env.platform === 'darwin' && (await dirExists(path.join(env.home, 'Library', 'Safari')))) defs.push(...safariTargets(env))
    const caches = await appCacheSpecs(env)
    if (caches.length) defs.push({ id: 'app-caches', kind: 'app-caches', group: 'apps', risk: 'safe', defaultSelected: true, requiresAdmin: false, measurable: true, specs: caches })
    // Defence in depth: drop any spec whose directory is too broad to clean (measure-only specs are never deleted).
    for (const d of defs) if (!d.measureOnly) d.specs = d.specs.filter((s) => isSafeCleanRoot(s.dir, env))
    return defs
  }

  private async runningGroups(): Promise<AppGroup[]> {
    return (await this.engine.snapshot()).groups
  }

  private blockers(def: TargetDef, groups: AppGroup[]): string[] {
    if (!def.processNames?.length) return []
    const names = new Set(def.processNames)
    return [...new Set(groups.filter((g) => names.has(normalizeName(g.name))).map((g) => g.identity.product ?? g.name))]
  }

  private async measure(def: TargetDef): Promise<Tally> {
    const total = emptyTally()
    for (const spec of def.specs) {
      const t = await processSpec(spec, false)
      total.bytes += t.bytes
      total.count += t.count
      total.skipped += t.skipped
      total.denied ||= t.denied
    }
    if (def.actions?.includes('recycle-bin-windows')) {
      const t = await windowsRecycleBin(true)
      total.bytes += t.bytes
      total.count += t.count
    }
    return total
  }

  async scan(): Promise<CleanerReport> {
    this.defs = await this.discover()
    const elevated = await isElevated()
    const groups = await this.runningGroups()
    const targets: CleanerTarget[] = []
    for (const def of this.defs) {
      const tally = await this.measure(def)
      // Admin-only folders are unreadable without elevation: keep them selectable so the user sees what is missing.
      const hasWork = tally.count > 0 || !def.measurable || !!def.alwaysAvailable || !!def.privileged?.length || (def.requiresAdmin && !elevated && tally.denied)
      const needsFda = this.env.platform === 'darwin' && tally.denied && tally.count === 0
      targets.push({
        id: def.id,
        kind: def.kind,
        group: def.group,
        browser: def.browser,
        risk: def.risk,
        requiresAdmin: def.requiresAdmin,
        defaultSelected: def.defaultSelected,
        measurable: def.measurable,
        sizeBytes: tally.bytes,
        itemCount: tally.count,
        available: hasWork && !needsFda,
        unavailableReason: needsFda ? 'needs-full-disk-access' : hasWork ? undefined : 'not-found',
        blockedBy: this.blockers(def, groups)
      })
    }
    return { targets, elevated, scannedAt: Date.now() }
  }

  async clean(raw: unknown): Promise<CleanResult> {
    const req = parseCleanRequest(raw)
    if (!this.defs.length) this.defs = await this.discover()
    const selected = this.defs.filter((d) => req.ids.includes(d.id))
    const elevated = await isElevated()
    const outcomes: CleanOutcome[] = []

    // Close blocking apps once, up front (graceful first; the engine re-checks protection).
    if (req.closeBlocking) {
      const names = new Set(selected.flatMap((d) => d.processNames ?? []))
      if (names.size) {
        const snapshot = await this.engine.snapshot()
        const pids = snapshot.groups.filter((g) => names.has(normalizeName(g.name)) && g.risk === 'safe').flatMap((g) => g.pids)
        if (pids.length) {
          await this.engine.kill({ pids })
          await new Promise((r) => setTimeout(r, 1200))
        }
      }
    }

    const groups = await this.runningGroups()
    const privilegedLines: string[] = []
    const privilegedIds: string[] = []

    for (const def of selected) {
      const out: CleanOutcome = { id: def.id, status: 'cleaned', freedBytes: 0, removed: 0, skipped: 0 }
      outcomes.push(out)
      if (def.risk === 'sensitive' && !req.acknowledgedSensitive) {
        out.status = 'not-acknowledged'
        continue
      }
      if (this.blockers(def, groups).length) {
        out.status = 'skipped-running'
        continue
      }
      if (def.requiresAdmin && process.platform === 'win32' && !elevated) {
        out.status = 'needs-admin'
        continue
      }
      try {
        const tally = emptyTally()
        for (const spec of def.measureOnly ? [] : def.specs) {
          const t = await processSpec(spec, true)
          tally.bytes += t.bytes
          tally.count += t.count
          tally.skipped += t.skipped
        }
        for (const action of def.actions ?? []) {
          if (action === 'recycle-bin-windows') {
            const t = await windowsRecycleBin(false)
            tally.bytes += t.bytes
            tally.count += t.count
            tally.skipped += t.skipped
          } else if (action === 'dns-flush' && process.platform === 'win32') {
            const res = await run('ipconfig.exe', ['/flushdns'])
            if (!res.ok) tally.skipped++
          } else if (action === 'windows-setup-cleanup' && process.platform === 'win32') {
            // Freed space is what the measured folders lost; "Update Cleanup" may free more in WinSxS that is not counted.
            const before = await this.measure({ ...def, actions: [] })
            const res = await powershell(SETUP_CLEANUP, undefined, 60 * 60 * 1000)
            const after = await this.measure({ ...def, actions: [] })
            tally.bytes += Math.max(0, before.bytes - after.bytes)
            tally.count += Math.max(0, before.count - after.count)
            if (!res.ok) tally.skipped++
          } else if (action === 'firefox-history') {
            const layout = firefoxLayout(this.env)
            for (const name of await listDirs(layout.profilesRoot)) {
              const t = await clearFirefoxHistory(path.join(layout.profilesRoot, name))
              tally.bytes += t.bytes
              tally.count += t.count
              tally.skipped += t.skipped
            }
          }
        }
        if (def.privileged?.length && process.platform !== 'win32') {
          privilegedLines.push(...def.privileged)
          privilegedIds.push(def.id)
        }
        out.freedBytes = tally.bytes
        out.removed = tally.count
        out.skipped = tally.skipped
        out.status = tally.skipped > 0 ? (tally.count > 0 ? 'partial' : 'failed') : 'cleaned'
      } catch (err) {
        out.status = 'failed'
        out.error = err instanceof Error ? err.message : String(err)
      }
    }

    // All privileged macOS/Linux work shares one password prompt.
    if (privilegedLines.length) {
      const res = await runElevated(privilegedLines)
      if (!res.ok) {
        for (const o of outcomes) {
          if (privilegedIds.includes(o.id)) o.status = wasCancelled(res) ? 'needs-admin' : 'partial'
        }
      }
    }

    return { outcomes, freedBytes: outcomes.reduce((s, o) => s + o.freedBytes, 0) }
  }
}

export function parseCleanRequest(raw: unknown): CleanRequest {
  const r = raw as Partial<CleanRequest> | null
  if (!r || !Array.isArray(r.ids) || r.ids.length === 0 || r.ids.length > MAX_IDS) throw new Error('Invalid clean request')
  const ids = r.ids.filter((id): id is string => typeof id === 'string' && /^[a-z0-9:-]{1,64}$/.test(id))
  if (ids.length !== r.ids.length) throw new Error('Invalid clean request')
  return { ids: [...new Set(ids)], closeBlocking: r.closeBlocking === true, acknowledgedSensitive: r.acknowledgedSensitive === true }
}
