import type {
  CleanOutcome,
  CleanResult,
  CleanerReport,
  CleanerTarget,
  KillOutcome,
  ProcessInfo,
  RepidApi,
  ServiceRef,
  SystemSnapshot
} from '@shared/types'
import { DONATE_URL, REPO_URL } from '@shared/constants'
import { buildGroups, descendantsOf } from '@shared/engine/grouping'
import { riskOf } from '@shared/engine/protection'

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

export function createDemoApi(): RepidApi {
  const seeded = seed()
  let procs = seeded.procs
  const services = seeded.services
  const base = new Map(procs.map((p) => [p.pid, { cpu: p.cpu, mem: p.memBytes, gpu: p.gpu }]))
  const cleaned = new Set<string>()
  const ctx = { platform: 'win32' as const, selfPids: new Set<number>(), userProtected: new Set<string>() }
  let tick = 0

  const jitter = () => {
    tick++
    procs = procs.map((p) => {
      const b = base.get(p.pid)!
      const wave = 1 + 0.35 * Math.sin(tick / 3 + p.pid) + (Math.random() - 0.5) * 0.4
      return {
        ...p,
        cpu: Math.max(0, Math.round(b.cpu * wave * 10) / 10),
        memBytes: Math.round(b.mem * (1 + 0.04 * Math.sin(tick / 5 + p.pid))),
        gpu: b.gpu !== undefined ? Math.max(0, Math.round(b.gpu * wave)) : undefined
      }
    })
  }

  return {
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
    async openDonate() {
      window.open(DONATE_URL, '_blank', 'noopener,noreferrer')
    },
    async relaunchElevated() {
      return false
    },
    async setTitleBarTheme() {}
  }
}
