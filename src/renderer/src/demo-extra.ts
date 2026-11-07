import type {
  AppGroup,
  AutomationConfig,
  AutomationEvent,
  DiskFile,
  DiskNode,
  DiskRoot,
  DiskScanResult,
  DuplicateGroup,
  HealthReport,
  NetworkReport,
  RepidApi,
  ServiceEntry,
  TaskProgress,
  UpdateReport
} from '@shared/types'
import { DEFAULT_AUTOMATION, isGamePath, nextCleanAt, sanitizeAutomation } from '@shared/engine/automation'
import { foldTree, suggestKeep } from '@shared/engine/disk'
import { healthFindings } from '@shared/engine/health'

type Extras = Pick<
  RepidApi,
  | 'diskRoots'
  | 'diskScan'
  | 'diskDuplicates'
  | 'diskCancel'
  | 'diskDelete'
  | 'diskReveal'
  | 'onProgress'
  | 'onNavigate'
  | 'automationGet'
  | 'automationSet'
  | 'updatesScan'
  | 'updatesApply'
  | 'healthScan'
  | 'restorePoint'
  | 'networkScan'
  | 'networkBlock'
  | 'servicesScan'
  | 'servicesSet'
>

const GB = 1024 ** 3
const MB = 1024 ** 2
const DAY = 86400000
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const HOME = 'C:\\Users\\demo'

function dir(name: string, gb: number, children?: DiskNode[], system?: boolean): DiskNode {
  const sizeBytes = children ? children.reduce((s, c) => s + c.sizeBytes, 0) : Math.round(gb * GB)
  const fileCount = children ? children.reduce((s, c) => s + c.fileCount, 0) : Math.max(1, Math.round(gb * 900))
  return { name, sizeBytes, fileCount, children, system }
}

const DEMO_TREE = dir(HOME, 0, [
  dir('Videos', 0, [dir('Grabaciones', 38), dir('Vacaciones 2024', 21), dir('Proyectos', 9.5)]),
  dir('Downloads', 0, [dir('Instaladores', 14), dir('ISO', 11), dir('Varios', 4.2)]),
  dir('AppData', 0, [dir('Local', 41, undefined, true), dir('Roaming', 12, undefined, true)], true),
  dir('Pictures', 0, [dir('Fotos', 18), dir('Capturas', 2.4)]),
  dir('Documents', 0, [dir('Trabajo', 6.1), dir('Facturas', 0.8), dir('Juegos guardados', 1.2)]),
  dir('Music', 7.4),
  dir('.gradle', 9, undefined, true),
  dir('Desktop', 3.1)
])

const LARGE: Array<[string, number, number]> = [
  ['Videos\\Grabaciones\\partida-2023-11-02.mp4', 8.6, 640],
  ['Downloads\\ISO\\ubuntu-22.04-desktop-amd64.iso', 4.7, 900],
  ['Downloads\\ISO\\Windows11_23H2.iso', 6.2, 720],
  ['Videos\\Vacaciones 2024\\drone-4k.mov', 3.9, 420],
  ['Downloads\\Instaladores\\Adobe_Premiere_2023.zip', 2.8, 560],
  ['AppData\\Local\\Android\\Sdk\\system-images\\x86_64\\system.img', 4.4, 120],
  ['Videos\\Proyectos\\render-final.mp4', 1.6, 35],
  ['Downloads\\Varios\\backup-telefono.zip', 2.1, 800]
]

const DUPES: Array<Array<[string, number]>> = [
  [['Videos\\Vacaciones 2024\\playa.mp4', 300], ['Downloads\\playa.mp4', 120], ['Desktop\\playa (1).mp4', 40]],
  [['Downloads\\Instaladores\\OBS-Studio-30.0-Windows.exe', 200], ['Downloads\\Instaladores\\OBS-Studio-30.0-Windows (1).exe', 150]],
  [['Pictures\\Fotos\\IMG_2041.HEIC', 500], ['Pictures\\Fotos\\Copia de IMG_2041.HEIC', 480]],
  [['Music\\Album\\01 - Intro.flac', 700], ['Downloads\\01 - Intro.flac', 650]]
]
const DUPE_SIZES = [1.2 * GB, 145 * MB, 4.1 * MB, 38 * MB]

export function createDemoExtras(groupsNow: () => AppGroup[]): Extras {
  const listeners = new Set<(p: TaskProgress) => void>()
  const emit = (p: TaskProgress) => listeners.forEach((l) => l(p))
  let cancelled = false
  const files = new Map<string, DiskFile>()
  let groups: DuplicateGroup[] = []
  let seq = 0
  const file = (rel: string, size: number, ageDays: number, removable = !rel.startsWith('AppData')): DiskFile => {
    const f = { id: `f${(seq++).toString(36)}`, path: `${HOME}\\${rel}`, sizeBytes: size, modified: Date.now() - ageDays * DAY, removable }
    files.set(f.id, f)
    return f
  }

  let automation: AutomationConfig = { ...structuredClone(DEFAULT_AUTOMATION), autoBoost: { enabled: true, games: true, apps: [] } }
  const events: AutomationEvent[] = [
    { at: Date.now() - 3 * 3600000, kind: 'boost-on', params: { name: 'Fortnite', count: '6' } },
    { at: Date.now() - 2 * 3600000, kind: 'boost-off', params: { name: 'Fortnite' } },
    { at: Date.now() - 26 * 3600000, kind: 'memory-growth', params: { name: 'Google Chrome', from: '2.1 GB', to: '4.6 GB' } },
    { at: Date.now() - 4 * DAY, kind: 'clean', params: { size: '3.4 GB', count: '7' } }
  ]

  let updates: UpdateReport['updates'] = [
    { id: 'Mozilla.Firefox', name: 'Mozilla Firefox', current: '119.0', available: '121.0.1', source: 'winget' },
    { id: 'Discord.Discord', name: 'Discord', current: '1.0.9020', available: '1.0.9035', source: 'winget' },
    { id: 'VideoLAN.VLC', name: 'VLC media player', current: '3.0.18', available: '3.0.20', source: 'winget' },
    { id: 'Git.Git', name: 'Git', current: '2.41.0', available: '2.43.0', source: 'winget' },
    { id: 'Python.Python.3.11', name: 'Python 3.11.4 (64-bit)', current: '3.11.4', available: '3.11.7', source: 'winget' },
    { id: 'PostgreSQL.PostgreSQL', name: 'PostgreSQL 15', current: '15.4', available: '16.1', source: 'winget', major: true },
    { id: 'RARLab.WinRAR', name: 'WinRAR 6.02 (64-bit)', current: '6.02.0', available: '7.00.0', source: 'winget', major: true }
  ]

  const services: ServiceEntry[] = [
    ['DiagTrack', 'Experiencias del usuario y telemetría asociadas', 'Microsoft Corporation', 'telemetry', 'auto', 'safe', true, false],
    ['MapsBroker', 'Administrador de mapas descargados', 'Microsoft Corporation', 'maps', 'delayed', 'safe', true, false],
    ['TrkWks', 'Cliente de seguimiento de vínculos distribuidos', 'Microsoft Corporation', 'linkTracking', 'auto', 'safe', true, false],
    ['GoogleUpdaterService', 'Google Updater Service', 'Google LLC', 'updater', 'auto', 'safe', true, true],
    ['AdobeARMservice', 'Adobe Acrobat Update Service', 'Adobe Inc.', 'updater', 'auto', 'safe', true, true],
    ['HpTouchpointAnalyticsService', 'HP Insights Analytics', 'HP Inc.', 'telemetryApp', 'auto', 'safe', true, true],
    ['TeamViewer', 'TeamViewer', 'TeamViewer Germany GmbH', 'remote', 'auto', 'caution', false, true],
    ['MySQL80', 'MySQL80', 'Oracle Corporation', 'database', 'auto', 'caution', false, true],
    ['WSearch', 'Windows Search', 'Microsoft Corporation', 'search', 'delayed', 'caution', false, false],
    ['Spooler', 'Cola de impresión', 'Microsoft Corporation', 'printing', 'auto', 'caution', false, false]
  ].map(([name, displayName, vendor, catalogKey, startMode, risk, recommended, thirdParty]) => ({
    name: name as string,
    displayName: displayName as string,
    vendor: vendor as string,
    catalogKey: catalogKey as string,
    startMode: startMode as ServiceEntry['startMode'],
    risk: risk as ServiceEntry['risk'],
    recommended: recommended as boolean,
    thirdParty: thirdParty as boolean,
    running: true,
    changedByRepid: false
  }))

  const blocked = new Set<string>()

  return {
    async diskRoots(): Promise<DiskRoot[]> {
      return [
        { id: 'home', path: HOME, label: 'demo', kind: 'home' },
        { id: 'drive:1', path: 'C:\\', label: 'C:\\', kind: 'drive', totalBytes: 512 * GB, freeBytes: 61 * GB },
        { id: 'drive:2', path: 'D:\\', label: 'D:\\', kind: 'drive', totalBytes: 1000 * GB, freeBytes: 388 * GB }
      ]
    },
    async diskScan(rootId): Promise<DiskScanResult> {
      cancelled = false
      files.clear()
      groups = []
      const total = DEMO_TREE.fileCount
      for (let i = 1; i <= 10 && !cancelled; i++) {
        await wait(180)
        emit({ task: 'disk-scan', done: Math.round((total * i) / 10), current: `${HOME}\\${['Videos', 'Downloads', 'AppData\\Local', 'Pictures', 'Documents'][i % 5]}` })
      }
      return {
        rootId,
        root: HOME,
        scannedAt: Date.now(),
        durationMs: 1800,
        totalBytes: DEMO_TREE.sizeBytes,
        fileCount: total,
        tree: foldTree(DEMO_TREE),
        largeFiles: LARGE.map(([rel, gb, age]) => file(rel, Math.round(gb * GB), age)).sort((a, b) => b.sizeBytes - a.sizeBytes),
        truncated: cancelled
      }
    },
    async diskDuplicates() {
      for (let i = 1; i <= 8; i++) {
        await wait(160)
        emit({ task: 'duplicates', done: i, total: 8 })
      }
      groups = DUPES.map((set, i) => {
        const list = set.map(([rel, age]) => file(rel, DUPE_SIZES[i], age))
        return { id: `g${i}`, sizeBytes: DUPE_SIZES[i], hash: `9f${i}c41e07ab33d2`, files: list, keepId: suggestKeep(list) }
      })
      return { groups, wastedBytes: groups.reduce((s, g) => s + g.sizeBytes * (g.files.length - 1), 0), hashedBytes: 6 * GB, truncated: false }
    },
    async diskCancel() {
      cancelled = true
    },
    async diskDelete(req) {
      const wanted = new Set(req.ids)
      const refused = groups.flatMap((g) => (g.files.every((f) => wanted.has(f.id)) ? g.files.map((f) => f.id) : []))
      let bytes = 0
      let removed = 0
      for (const id of req.ids) {
        const f = files.get(id)
        if (!f || !f.removable || refused.includes(id)) continue
        bytes += f.sizeBytes
        removed++
        files.delete(id)
      }
      groups = groups.map((g) => ({ ...g, files: g.files.filter((f) => files.has(f.id)) })).filter((g) => g.files.length > 1)
      return { removed, recycledBytes: bytes, failed: [], refused: req.ids.filter((id) => refused.includes(id) || files.get(id)?.removable === false) }
    },
    async diskReveal() {},
    onProgress(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onNavigate() {
      return () => undefined
    },
    async automationGet() {
      const game = groupsNow().find((g) => automation.autoBoost.enabled && isGamePath(g.path))
      return {
        config: automation,
        events: [...events].sort((a, b) => b.at - a.at),
        autoBoosting: game ? (game.identity.product ?? game.name) : undefined,
        nextCleanAt: nextCleanAt(automation.scheduledClean),
        loginItemSupported: true
      }
    },
    async automationSet(cfg) {
      const next = sanitizeAutomation(cfg, automation)
      if (next.scheduledClean.enabled && !automation.scheduledClean.enabled) next.scheduledClean.lastRun = Date.now()
      automation = next
      return this.automationGet()
    },
    async updatesScan() {
      await wait(900)
      return { supported: true, updates, scannedAt: Date.now() }
    },
    async updatesApply(ids) {
      const out = []
      for (const [i, id] of ids.entries()) {
        emit({ task: 'updates', done: i, total: ids.length, current: updates.find((u) => u.id === id)?.name })
        await wait(900)
        out.push({ id, status: 'updated' as const })
      }
      emit({ task: 'updates', done: ids.length, total: ids.length })
      updates = updates.filter((u) => !ids.includes(u.id))
      return out
    },
    async healthScan(): Promise<HealthReport> {
      await wait(500)
      const input = {
        drives: [
          { name: 'NVMe SSD 1TB', media: 'NVMe' as const, sizeBytes: 1000 * GB, status: 'healthy' as const, temperatureC: 41, wearPct: 6, powerOnHours: 3120, readErrors: 0 },
          { name: 'HDD 2TB', media: 'HDD' as const, sizeBytes: 2000 * GB, status: 'healthy' as const, temperatureC: 36, powerOnHours: 15820, readErrors: 0 }
        ],
        volumes: [
          { mount: 'C:', sizeBytes: 512 * GB, usedBytes: 451 * GB },
          { mount: 'D:', sizeBytes: 1000 * GB, usedBytes: 612 * GB }
        ],
        battery: { capacityPct: 78, designMWh: 56000, fullMWh: 43700, cycles: 412, percent: 64, charging: false },
        cpuTempC: 58,
        gpuTempC: 47,
        uptimeSec: 9 * 86400 + 5 * 3600
      }
      return { ...input, elevated: true, findings: healthFindings(input), scannedAt: Date.now() }
    },
    async restorePoint() {
      await wait(1200)
      return { status: 'created' }
    },
    async networkScan(): Promise<NetworkReport> {
      const pick = (re: RegExp) => groupsNow().find((g) => re.test(g.name))
      const apps = [
        [pick(/chrome/i), 38, [], ['142.250.184.14:443', '151.101.1.69:443', '104.18.32.7:443']],
        [pick(/discord/i), 6, [], ['162.159.135.234:443', '35.214.140.2:50004']],
        [pick(/onedrive/i), 3, [], ['13.107.42.12:443']],
        [pick(/steam/i), 9, [27036], ['155.133.248.36:27021', '23.62.230.28:443']],
        [pick(/svchost/i), 4, [135, 5040], ['20.42.65.92:443']]
      ]
        .filter(([g]) => g)
        .map(([g, n, listening, remotes]) => {
          const group = g as AppGroup
          return {
            groupId: group.id,
            name: group.name,
            product: group.identity.product,
            connections: n as number,
            listening: listening as number[],
            remotes: remotes as string[],
            risk: group.risk,
            blocked: blocked.has(group.id),
            blockable: group.risk !== 'critical'
          }
        })
      const jitter = () => 0.6 + Math.random() * 0.8
      return { apps, blockedIdle: [], rxBytesPerSec: 2.4 * MB * jitter(), txBytesPerSec: 180 * 1024 * jitter(), blockSupported: true, elevated: true, scannedAt: Date.now() }
    },
    async networkBlock(req) {
      if (!req.groupId) return { status: 'unblocked' }
      if (req.block) blocked.add(req.groupId)
      else blocked.delete(req.groupId)
      return { status: req.block ? 'blocked' : 'unblocked' }
    },
    async servicesScan() {
      await wait(400)
      return { supported: true, elevated: true, services: [...services], scannedAt: Date.now() }
    },
    async servicesSet(req) {
      return req.names.map((name) => {
        const s = services.find((x) => x.name === name)
        if (!s) return { name, status: 'not-found' as const }
        if (req.restore) {
          s.startMode = s.originalMode ?? 'auto'
          s.changedByRepid = false
          s.originalMode = undefined
        } else {
          s.originalMode = s.startMode === 'delayed' ? 'delayed' : 'auto'
          s.startMode = 'manual'
          s.changedByRepid = true
          s.recommended = false
        }
        return { name, status: 'changed' as const }
      })
    }
  }
}
