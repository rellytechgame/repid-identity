import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppUpdateInfo, BoostState, SystemSnapshot, TaskProgress } from '@shared/types'
import { api } from './api'

export type Theme = 'system' | 'dark' | 'light'

export interface Settings {
  language?: string
  theme: Theme
  refreshMs: number
  confirmKill: boolean
  smartThreshold: number
  protectedNames: string[]
  showProtected: boolean
  /** Windows: create a System Restore point before services, uninstall and Windows-update cleanup changes. */
  restorePoints: boolean
  /** Ask GitHub (once at start-up, then every 6 h) whether a newer installer is available. */
  checkUpdates: boolean
  /** Version whose banner the user closed: hidden until an even newer one appears. */
  dismissedUpdate?: string
}

const STORAGE_KEY = 'repid.settings.v1'
const DEFAULTS: Settings = {
  theme: 'system',
  refreshMs: 3000,
  confirmKill: true,
  smartThreshold: 30,
  protectedNames: [],
  showProtected: true,
  restorePoints: true,
  checkUpdates: true
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load)
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // storage unavailable (private mode): settings still apply for this session
      }
      return next
    })
  }, [])
  return { settings, update }
}

export interface HistoryPoint {
  cpu: number
  mem: number
  gpu: number
}

const HISTORY = 60

/** Polls the engine without overlapping requests; pauses while the window is hidden. */
export function useSnapshot(intervalMs: number) {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null)
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)

  const refresh = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      const snap = await api.snapshot()
      setSnapshot(snap)
      setError(null)
      setHistory((h) =>
        [...h, { cpu: snap.cpu.load, mem: (snap.mem.used / snap.mem.total) * 100, gpu: snap.gpu.utilization ?? 0 }].slice(-HISTORY)
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      busy.current = false
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs, refresh])

  return { snapshot, history, error, refresh }
}

export function usePrefersDark(): boolean {
  const query = '(prefers-color-scheme: dark)'
  const [dark, setDark] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return dark
}

const BOOST_IDLE: BoostState = { active: false, apps: [], focusSupported: true, restorePending: false }

/** Performance-mode status, refreshed together with each snapshot. */
export function useBoost(tick: number | undefined) {
  const [boost, setBoost] = useState<BoostState>(BOOST_IDLE)
  const refresh = useCallback(async () => {
    try {
      setBoost(await api.boostStatus())
    } catch {
      // keep the last known state; the next snapshot retries
    }
  }, [])
  useEffect(() => {
    void refresh()
  }, [tick, refresh])
  return { boost, setBoost }
}

/** Latest progress event of one long task (disk scan, duplicates, updates); null when idle. */
export function useProgress(task: TaskProgress['task'] | null) {
  const [progress, setProgress] = useState<TaskProgress | null>(null)
  useEffect(() => {
    setProgress(null)
    if (!task) return
    return api.onProgress((p) => {
      if (p.task === task) setProgress(p)
    })
  }, [task])
  return progress
}

/** Settings live in the renderer; modules that need one flag outside React read it here. */
export function readSetting<K extends keyof Settings>(key: K): Settings[K] {
  return load()[key]
}

const UPDATE_EVERY_MS = 6 * 3600_000

/** New version on the download page: checked at start-up and every 6 hours while RePID stays open. */
export function useAppUpdate(enabled: boolean) {
  const [info, setInfo] = useState<AppUpdateInfo | null>(null)
  const check = useCallback(async (force = false) => {
    try {
      const next = await api.checkAppUpdate(force)
      setInfo(next)
      return next
    } catch {
      return null
    }
  }, [])
  useEffect(() => {
    if (!enabled) return
    void check()
    const id = window.setInterval(() => void check(), UPDATE_EVERY_MS)
    return () => window.clearInterval(id)
  }, [enabled, check])
  return { info, check }
}
