import os from 'node:os'
import type { BoostApp, BoostProfileId, BoostRequest, BoostState } from '../../shared/types'
import { boostKey, isEcoEligible, isFocusEligible } from '../../shared/engine/boost'
import { normalizeName } from '../../shared/engine/protection'
import type { Engine } from '../engine'
import { runElevated, wasCancelled } from '../engine/privileges'
import { EcoQos } from './ecoqos'

const PROFILES = new Set<BoostProfileId>(['gaming', 'work', 'creative', 'custom'])
const MAX_GROUPS = 300
const TICK_MS = 4000
const { PRIORITY_BELOW_NORMAL, PRIORITY_ABOVE_NORMAL } = os.constants.priority

interface Target {
  role: 'eco' | 'focus'
  name: string
  product?: string
}

interface Tracked {
  pid: number
  /** Normalized process name: guards against pid reuse before restoring. */
  name: string
  key: string
  role: 'eco' | 'focus'
  /** Priority before RePID touched it (Node scale: lower = higher priority). */
  original: number
  priorityChanged: boolean
  ecoQos: boolean
  refused: boolean
}

function isGroupId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 300
}

export function parseBoostRequest(raw: unknown): BoostRequest {
  const req = raw as Partial<BoostRequest> | null
  if (
    !req ||
    !PROFILES.has(req.profile as BoostProfileId) ||
    !Array.isArray(req.ecoGroupIds) ||
    req.ecoGroupIds.length > MAX_GROUPS ||
    !req.ecoGroupIds.every(isGroupId) ||
    (req.focusGroupId !== undefined && !isGroupId(req.focusGroupId))
  ) {
    throw new Error('Invalid boost request')
  }
  return { profile: req.profile as BoostProfileId, focusGroupId: req.focusGroupId, ecoGroupIds: [...new Set(req.ecoGroupIds)] }
}

/**
 * Performance mode. Lowers background apps to below-normal priority (plus
 * EcoQoS on Windows 11) and can raise one focus app to above-normal — never
 * "high" or "realtime", which can starve input and audio. Nothing is closed.
 *
 * Targets are remembered by cluster key, so processes an app starts later
 * (new browser tabs) are adjusted on the next tick. Every change is recorded
 * with the original value and undone on stop, on quit, or when the user
 * changes the selection.
 */
export class Booster {
  private targets = new Map<string, Target>()
  private tracked = new Map<number, Tracked>()
  private profile?: BoostProfileId
  private startedAt?: number
  private timer: NodeJS.Timeout | null = null
  private ticking = false
  private restorePending = false
  private readonly ecoQos = process.platform === 'win32' ? new EcoQos() : null
  /** Raising priority needs root on macOS/Linux; RePID never runs its UI as root there. */
  private readonly focusSupported = process.platform === 'win32'

  constructor(private readonly engine: Engine) {}

  get active(): boolean {
    return this.targets.size > 0
  }

  async apply(raw: unknown): Promise<BoostState> {
    const req = parseBoostRequest(raw)
    const { groups } = await this.engine.current(0)
    const byId = new Map(groups.map((g) => [g.id, g]))
    const next = new Map<string, Target>()

    const focus = req.focusGroupId ? byId.get(req.focusGroupId) : undefined
    if (focus && this.focusSupported && isFocusEligible(focus)) {
      next.set(boostKey(focus), { role: 'focus', name: focus.name, product: focus.identity.product })
    }
    for (const id of req.ecoGroupIds) {
      const g = byId.get(id)
      if (!g || !isEcoEligible(g)) continue
      const key = boostKey(g)
      if (!next.has(key)) next.set(key, { role: 'eco', name: g.name, product: g.identity.product })
    }
    if (!next.size) return this.stop()

    // Undo processes whose app left the selection or switched role before applying the new plan.
    await this.restore([...this.tracked.values()].filter((t) => next.get(t.key)?.role !== t.role))
    this.targets = next
    this.profile = req.profile
    this.startedAt ??= Date.now()
    await this.tick()
    this.timer ??= setInterval(() => void this.tick(), TICK_MS)
    return this.status()
  }

  async stop(): Promise<BoostState> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.targets.clear()
    await this.restore([...this.tracked.values()])
    this.profile = undefined
    this.startedAt = undefined
    this.ecoQos?.dispose()
    return this.status()
  }

  async status(): Promise<BoostState> {
    const groups = this.active ? (await this.engine.current()).groups : []
    const apps: BoostApp[] = []
    for (const [key, target] of this.targets) {
      const matching = groups.filter((g) => boostKey(g) === key)
      const mine = [...this.tracked.values()].filter((t) => t.key === key)
      apps.push({
        key,
        name: target.name,
        product: target.product,
        role: target.role,
        groupIds: matching.map((g) => g.id),
        applied: mine.filter((t) => !t.refused).length,
        refused: mine.filter((t) => t.refused).length,
        ecoQos: mine.some((t) => t.ecoQos),
        cpu: Math.round(matching.reduce((s, g) => s + g.cpu, 0) * 10) / 10,
        memBytes: matching.reduce((s, g) => s + g.memBytes, 0)
      })
    }
    apps.sort((a, b) => (a.role === b.role ? b.cpu - a.cpu : a.role === 'focus' ? -1 : 1))
    return { active: this.active, profile: this.profile, startedAt: this.startedAt, apps, focusSupported: this.focusSupported, restorePending: this.restorePending }
  }

  /** Applies the plan to processes not adjusted yet (new pids) and forgets exited ones. */
  private async tick(): Promise<void> {
    if (!this.active || this.ticking) return
    this.ticking = true
    try {
      const { procs, groups } = await this.engine.current()
      const alive = new Map(procs.map((p) => [p.pid, normalizeName(p.name)]))
      for (const [pid, t] of this.tracked) if (alive.get(pid) !== t.name) this.tracked.delete(pid)

      const ecoBatch: Tracked[] = []
      for (const g of groups) {
        const key = boostKey(g)
        const target = this.targets.get(key)
        // Re-checked every tick: the user may have protected the app since.
        if (!target || !(target.role === 'eco' ? isEcoEligible(g) : isFocusEligible(g))) continue
        for (const pid of g.pids) {
          if (this.tracked.has(pid)) continue
          const t = this.adjust(pid, alive.get(pid) ?? normalizeName(g.name), key, target.role)
          this.tracked.set(pid, t)
          if (t.role === 'eco' && !t.refused) ecoBatch.push(t)
        }
      }
      if (this.ecoQos && ecoBatch.length) {
        const res = await this.ecoQos.set(ecoBatch.map((t) => ({ pid: t.pid, on: true })))
        for (const t of ecoBatch) t.ecoQos = res.get(t.pid) === 0
      }
    } catch {
      // A failed sample is retried on the next tick.
    } finally {
      this.ticking = false
    }
  }

  private adjust(pid: number, name: string, key: string, role: Tracked['role']): Tracked {
    const t: Tracked = { pid, name, key, role, original: 0, priorityChanged: false, ecoQos: false, refused: false }
    try {
      t.original = os.getPriority(pid)
      const want = role === 'eco' ? PRIORITY_BELOW_NORMAL : PRIORITY_ABOVE_NORMAL
      // Never override a choice already stronger than ours (e.g. the user set "low" or "high" by hand).
      const already = role === 'eco' ? t.original >= want : t.original <= want
      if (!already) {
        os.setPriority(pid, want)
        t.priorityChanged = true
      }
    } catch {
      t.refused = true
    }
    return t
  }

  private async restore(list: Tracked[]): Promise<void> {
    if (!list.length) return
    const { procs } = await this.engine.current(0)
    const alive = new Map(procs.map((p) => [p.pid, normalizeName(p.name)]))
    const live = list.filter((t) => alive.get(t.pid) === t.name)

    const eco = live.filter((t) => t.ecoQos)
    if (this.ecoQos && eco.length) await this.ecoQos.set(eco.map((t) => ({ pid: t.pid, on: false })))

    const needRoot: Tracked[] = []
    for (const t of live) {
      if (!t.priorityChanged) continue
      try {
        os.setPriority(t.pid, t.original)
      } catch {
        needRoot.push(t)
      }
    }
    for (const t of list) this.tracked.delete(t.pid)

    // macOS/Linux: an unprivileged process may lower its nice value but not raise it back.
    this.restorePending = false
    if (needRoot.length && process.platform !== 'win32') {
      const byNice = new Map<number, number[]>()
      for (const t of needRoot) byNice.set(t.original, [...(byNice.get(t.original) ?? []), t.pid])
      const lines = [...byNice].map(([nice, pids]) => `renice -n ${Math.trunc(nice)} -p ${pids.map((p) => Math.trunc(p)).join(' ')} 2>/dev/null || true`)
      const res = await runElevated(lines)
      if (!res.ok && wasCancelled(res)) this.restorePending = true
    }
  }
}
