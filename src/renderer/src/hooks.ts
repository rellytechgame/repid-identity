import { useCallback, useEffect, useRef, useState } from 'react'
import type { SystemSnapshot } from '@shared/types'
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
}

const STORAGE_KEY = 'repid.settings.v1'
const DEFAULTS: Settings = {
  theme: 'system',
  refreshMs: 3000,
  confirmKill: true,
  smartThreshold: 30,
  protectedNames: [],
  showProtected: true
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
