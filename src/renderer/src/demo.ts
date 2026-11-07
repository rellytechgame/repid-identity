import type {
  AppGroup,
  BoostApp,
  BoostProfileId,
  CleanOutcome,
  InstalledApp,
  Leftover,
  CleanResult,
  CleanerReport,
  CleanerTarget,
  KillOutcome,
  ProcessInfo,
  RepidApi,
  ServiceRef,
  StartupChangeOutcome,
  StartupEntry,
  StartupSource,
  SystemSnapshot
} from '@shared/types'
import { DONATE_URL, ENTERPRISE_BUY_URL, REPO_URL } from '@shared/constants'
import { buildGroups, descendantsOf } from '@shared/engine/grouping'
import { boostKey, isEcoEligible, isFocusEligible } from '@shared/engine/boost'
import { riskOf } from '@shared/engine/protection'
import { MACHINE_SOURCES, assessStartup, matchRunning, measureImpact, parseCommand } from '@shared/engine/startup'
import { classifyApp } from '@shared/engine/uninstall'
import { createDemoExtras } from './demo-extra'

/**
 * Simulated machine for the web demo. Browsers cannot see OS processes, so a
 * realistic Windows-like process tree is generated and animated, and every
 * action mutates this in-memory model only. The grouping, classification and
 * protection logic are the same modules the desktop engine uses.
 */

const GB = 1024 ** 3
const MB = 1024 ** 2
const TOTAL_MEM = 32 * GB

interface Template {
  name: string
  path: string
  cpu: number
  mem: number
  gpu?: number
  command?: string
  parent?: string
  count?: number
  service?: string
}

const W = 'C:\\Windows\\System32\\'
const PF = 'C:\\Program Files\\'
const APPDATA = 'C:\\Users\\demo\\AppData\\'

const TEMPLATES: Template[] = [
  { name: 'System', path: '', cpu: 0.6, mem: 4 * MB },
  { name: 'smss.exe', path: `${W}smss.exe`, cpu: 0, mem: 1 * MB, parent: 'System' },
  { name: 'csrss.exe', path: `${W}csrss.exe`, cpu: 0.2, mem: 6 * MB },
  { name: 'wininit.exe', path: `${W}wininit.exe`, cpu: 0, mem: 7 * MB },
  { name: 'services.exe', path: `${W}services.exe`, cpu: 0.1, mem: 10 * MB, parent: 'wininit.exe' },
  { name: 'lsass.exe', path: `${W}lsass.exe`, cpu: 0.2, mem: 22 * MB, parent: 'wininit.exe' },
  { name: 'svchost.exe', path: `${W}svchost.exe`, cpu: 0.3, mem: 38 * MB, parent: 'services.exe', service: 'Dnscache' },
  { name: 'svchost.exe', path: `${W}svchost.exe`, cpu: 0.8, mem: 64 * MB, parent: 'services.exe', service: 'Winmgmt' },
  { name: 'svchost.exe', path: `${W}svchost.exe`, cpu: 0.1, mem: 18 * MB, parent: 'services.exe', service: 'AudioSrv' },
  { name: 'SearchIndexer.exe', path: `${W}SearchIndexer.exe`, cpu: 6.5, mem: 210 * MB, parent: 'services.exe', service: 'WSearch' },
  { name: 'MsMpEng.exe', path: 'C:\\ProgramData\\Microsoft\\Windows Defender\\Platform\\MsMpEng.exe', cpu: 3.1, mem: 260 * MB, parent: 'services.exe', service: 'WinDefend' },
  { name: 'dwm.exe', path: `${W}dwm.exe`, cpu: 2.4, mem: 140 * MB, gpu: 9 },
  { name: 'explorer.exe', path: 'C:\\Windows\\explorer.exe', cpu: 0.9, mem: 180 * MB },
  { name: 'chrome.exe', path: `${PF}Google\\Chrome\\Application\\chrome.exe`, cpu: 2.2, mem: 420 * MB, gpu: 4, parent: 'explorer.exe' },
  { name: 'chrome.exe', path: `${PF}Google\\Chrome\\Application\\chrome.exe`, cpu: 0.5, mem: 210 * MB, parent: 'chrome.exe', count: 14, command: '--type=renderer' },
  { name: 'chrome.exe', path: `${PF}Google\\Chrome\\Application\\chrome.exe`, cpu: 3.5, mem: 310 * MB, gpu: 11, parent: 'chrome.exe', command: '--type=gpu-process' },
  { name: 'Code.exe', path: `${APPDATA}Local\\Programs\\Microsoft VS Code\\Code.exe`, cpu: 1.8, mem: 380 * MB, parent: 'explorer.exe' },
  { name: 'Code.exe', path: `${APPDATA}Local\\Programs\\Microsoft VS Code\\Code.exe`, cpu: 1.1, mem: 190 * MB, parent: 'Code.exe', count: 6, command: '--type=utility' },
  { name: 'node.exe', path: `${PF}nodejs\\node.exe`, cpu: 9.5, mem: 640 * MB, parent: 'Code.exe', command: 'C:\\dev\\shop\\node_modules\\vite\\bin\\vite.js --port 5173' },
  { name: 'node.exe', path: `${PF}nodejs\\node.exe`, cpu: 4.2, mem: 920 * MB, parent: 'Code.exe', command: '"C:\\Users\\demo\\.vscode\\extensions\\node_modules\\typescript\\lib\\tsserver.js"' },
  { name: 'Discord.exe', path: `${APPDATA}Local\\Discord\\app-1.0.9\\Discord.exe`, cpu: 1.4, mem: 310 * MB, parent: 'explorer.exe', count: 4 },
  { name: 'Spotify.exe', path: `${APPDATA}Roaming\\Spotify\\Spotify.exe`, cpu: 0.9, mem: 240 * MB, parent: 'explorer.exe', count: 3 },
  { name: 'ms-teams.exe', path: `${PF}WindowsApps\\MSTeams\\ms-teams.exe`, cpu: 2.1, mem: 520 * MB, parent: 'explorer.exe', count: 3 },
  { name: 'Docker Desktop.exe', path: `${PF}Docker\\Docker\\Docker Desktop.exe`, cpu: 0.6, mem: 210 * MB, parent: 'explorer.exe' },
  { name: 'vmmem', path: '', cpu: 7.5, mem: 3.1 * GB },
  { name: 'steam.exe', path: 'C:\\Program Files (x86)\\Steam\\steam.exe', cpu: 0.4, mem: 120 * MB, parent: 'explorer.exe' },
  { name: 'steamwebhelper.exe', path: 'C:\\Program Files (x86)\\Steam\\bin\\cef\\steamwebhelper.exe', cpu: 0.8, mem: 150 * MB, parent: 'steam.exe', count: 5 },
  { name: 'python.exe', path: `${APPDATA}Local\\Programs\\Python\\Python313\\python.exe`, cpu: 22, mem: 1.4 * GB, gpu: 38, parent: 'explorer.exe', command: 'train_model.py --epochs 40' },
  { name: 'OneDrive.exe', path: `${APPDATA}Local\\Microsoft\\OneDrive\\OneDrive.exe`, cpu: 1.2, mem: 95 * MB, parent: 'explorer.exe' },
  { name: 'QuickToolsHelper.exe', path: `${APPDATA}Roaming\\QuickTools\\QuickToolsHelper.exe`, cpu: 17, mem: 330 * MB, parent: 'explorer.exe' }
]

function seed(): { procs: ProcessInfo[]; services: Map<number, ServiceRef[]> } {
  const procs: ProcessInfo[] = []
  const services = new Map<number, ServiceRef[]>()
  // Children attach to the first (root) process created with the parent's name.
  const firstPidByName = new Map<string, number>()
  let pid = 4
  for (const t of TEMPLATES) {
    const ppid = t.parent ? (firstPidByName.get(t.parent) ?? 0) : 0
    const firstOfTemplate = pid
    for (let i = 0; i < (t.count ?? 1); i++) {
      if (t.service) services.set(pid, [{ name: t.service, manager: 'windows-scm' }])
      procs.push({
        pid,
        // Extra instances of a multi-process app are children of its first instance, like real Electron apps.
        ppid: i > 0 && t.parent !== t.name ? firstOfTemplate : ppid,
        name: t.name,
        path: t.path,
        command: t.command ? `"${t.path}" ${t.command}` : t.path || t.name,
        user: t.path.startsWith('C:\\Windows') || !t.path ? 'SYSTEM' : 'demo',
        cpu: t.cpu,
        memBytes: t.mem,
        gpu: t.gpu,
        started: new Date(Date.now() - Math.random() * 8 * 3600e3).toISOString()
      })
      if (!firstPidByName.has(t.name)) firstPidByName.set(t.name, pid)
      pid += 4 + Math.floor(Math.random() * 400)
    }
  }
  return { procs, services }
}

function demoCleanerTargets(running: Set<string>, cleaned: Set<string>): CleanerTarget[] {
  const row = (
    id: string,
    kind: CleanerTarget['kind'],
    group: CleanerTarget['group'],
    risk: CleanerTarget['risk'],
    size: number,
    items: number,
    extra: Partial<CleanerTarget> = {}
  ): CleanerTarget => ({
    id,
    kind,
    group,
    risk,
    requiresAdmin: false,
    defaultSelected: risk === 'safe',
    measurable: true,
    sizeBytes: cleaned.has(id) ? 0 : size,
    itemCount: cleaned.has(id) ? 0 : items,
    available: true,
    blockedBy: [],
    ...extra
  })
  const chromeOpen = running.has('chrome.exe') ? ['Google Chrome'] : []
  return [
    row('user-temp', 'user-temp', 'system', 'safe', 2.4 * GB, 18432),
    row('system-temp', 'system-temp', 'system', 'caution', 860 * MB, 3120, { requiresAdmin: true, defaultSelected: true }),
    row('update-cache', 'update-cache', 'system', 'caution', 3.1 * GB, 214, { requiresAdmin: true }),
    row('recycle-bin', 'recycle-bin', 'system', 'sensitive', 1.7 * GB, 96),
    row('dns-cache', 'dns-cache', 'system', 'safe', 0, 0, { measurable: false }),
    row('crash-dumps', 'crash-dumps', 'system', 'safe', 2.1 * GB, 4, { requiresAdmin: true }),
    row('windows-old', 'windows-old', 'system', 'caution', 14.6 * GB, 41230, { requiresAdmin: true }),
    row('app-caches', 'app-caches', 'apps', 'safe', 1.8 * GB, 23840),
    row('dev-caches', 'dev-caches', 'apps', 'caution', 4.6 * GB, 52110),
    row('browser:chrome:cache', 'browser-cache', 'browsers', 'safe', 1.2 * GB, 9420, { browser: 'Google Chrome', blockedBy: chromeOpen }),
    row('browser:chrome:history', 'browser-history', 'browsers', 'sensitive', 84 * MB, 11, { browser: 'Google Chrome', blockedBy: chromeOpen }),
    row('browser:chrome:cookies', 'browser-cookies', 'browsers', 'sensitive', 6 * MB, 2, { browser: 'Google Chrome', blockedBy: chromeOpen }),
    row('browser:edge:cache', 'browser-cache', 'browsers', 'safe', 540 * MB, 3810, { browser: 'Microsoft Edge' }),
    row('browser:edge:history', 'browser-history', 'browsers', 'sensitive', 31 * MB, 9, { browser: 'Microsoft Edge' }),
    row('browser:edge:cookies', 'browser-cookies', 'browsers', 'sensitive', 3 * MB, 2, { browser: 'Microsoft Edge' }),
    row('browser:firefox:cache', 'browser-cache', 'browsers', 'safe', 690 * MB, 5120, { browser: 'Firefox' }),
    row('browser:firefox:history', 'browser-history', 'browsers', 'sensitive', 22 * MB, 3, { browser: 'Firefox' }),
    row('browser:firefox:cookies', 'browser-cookies', 'browsers', 'sensitive', 2 * MB, 1, { browser: 'Firefox' })
  ]
}

interface DemoStartup {
  source: StartupSource
  label: string
  command: string
  publisher?: string
  declaredName?: string
  enabled: boolean
}

const X86 = 'C:\\Program Files (x86)\\'
const DEMO_STARTUP: DemoStartup[] = [
  { source: 'hkcu-run', label: 'Discord', command: `${APPDATA}Local\\Discord\\Update.exe --processStart Discord.exe`, publisher: 'Discord Inc.', enabled: true },
  { source: 'hkcu-run', label: 'Spotify', command: `"${APPDATA}Roaming\\Spotify\\Spotify.exe" /minimized`, publisher: 'Spotify AB', enabled: true },
  { source: 'hkcu-run', label: 'OneDrive', command: `"${APPDATA}Local\\Microsoft\\OneDrive\\OneDrive.exe" /background`, publisher: 'Microsoft Corporation', enabled: true },
  { source: 'hkcu-run', label: 'MicrosoftEdgeAutoLaunch_0A1B2C3D4E5F60718293A4B5C6D7E8F9', command: `"${X86}Microsoft\\Edge\\Application\\msedge.exe" --no-startup-window`, publisher: 'Microsoft Corporation', enabled: true },
  { source: 'hkcu-run', label: 'Steam', command: `"${X86}Steam\\steam.exe" -silent`, publisher: 'Valve Corporation', enabled: true },
  { source: 'hkcu-run', label: 'Docker Desktop', command: `"${PF}Docker\\Docker\\Docker Desktop.exe" -Autostart`, publisher: 'Docker Inc.', enabled: false },
  { source: 'user-folder', label: 'QuickTools.lnk', command: `"${APPDATA}Roaming\\QuickTools\\QuickToolsHelper.exe"`, declaredName: 'QuickTools', publisher: 'QuickTools Ltd.', enabled: true },
  { source: 'store-app', label: 'MSTeams_8wekyb3d8bbwe\\TeamsTfwStartupTask', command: `${PF}WindowsApps\\MSTeams\\ms-teams.exe`, declaredName: 'Microsoft Teams', publisher: 'Microsoft Corporation', enabled: true },
  { source: 'hklm-run', label: 'SecurityHealth', command: `${W}SecurityHealthSystray.exe`, declaredName: 'Windows Security notification icon', publisher: 'Microsoft Corporation', enabled: true },
  { source: 'hklm-run', label: 'RtkAudUService', command: `"${W}DriverStore\\FileRepository\\realtek.inf_amd64\\RtkAudUService64.exe" -background`, declaredName: 'Realtek HD Audio Universal Service', publisher: 'Realtek Semiconductor', enabled: true },
  { source: 'hklm-run32', label: 'SunJavaUpdateSched', command: `"${X86}Common Files\\Java\\Java Update\\jusched.exe"`, declaredName: 'Java Update Scheduler', publisher: 'Oracle Corporation', enabled: true },
  { source: 'task', label: '\\Adobe Acrobat Update Task', command: `"${X86}Common Files\\Adobe\\ARM\\1.0\\AdobeARM.exe"`, declaredName: 'Adobe Acrobat Update Service', publisher: 'Adobe Inc.', enabled: true }
]

interface DemoInstalled {
  name: string
  publisher: string
  version: string
  date: string
  size: number
  location: string
  source?: InstalledApp['source']
  /** Process name used to mark it as running. */
  exe?: string
  missing?: boolean
  leftovers: Array<Omit<Leftover, 'id'>>
}

const LOCAL = `${APPDATA}Local\\`
const ROAM = `${APPDATA}Roaming\\`
const leftover = (kind: Leftover['kind'], location: string, sizeBytes: number, reason: Leftover['reason'], confidence: Leftover['confidence'] = 'high') => ({ kind, location, sizeBytes, reason, confidence })

const DAYS = 24 * 3600 * 1000
const orphan = (kind: Leftover['kind'], location: string, sizeBytes: number, reason: Leftover['reason'], confidence: Leftover['confidence'], idleDays?: number) => ({
  kind,
  location,
  sizeBytes,
  reason,
  confidence,
  lastModified: idleDays ? Date.now() - idleDays * DAYS : undefined
})

/** Leftovers of apps the demo machine no longer has. */
const DEMO_ORPHANS: Array<Omit<Leftover, 'id'>> = [
  orphan('folder', `${LOCAL}tiktok live studio-updater`, 998 * MB, 'orphan', 'medium', 674),
  orphan('folder', `${ROAM}OldGameLauncher`, 812 * MB, 'orphan', 'medium', 410),
  orphan('folder', `${LOCAL}DiskTool`, 214 * MB, 'orphan', 'high', 292),
  orphan('folder', `${ROAM}PhotoSuite 2019`, 96 * MB, 'orphan', 'high', 840),
  orphan('folder', `${PF}OldVPN`, 0, 'orphan', 'high', 520),
  orphan('folder', `C:\\Users\\demo\\AppData\\LocalLow\\Indie Studio`, 3 * MB, 'orphan', 'medium', 689),
  orphan('shortcut', `${ROAM}Microsoft\\Windows\\Start Menu\\Programs\\Steam\\Steam.lnk`, 0, 'broken-target', 'high'),
  orphan('shortcut', `C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\PhotoSuite 2019\\PhotoSuite.lnk`, 0, 'broken-target', 'high'),
  orphan('registry-value', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\OldGameLauncher', 0, 'broken-target', 'high'),
  orphan('task', '\\OldVPN Updater', 0, 'broken-target', 'high'),
  orphan('registry-key', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PhotoSuite2019', 0, 'broken-entry', 'high'),
  orphan('registry-key', 'HKCU\\Software\\PhotoSuite 2019', 0, 'orphan', 'high')
]

const DEMO_INSTALLED: DemoInstalled[] = [
  { name: 'Discord', publisher: 'Discord Inc.', version: '1.0.9180', date: '2026-08-14', size: 412 * MB, location: `${LOCAL}Discord`, exe: 'discord.exe', leftovers: [
    leftover('folder', `${LOCAL}Discord`, 96 * MB, 'install-dir'), leftover('folder', `${ROAM}discord`, 1.3 * GB, 'name-match'),
    leftover('registry-value', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\Discord', 0, 'points-to-app'),
    leftover('shortcut', `${ROAM}Microsoft\\Windows\\Start Menu\\Programs\\Discord Inc\\Discord.lnk`, 0, 'points-to-app') ] },
  { name: 'Spotify', publisher: 'Spotify AB', version: '1.2.74', date: '2026-07-02', size: 388 * MB, location: `${ROAM}Spotify`, exe: 'spotify.exe', leftovers: [
    leftover('folder', `${LOCAL}Spotify`, 2.4 * GB, 'name-match'), leftover('registry-key', 'HKCU\\Software\\Spotify', 0, 'name-match'),
    leftover('shortcut', `C:\\Users\\demo\\Desktop\\Spotify.lnk`, 0, 'points-to-app') ] },
  { name: 'QuickTools 4.2', publisher: 'QuickTools Ltd.', version: '4.2.0', date: '2025-11-30', size: 156 * MB, location: `${ROAM}QuickTools`, exe: 'quicktoolshelper.exe', leftovers: [
    leftover('folder', `${ROAM}QuickTools`, 22 * MB, 'install-dir'), leftover('folder', `C:\\ProgramData\\QuickTools Ltd\\QuickTools`, 310 * MB, 'vendor-dir'),
    leftover('registry-key', 'HKLM\\SOFTWARE\\WOW6432Node\\QuickTools Ltd\\QuickTools', 0, 'vendor-dir'), leftover('task', '\\QuickTools Updater', 0, 'points-to-app'),
    leftover('folder', 'C:\\Users\\demo\\Documents\\QuickTools', 3 * MB, 'name-match', 'medium') ] },
  { name: 'Docker Desktop', publisher: 'Docker Inc.', version: '4.49.0', date: '2026-09-21', size: 3.2 * GB, location: `${PF}Docker\\Docker`, exe: 'docker desktop.exe', leftovers: [
    leftover('folder', `${ROAM}Docker Desktop`, 12 * MB, 'name-match'), leftover('folder', `${LOCAL}Docker`, 640 * MB, 'name-match'),
    leftover('registry-key', 'HKCU\\Software\\Docker Inc.\\Docker Desktop', 0, 'vendor-dir') ] },
  { name: 'Steam', publisher: 'Valve Corporation', version: '2.10.91.91', date: '2024-03-12', size: 1.1 * GB, location: 'C:\\Program Files (x86)\\Steam', exe: 'steam.exe', leftovers: [
    leftover('registry-key', 'HKCU\\Software\\Valve\\Steam', 0, 'vendor-dir'), leftover('shortcut', `C:\\Users\\Public\\Desktop\\Steam.lnk`, 0, 'points-to-app') ] },
  { name: 'Old Photo Editor 2019', publisher: 'PixelSoft', version: '9.1', date: '2021-02-08', size: 845 * MB, location: `${PF}PixelSoft\\Photo Editor 2019`, missing: true, leftovers: [
    leftover('folder', `${PF}PixelSoft\\Photo Editor 2019`, 845 * MB, 'install-dir'),
    leftover('registry-key', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PhotoEditor2019', 0, 'uninstall-entry') ] },
  { name: 'WhatsApp', publisher: 'WhatsApp Inc.', version: '2.2640.100', date: '2026-10-02', size: 0, location: `${PF}WindowsApps\\5319275A.WhatsAppDesktop`, source: 'store', leftovers: [] },
  { name: 'Realtek Audio Driver', publisher: 'Realtek Semiconductor Corp.', version: '6.0.9586', date: '2025-05-19', size: 290 * MB, location: `${PF}Realtek\\Audio`, leftovers: [] },
  { name: 'Microsoft Visual C++ 2015-2022 Redistributable (x64)', publisher: 'Microsoft Corporation', version: '14.44.35211', date: '2026-04-09', size: 21 * MB, location: '', source: 'msi', leftovers: [] },
  { name: 'Microsoft .NET Runtime - 8.0.11 (x64)', publisher: 'Microsoft Corporation', version: '8.0.11', date: '2026-01-15', size: 74 * MB, location: '', source: 'msi', leftovers: [] }
]

export function createDemoApi(): RepidApi {
  const seeded = seed()
  let procs = seeded.procs
  const services = seeded.services
  const base = new Map(procs.map((p) => [p.pid, { cpu: p.cpu, mem: p.memBytes, gpu: p.gpu }]))
  const cleaned = new Set<string>()
  const ctx = { platform: 'win32' as const, selfPids: new Set<number>(), userProtected: new Set<string>() }
  let tick = 0
  const startupState = new Map(DEMO_STARTUP.map((d) => [`${d.source}:${d.label}`, d.enabled]))
  const startupJournal = new Set<string>()
  const boostTargets = new Map<string, { role: 'eco' | 'focus'; name: string; product?: string }>()
  let boostProfile: BoostProfileId | undefined
  let boostSince: number | undefined
  const groupsNow = (): AppGroup[] => buildGroups(procs, { ...ctx, totalMem: TOTAL_MEM, services })
  const uninstalled = new Set<string>()
  const leftoverSessions = new Map<string, Leftover[]>()
  const demoApps = (): InstalledApp[] =>
    DEMO_INSTALLED.filter((d) => !uninstalled.has(d.name)).map((d) => {
      const { kind, risk } = classifyApp(d.name, d.publisher)
      return {
        id: `demo:${d.name}`,
        name: d.name,
        publisher: d.publisher,
        version: d.version,
        installDate: d.date,
        sizeBytes: d.size || undefined,
        installLocation: d.location || undefined,
        source: d.source ?? 'win32',
        scope: d.location.includes('\\Users\\') || d.source === 'store' ? 'user' : 'machine',
        kind,
        risk,
        hasQuiet: d.source === 'msi',
        uninstallerMissing: !!d.missing,
        requiresAdmin: false,
        runningPids: d.exe ? procs.filter((p) => p.name.toLowerCase() === d.exe).map((p) => p.pid) : []
      }
    })
  const startLeftovers = (d: DemoInstalled): Leftover[] => {
    const list = d.leftovers.map((l, i) => ({ ...l, id: `d${i}${Math.random().toString(36).slice(2, 8)}` }))
    leftoverSessions.set(`demo:${d.name}`, list)
    return list
  }

  const startupEntries = (): StartupEntry[] => {
    const groups = groupsNow()
    return DEMO_STARTUP.map((d) => {
      const id = `${d.source}:${d.label}`
      const enabled = startupState.get(id) ?? d.enabled
      const cmd = parseCommand(d.command)
      const a = assessStartup({
        platform: 'win32',
        label: d.label,
        command: d.command,
        exe: cmd.exe,
        launches: cmd.launches,
        declaredName: d.declaredName,
        publisher: d.publisher,
        userProtected: ctx.userProtected
      })
      const { running, impact } = measureImpact(enabled ? matchRunning(cmd.exe, cmd.launches, groups) : [])
      const machine = MACHINE_SOURCES.has(d.source)
      return {
        id,
        name: a.name,
        publisher: d.publisher,
        command: d.command,
        exe: cmd.exe,
        source: d.source,
        scope: machine ? 'machine' : 'user',
        enabled,
        risk: a.risk,
        effect: a.effect,
        recommended: a.recommended && enabled,
        requiresAdmin: machine,
        running,
        impact: enabled ? impact : 'not-running',
        changedByRepid: startupJournal.has(id) && !enabled
      }
    })
  }

  const setStartup = async (ids: string[], enabled: boolean, allowCaution: boolean): Promise<StartupChangeOutcome[]> => {
    await new Promise((r) => setTimeout(r, 350))
    const all = startupEntries()
    return ids.map((id): StartupChangeOutcome => {
      const e = all.find((x) => x.id === id)
      if (!e) return { id, name: id, status: 'not-found' }
      if (e.risk === 'critical' || (e.risk === 'caution' && !allowCaution && !(enabled && e.changedByRepid))) return { id, name: e.name, status: 'protected' }
      if (e.enabled === enabled) return { id, name: e.name, status: 'unchanged' }
      startupState.set(id, enabled)
      if (enabled) startupJournal.delete(id)
      else startupJournal.add(id)
      return { id, name: e.name, status: 'changed' }
    })
  }

  const boostStatus = () => {
    const groups = groupsNow()
    const apps: BoostApp[] = [...boostTargets].map(([key, target]) => {
      const matching = groups.filter((g) => boostKey(g) === key)
      return {
        key,
        ...target,
        groupIds: matching.map((g) => g.id),
        applied: matching.reduce((s, g) => s + g.pids.length, 0),
        refused: 0,
        ecoQos: target.role === 'eco',
        cpu: Math.round(matching.reduce((s, g) => s + g.cpu, 0) * 10) / 10,
        memBytes: matching.reduce((s, g) => s + g.memBytes, 0)
      }
    })
    return { active: boostTargets.size > 0, profile: boostProfile, startedAt: boostSince, apps, focusSupported: true, restorePending: false }
  }

  /** Simulated effect: background apps yield ~45% of their CPU while in efficiency mode. */
  const ecoFactor = (p: ProcessInfo) => (boostTargets.get(boostKey({ name: p.name, command: p.command }))?.role === 'eco' ? 0.55 : 1)

  const jitter = () => {
    tick++
    procs = procs.map((p) => {
      const b = base.get(p.pid)!
      const wave = 1 + 0.35 * Math.sin(tick / 3 + p.pid) + (Math.random() - 0.5) * 0.4
      return {
        ...p,
        cpu: Math.max(0, Math.round(b.cpu * wave * ecoFactor(p) * 10) / 10),
        memBytes: Math.round(b.mem * (1 + 0.04 * Math.sin(tick / 5 + p.pid))),
        gpu: b.gpu !== undefined ? Math.max(0, Math.round(b.gpu * wave)) : undefined
      }
    })
  }

  return {
    ...createDemoExtras(groupsNow),
    platform: 'web',
    version: 'demo',
    async snapshot(): Promise<SystemSnapshot> {
      jitter()
      const used = Math.min(TOTAL_MEM * 0.97, 2.1 * GB + procs.reduce((s, p) => s + p.memBytes, 0))
      // Simulated hosts are 12-core: per-process figures overlap in time, so the aggregate is damped.
      const cpu = Math.min(96, 6 + procs.reduce((s, p) => s + p.cpu, 0) * 0.6)
      const gpu = Math.min(100, procs.reduce((s, p) => s + (p.gpu ?? 0), 0))
      return {
        timestamp: Date.now(),
        platform: 'web',
        hostname: 'demo-workstation',
        elevated: false,
        cpu: { load: cpu, cores: 12, brand: 'Simulated 12-core CPU' },
        mem: { total: TOTAL_MEM, used, available: TOTAL_MEM - used },
        gpu: { utilization: gpu, controllers: [{ model: 'Simulated GPU', vendor: 'Demo', memTotalMb: 8192, memUsedMb: Math.round(gpu * 50) }] },
        processCount: procs.length,
        groups: buildGroups(procs, { ...ctx, totalMem: TOTAL_MEM, services })
      }
    },
    async details(pid) {
      const target = procs.find((p) => p.pid === pid)
      if (!target) return null
      const tree = [target, ...descendantsOf([pid], procs)].map((p) => {
        let depth = 0
        let cur = p
        while (cur.pid !== pid && depth < 20) {
          cur = procs.find((q) => q.pid === cur.ppid) ?? target
          depth++
        }
        return { pid: p.pid, ppid: p.ppid, name: p.name, depth, cpu: p.cpu, memBytes: p.memBytes }
      })
      return { pid, tree, description: undefined, company: undefined, version: undefined }
    },
    async kill(req) {
      const targets = [...procs.filter((p) => req.pids.includes(p.pid)), ...descendantsOf(req.pids, procs)]
      const outcomes: KillOutcome[] = []
      let freedMemBytes = 0
      let freedCpu = 0
      const removed = new Set<number>()
      for (const p of targets) {
        const risk = riskOf(p.pid, p.name, ctx)
        if (risk === 'critical' || (risk === 'caution' && !req.allowCaution)) {
          outcomes.push({ pid: p.pid, name: p.name, status: 'protected' })
          continue
        }
        removed.add(p.pid)
        freedMemBytes += p.memBytes
        freedCpu += p.cpu
        outcomes.push({ pid: p.pid, name: p.name, status: 'killed' })
      }
      procs = procs.filter((p) => !removed.has(p.pid))
      await new Promise((r) => setTimeout(r, 450))
      return { outcomes, freedMemBytes, freedCpu: Math.min(100, freedCpu) }
    },
    async stopService(pid) {
      const svc = services.get(pid)?.[0]
      return { service: svc?.name ?? '', ok: false, needsElevation: true, error: 'demo' }
    },
    async setSettings(settings) {
      ctx.userProtected = new Set(settings.protectedNames.map((n) => n.toLowerCase().replace(/\.exe$/, '')))
    },
    async cleanerScan(): Promise<CleanerReport> {
      await new Promise((r) => setTimeout(r, 700))
      const running = new Set(procs.map((p) => p.name.toLowerCase()))
      return { targets: demoCleanerTargets(running, cleaned), elevated: false, scannedAt: Date.now() }
    },
    async cleanerClean(req): Promise<CleanResult> {
      await new Promise((r) => setTimeout(r, 1100))
      const running = new Set(procs.map((p) => p.name.toLowerCase()))
      const targets = demoCleanerTargets(running, cleaned)
      const outcomes: CleanOutcome[] = req.ids.map((id) => {
        const t = targets.find((x) => x.id === id)
        if (!t) return { id, status: 'failed', freedBytes: 0, removed: 0, skipped: 0 }
        if (t.risk === 'sensitive' && !req.acknowledgedSensitive) return { id, status: 'not-acknowledged', freedBytes: 0, removed: 0, skipped: 0 }
        if (t.blockedBy.length && !req.closeBlocking) return { id, status: 'skipped-running', freedBytes: 0, removed: 0, skipped: 0 }
        if (t.requiresAdmin) return { id, status: 'needs-admin', freedBytes: 0, removed: 0, skipped: 0 }
        cleaned.add(id)
        return { id, status: 'cleaned', freedBytes: t.sizeBytes, removed: t.itemCount, skipped: 0 }
      })
      if (req.closeBlocking) procs = procs.filter((p) => !/^(chrome|firefox)\.exe$/i.test(p.name))
      return { outcomes, freedBytes: outcomes.reduce((s, o) => s + o.freedBytes, 0) }
    },
    async startupScan() {
      await new Promise((r) => setTimeout(r, 600))
      return { entries: startupEntries(), elevated: false, supported: true, scannedAt: Date.now() }
    },
    async startupSet(req) {
      return setStartup(req.ids, req.enabled, req.allowCaution)
    },
    async startupRestore() {
      return setStartup([...startupJournal], true, true)
    },
    async boostStatus() {
      return boostStatus()
    },
    async boostApply(req) {
      const groups = groupsNow()
      boostTargets.clear()
      const focus = groups.find((g) => g.id === req.focusGroupId)
      if (focus && isFocusEligible(focus)) boostTargets.set(boostKey(focus), { role: 'focus', name: focus.name, product: focus.identity.product })
      for (const id of req.ecoGroupIds) {
        const g = groups.find((x) => x.id === id)
        if (g && isEcoEligible(g) && !boostTargets.has(boostKey(g))) boostTargets.set(boostKey(g), { role: 'eco', name: g.name, product: g.identity.product })
      }
      boostProfile = boostTargets.size ? req.profile : undefined
      boostSince = boostTargets.size ? (boostSince ?? Date.now()) : undefined
      await new Promise((r) => setTimeout(r, 300))
      return boostStatus()
    },
    async boostStop() {
      boostTargets.clear()
      boostProfile = undefined
      boostSince = undefined
      return boostStatus()
    },
    async uninstallList() {
      await new Promise((r) => setTimeout(r, 700))
      return { apps: demoApps(), elevated: false, supported: true, scannedAt: Date.now() }
    },
    async uninstallRun(req) {
      const app = demoApps().find((a) => a.id === req.id)
      const d = DEMO_INSTALLED.find((x) => `demo:${x.name}` === req.id)
      if (!app || !d) return { id: req.id, status: 'not-found', leftovers: [] }
      if (app.risk === 'critical' || (app.risk === 'caution' && !req.allowCaution)) return { id: req.id, status: 'protected', leftovers: [] }
      if (app.uninstallerMissing) return { id: req.id, status: 'uninstaller-failed', error: 'missing', leftovers: [] }
      if (req.closeRunning) procs = procs.filter((p) => !app.runningPids.includes(p.pid))
      await new Promise((r) => setTimeout(r, 2200))
      uninstalled.add(d.name)
      return { id: req.id, status: 'uninstalled', leftovers: startLeftovers(d) }
    },
    async uninstallForceScan(id) {
      const d = DEMO_INSTALLED.find((x) => `demo:${x.name}` === id)
      if (!d?.missing) return { id: String(id), status: 'protected', leftovers: [] }
      await new Promise((r) => setTimeout(r, 1200))
      uninstalled.add(d.name)
      return { id, status: 'uninstalled', leftovers: startLeftovers(d) }
    },
    async uninstallClean(req) {
      const session = leftoverSessions.get(req.appId) ?? []
      await new Promise((r) => setTimeout(r, 900))
      const picked = session.filter((l) => req.ids.includes(l.id))
      leftoverSessions.set(req.appId, session.filter((l) => !req.ids.includes(l.id)))
      return {
        outcomes: req.ids.map((id) => ({ id, status: picked.some((l) => l.id === id) ? ('removed' as const) : ('failed' as const), error: picked.some((l) => l.id === id) ? undefined : 'unknown' })),
        recycledBytes: picked.reduce((s, l) => s + l.sizeBytes, 0),
        backupDir: picked.some((l) => l.kind.startsWith('registry') || l.kind === 'task') ? 'C:\\Users\\demo\\AppData\\Roaming\\RePID Identity\\uninstall-backups' : undefined
      }
    },
    async uninstallScanOrphans() {
      await new Promise((r) => setTimeout(r, 1800))
      const list = DEMO_ORPHANS.map((l, i) => ({ ...l, id: `o${i}${Math.random().toString(36).slice(2, 8)}` }))
      leftoverSessions.set('orphans', list)
      return { id: 'orphans', status: 'uninstalled', leftovers: list }
    },
    async uninstallOpenBackups() {},
    async openRepo(path = '') {
      const suffix: Record<string, string> = {
        stargazers: '/stargazers',
        issues: '/issues/new/choose',
        releases: '/releases',
        contributing: '/blob/main/CONTRIBUTING.md',
        translate: '/blob/main/docs/ADDING_A_LANGUAGE.md'
      }
      window.open(REPO_URL + (suffix[path] ?? ''), '_blank', 'noopener,noreferrer')
    },
    async edition() {
      return { edition: 'free' as const, limited: false, corporate: false, corporateSignals: [], lanInstalls: 1, lanLimit: 5 }
    },
    async activateLicense() {
      return { ok: false, error: 'free-edition' as const, state: await this.edition() }
    },
    async removeLicense() {
      return this.edition()
    },
    async contactEnterprise() {
      return false
    },
    async openEnterpriseBuy() {
      window.open(ENTERPRISE_BUY_URL, '_blank', 'noopener,noreferrer')
    },
    async checkAppUpdate() {
      return { current: '1.5.0', latest: '1.5.0', available: false, checkedAt: Date.now() }
    },
    async openRelease() {
      window.open(`${REPO_URL}/releases/tag/win-release`, '_blank', 'noopener,noreferrer')
    },
    async openDonate() {
      window.open(DONATE_URL, '_blank', 'noopener,noreferrer')
    },
    async relaunchElevated() {
      return false
    },
    async setTitleBarTheme() {}
  }
}
