import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import si from 'systeminformation'
import type { AppGroup, AutomationConfig, AutomationEvent, AutomationState } from '../../shared/types'
import { boostKey, planBoost } from '../../shared/engine/boost'
import { CLEAN_INTERVAL, DEFAULT_AUTOMATION, detectGrowth, isGamePath, nextCleanAt, normalizeAppName, sanitizeAutomation, type MemSample } from '../../shared/engine/automation'
import type { Booster } from '../boost'
import type { Cleaner } from '../cleaner'
import type { Engine } from '../engine'
import { message, type MessageKey } from './messages'

const TICK_MS = 15_000
const SAMPLE_EVERY_MS = 60_000
const DISK_EVERY_MS = 10 * 60_000
const GROWTH_REPEAT_MS = 2 * 3600_000
const DISK_REPEAT_MS = 12 * 3600_000
const MAX_EVENTS = 40
/** Scheduled cleaning waits until RePID has been open this long (not during start-up). */
const CLEAN_GRACE_MS = 5 * 60_000

export interface AutomationDeps {
  engine: Engine
  booster: Booster
  cleaner: Cleaner
  configPath: string
  notify: (title: string, body: string, view: string) => void
  language: () => string
  /** Applies tray / login-item settings (owned by the main window code). */
  applyBackground: (cfg: AutomationConfig['background']) => void
}

/**
 * Background helper: boosts games and chosen apps while they run, cleans the
 * safe targets on a schedule, and warns about runaway memory and full disks.
 * Everything here reuses the same guarded modules the UI uses.
 */
export class Automation {
  private config: AutomationConfig = structuredClone(DEFAULT_AUTOMATION)
  private events: AutomationEvent[] = []
  private timer: NodeJS.Timeout | null = null
  private ticking = false
  private readonly startedAt = Date.now()
  /** Boost started by automation: the app's cluster key and display name. */
  private auto: { key: string; name: string } | null = null
  /** User stopped an automatic boost: do not restart it until that app closes. */
  private suppressed = new Set<string>()
  private samples = new Map<string, { name: string; list: MemSample[] }>()
  private lastSample = 0
  private lastDisk = 0
  private warned = new Map<string, number>()

  constructor(private readonly deps: AutomationDeps) {}

  async start(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.deps.configPath, 'utf8')) as AutomationConfig
      this.config = sanitizeAutomation(raw)
      // The UI can never set lastRun; only the saved file carries it.
      if (typeof raw.scheduledClean?.lastRun === 'number') this.config.scheduledClean.lastRun = raw.scheduledClean.lastRun
    } catch {
      this.config = structuredClone(DEFAULT_AUTOMATION)
    }
    this.deps.applyBackground(this.config.background)
    this.timer = setInterval(() => void this.tick(), TICK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  get keepInTray(): boolean {
    return this.config.background.keepInTray
  }

  state(): AutomationState {
    return {
      config: this.config,
      events: [...this.events].reverse(),
      autoBoosting: this.auto?.name,
      nextCleanAt: nextCleanAt(this.config.scheduledClean),
      loginItemSupported: process.platform === 'win32' || process.platform === 'darwin'
    }
  }

  async set(raw: unknown): Promise<AutomationState> {
    const next = sanitizeAutomation(raw, this.config)
    // Turning the schedule on starts counting from now: the first run is one interval later, never immediately.
    if (next.scheduledClean.enabled && !this.config.scheduledClean.enabled) next.scheduledClean.lastRun = Date.now()
    const turnedOffBoost = this.config.autoBoost.enabled && !next.autoBoost.enabled
    this.config = next
    await this.save()
    this.deps.applyBackground(next.background)
    if (turnedOffBoost && this.auto) await this.endAutoBoost(false)
    return this.state()
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.deps.configPath), { recursive: true })
    const tmp = `${this.deps.configPath}.tmp`
    await writeFile(tmp, JSON.stringify(this.config, null, 2), 'utf8')
    await rename(tmp, this.deps.configPath)
  }

  private log(kind: AutomationEvent['kind'], params: Record<string, string>, notifyKey?: MessageKey, view = 'automation'): void {
    this.events.push({ at: Date.now(), kind, params })
    if (this.events.length > MAX_EVENTS) this.events.shift()
    if (notifyKey) {
      const { title, body } = message(this.deps.language(), notifyKey, params)
      this.deps.notify(title, body, view)
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      const needGroups = this.config.autoBoost.enabled || this.auto || this.config.alerts.memoryGrowth
      const groups = needGroups ? (await this.deps.engine.current(5000)).groups : []
      if (this.config.autoBoost.enabled || this.auto) await this.autoBoost(groups)
      if (this.config.alerts.memoryGrowth) this.watchMemory(groups)
      if (this.config.alerts.diskLow && Date.now() - this.lastDisk >= DISK_EVERY_MS) await this.watchDisks()
      await this.scheduledClean()
    } catch (err) {
      this.log('error', { message: err instanceof Error ? err.message : String(err) })
    } finally {
      this.ticking = false
    }
  }

  private isTrigger(g: AppGroup): boolean {
    const { games, apps } = this.config.autoBoost
    if (g.risk !== 'safe') return false
    return (games && isGamePath(g.path)) || apps.includes(normalizeAppName(g.name))
  }

  private async autoBoost(groups: AppGroup[]): Promise<void> {
    const status = await this.deps.booster.status()
    if (this.auto) {
      const stillRunning = groups.some((g) => boostKey(g) === this.auto!.key)
      if (!status.active) {
        // The user stopped it by hand: respect that until the app closes.
        this.suppressed.add(this.auto.key)
        this.auto = null
      } else if (!stillRunning || !this.config.autoBoost.enabled) {
        await this.endAutoBoost(true)
      }
      return
    }
    const running = new Set(groups.map(boostKey))
    for (const key of this.suppressed) if (!running.has(key)) this.suppressed.delete(key)
    // Never override a boost the user started.
    if (status.active || !this.config.autoBoost.enabled) return
    const trigger = groups.filter((g) => this.isTrigger(g) && !this.suppressed.has(boostKey(g))).sort((a, b) => b.memBytes - a.memBytes)[0]
    if (!trigger) return
    const plan = planBoost(groups, 'gaming', trigger.id)
    const eco = plan.candidates.filter((c) => c.recommended).map((c) => c.group.id)
    const state = await this.deps.booster.apply({ profile: 'gaming', focusGroupId: trigger.id, ecoGroupIds: eco })
    if (!state.active) return
    const name = trigger.identity.product ?? trigger.name
    this.auto = { key: boostKey(trigger), name }
    this.log('boost-on', { name, count: String(state.apps.length) }, 'boostOn', 'boost')
  }

  private async endAutoBoost(announce: boolean): Promise<void> {
    const name = this.auto?.name ?? ''
    this.auto = null
    await this.deps.booster.stop()
    if (announce) this.log('boost-off', { name }, undefined)
  }

  private watchMemory(groups: AppGroup[]): void {
    const now = Date.now()
    if (now - this.lastSample < SAMPLE_EVERY_MS) return
    this.lastSample = now
    const seen = new Set<string>()
    for (const g of groups) {
      if (g.risk === 'critical') continue
      const key = boostKey(g)
      seen.add(key)
      const entry = this.samples.get(key) ?? { name: g.identity.product ?? g.name, list: [] }
      entry.list.push({ at: now, bytes: g.memBytes })
      entry.list = entry.list.filter((s) => now - s.at <= 45 * 60_000)
      this.samples.set(key, entry)
      const growth = detectGrowth(entry.list, now)
      if (growth && now - (this.warned.get(`mem:${key}`) ?? 0) > GROWTH_REPEAT_MS) {
        this.warned.set(`mem:${key}`, now)
        this.log('memory-growth', { name: entry.name, from: gib(growth.from), to: gib(growth.to) }, 'memoryGrowth', 'processes')
      }
    }
    for (const key of this.samples.keys()) if (!seen.has(key)) this.samples.delete(key)
  }

  private async watchDisks(): Promise<void> {
    this.lastDisk = Date.now()
    const list = await si.fsSize().catch(() => [])
    for (const fs of list) {
      if (fs.size < 4 * 1024 ** 3 || /tmpfs|devtmpfs|overlay|squashfs/i.test(fs.type)) continue
      const pct = (fs.used / fs.size) * 100
      if (pct < this.config.alerts.diskThreshold) continue
      const key = `disk:${fs.mount}`
      if (Date.now() - (this.warned.get(key) ?? 0) < DISK_REPEAT_MS) continue
      this.warned.set(key, Date.now())
      this.log('disk-low', { drive: fs.mount, pct: String(Math.round(pct)), free: gib(fs.available) }, 'diskLow', 'disk')
    }
  }

  private async scheduledClean(): Promise<void> {
    const cfg = this.config.scheduledClean
    if (!cfg.enabled || Date.now() - this.startedAt < CLEAN_GRACE_MS) return
    if (Date.now() - (cfg.lastRun ?? 0) < CLEAN_INTERVAL[cfg.frequency]) return
    // Do not compete with a game or a boosted app.
    if (this.auto || (await this.deps.booster.status()).active) return
    cfg.lastRun = Date.now()
    await this.save()
    const report = await this.deps.cleaner.scan()
    // Only what RePID itself marks safe and pre-selected; never sensitive data, never anything an open app is using.
    const ids = report.targets
      .filter((t) => t.available && t.defaultSelected && t.risk === 'safe' && t.sizeBytes > 0 && !t.blockedBy.length && (!t.requiresAdmin || report.elevated))
      .map((t) => t.id)
    if (!ids.length) return
    const result = await this.deps.cleaner.clean({ ids, closeBlocking: false, acknowledgedSensitive: false })
    this.log('clean', { size: gib(result.freedBytes), count: String(result.outcomes.filter((o) => o.status === 'cleaned' || o.status === 'partial').length) }, 'cleaned', 'cleaner')
  }
}

function gib(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}
