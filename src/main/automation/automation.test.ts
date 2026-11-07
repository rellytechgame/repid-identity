import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppGroup, BoostState, CleanerReport, CleanRequest } from '../../shared/types'
import { Automation } from './index'

vi.mock('systeminformation', () => ({ default: { fsSize: async () => [] } }))

const group = (id: string, name: string, path: string, risk: AppGroup['risk'] = 'safe', memBytes = 2e9): AppGroup =>
  ({ id, name, path, risk, memBytes, cpu: 20, gpu: 0, pids: [1], rootPid: 1, descendantPids: [], command: path, user: 'u', impact: 50, services: [], identity: { category: 'application' } }) as AppGroup

describe('automation (fake engine, real scheduler logic)', () => {
  let dir: string
  let groups: AppGroup[]
  let boost: BoostState
  let applied: unknown[]
  let cleaned: CleanRequest[]
  let notes: string[]

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'repid-auto-'))
    groups = []
    boost = { active: false, apps: [], focusSupported: true, restorePending: false }
    applied = []
    cleaned = []
    notes = []
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  const make = () =>
    new Automation({
      engine: { current: async () => ({ procs: [], groups }) } as never,
      booster: {
        status: async () => boost,
        apply: async (req: unknown) => {
          applied.push(req)
          boost = { ...boost, active: true, apps: [{ key: 'k', name: 'x', role: 'focus', groupIds: [], pids: [] }] as never }
          return boost
        },
        stop: async () => {
          boost = { ...boost, active: false, apps: [] }
          return boost
        }
      } as never,
      cleaner: {
        scan: async (): Promise<CleanerReport> => ({
          elevated: false,
          scannedAt: 0,
          targets: [
            { id: 'user-temp', risk: 'safe', defaultSelected: true, available: true, sizeBytes: 5e8, blockedBy: [], requiresAdmin: false },
            { id: 'browser:chrome:history', risk: 'sensitive', defaultSelected: false, available: true, sizeBytes: 1e8, blockedBy: [], requiresAdmin: false },
            { id: 'browser:chrome:cache', risk: 'safe', defaultSelected: true, available: true, sizeBytes: 3e8, blockedBy: ['chrome'], requiresAdmin: false },
            { id: 'windows-temp', risk: 'safe', defaultSelected: true, available: true, sizeBytes: 2e8, blockedBy: [], requiresAdmin: true },
            { id: 'windows-old', risk: 'caution', defaultSelected: false, available: true, sizeBytes: 9e9, blockedBy: [], requiresAdmin: true }
          ] as never
        }),
        clean: async (req: CleanRequest) => {
          cleaned.push(req)
          return { freedBytes: 5e8, outcomes: [{ id: 'user-temp', status: 'cleaned', freedBytes: 5e8, removed: 10, skipped: 0 }] }
        }
      } as never,
      configPath: path.join(dir, 'automation.json'),
      language: () => 'es',
      applyBackground: () => undefined,
      notify: (title) => notes.push(title)
    })
  const tick = (a: Automation) => (a as unknown as { tick: () => Promise<void> }).tick()

  it('boosts a game while it runs, then restores everything when it closes', async () => {
    const a = make()
    await a.set({ autoBoost: { enabled: true, games: true, apps: [] } })
    groups = [group('chrome', 'chrome', 'C:\\Program Files\\Google\\Chrome\\chrome.exe'), group('steam', 'steam', 'C:\\Program Files (x86)\\Steam\\steam.exe')]
    await tick(a)
    expect(applied).toHaveLength(0)

    groups.push(group('hades', 'Hades', 'D:\\SteamLibrary\\steamapps\\common\\Hades\\x64\\Hades.exe'))
    await tick(a)
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ profile: 'gaming', focusGroupId: 'hades' })
    expect(a.state().autoBoosting).toBe('Hades')
    expect(notes).toEqual(['Modo rendimiento activado'])

    groups = groups.filter((g) => g.id !== 'hades')
    await tick(a)
    expect(boost.active).toBe(false)
    expect(a.state().autoBoosting).toBeUndefined()
    expect(a.state().events.map((e) => e.kind)).toEqual(['boost-off', 'boost-on'])
  })

  it('never overrides a boost the user started, and respects a manual stop', async () => {
    const a = make()
    await a.set({ autoBoost: { enabled: true, games: true, apps: ['blender'] } })
    boost = { ...boost, active: true }
    groups = [group('blender', 'blender.exe', 'C:\\Program Files\\Blender\\blender.exe')]
    await tick(a)
    expect(applied).toHaveLength(0)

    boost = { ...boost, active: false }
    await tick(a)
    expect(applied).toHaveLength(1)
    // User stops it by hand while Blender is still open: automation must not turn it back on.
    boost = { ...boost, active: false }
    await tick(a)
    await tick(a)
    expect(applied).toHaveLength(1)
    // Blender closes and opens again: automation may help again.
    groups = []
    await tick(a)
    groups = [group('blender2', 'blender.exe', 'C:\\Program Files\\Blender\\blender.exe')]
    await tick(a)
    expect(applied).toHaveLength(2)
  })

  it('scheduled cleanup: waits one full interval, then cleans only safe, unblocked, non-admin targets', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 6, 12), toFake: ['Date'] })
    try {
      const a = make()
      await a.set({ scheduledClean: { enabled: true, frequency: 'daily' } })
      vi.setSystemTime(Date.UTC(2026, 10, 6, 20))
      await tick(a)
      expect(cleaned).toHaveLength(0)

      vi.setSystemTime(Date.UTC(2026, 10, 7, 13))
      await tick(a)
      expect(cleaned).toEqual([{ ids: ['user-temp'], closeBlocking: false, acknowledgedSensitive: false }])
      const saved = JSON.parse(await readFile(path.join(dir, 'automation.json'), 'utf8'))
      expect(saved.scheduledClean.lastRun).toBe(Date.UTC(2026, 10, 7, 13))
      expect(notes).toEqual(['Limpieza programada terminada'])

      await tick(a)
      expect(cleaned).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
