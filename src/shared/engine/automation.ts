import type { AutomationConfig } from '../types'

export const DEFAULT_AUTOMATION: AutomationConfig = {
  autoBoost: { enabled: false, games: true, apps: [] },
  scheduledClean: { enabled: false, frequency: 'weekly' },
  alerts: { memoryGrowth: true, diskLow: true, diskThreshold: 90 },
  background: { keepInTray: false, launchAtLogin: false }
}

const DAY = 24 * 3600 * 1000
export const CLEAN_INTERVAL: Record<AutomationConfig['scheduledClean']['frequency'], number> = { daily: DAY, weekly: 7 * DAY }

/**
 * Game libraries of the main stores. The launchers themselves live outside
 * these folders (Steam\steam.exe, Epic Games\Launcher\…), so only the games
 * match.
 */
const GAME_DIRS = [
  /[\\/]steamapps[\\/]common[\\/]/i,
  /[\\/]epic games[\\/](?!launcher[\\/]|epic online services[\\/])[^\\/]+[\\/]/i,
  /[\\/]gog galaxy[\\/]games[\\/]/i,
  /[\\/]gog games[\\/]/i,
  /^[a-z]:[\\/]xboxgames[\\/]/i,
  /[\\/]ea games[\\/]/i,
  /[\\/]origin games[\\/]/i,
  /[\\/]ubisoft game launcher[\\/]games[\\/]/i,
  /[\\/]riot games[\\/](?!riot client[\\/])[^\\/]+[\\/]/i,
  /[\\/](battle\.net|blizzard)[\\/]games[\\/]/i,
  /[\\/]steam[\\/]steamapps[\\/]/i,
  /\/\.local\/share\/steam\/steamapps\/common\//i,
  /\/library\/application support\/steam\/steamapps\/common\//i
]
/** Helpers that ship inside game folders but are not the game (crash reporters, anti-cheat, redistributables). */
const NOT_GAME = /(crashreport|crashhandler|unitycrashhandler|easyanticheat|battleye|vc_?redist|dxsetup|ueprereq|launcherhelper|cefprocess|webhelper)/i

export function isGamePath(path: string): boolean {
  if (!path || NOT_GAME.test(path)) return false
  return GAME_DIRS.some((re) => re.test(path))
}

/** Process names the user added, compared without extension and case. */
export function normalizeAppName(name: string): string {
  return name.trim().toLowerCase().replace(/\.(exe|app)$/i, '')
}

export interface MemSample {
  at: number
  bytes: number
}

const GIB = 1024 ** 3
export const GROWTH_WINDOW_MS = 30 * 60 * 1000

/**
 * Memory that keeps climbing (a likely leak): at least 1 GiB and +50 % more
 * than 30 minutes ago, now above 1.5 GiB, and the recent samples never fell
 * back to where it started (which rules out a one-off spike that settles).
 */
export function detectGrowth(samples: MemSample[], now: number): { from: number; to: number } | null {
  const old = samples.filter((s) => now - s.at >= GROWTH_WINDOW_MS)
  if (!old.length) return null
  const start = old[old.length - 1]
  const recent = samples.filter((s) => s.at > start.at)
  if (recent.length < 3) return null
  const current = recent[recent.length - 1].bytes
  const grew = current - start.bytes
  if (current < 1.5 * GIB || grew < GIB || current < start.bytes * 1.5) return null
  if (recent.slice(-3).some((s) => s.bytes <= start.bytes)) return null
  return { from: start.bytes, to: current }
}

export function nextCleanAt(cfg: AutomationConfig['scheduledClean']): number | undefined {
  if (!cfg.enabled) return undefined
  return (cfg.lastRun ?? 0) + CLEAN_INTERVAL[cfg.frequency]
}

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)

/** Validates a config coming from the UI or from disk; unknown fields are dropped. */
export function sanitizeAutomation(raw: unknown, previous: AutomationConfig = DEFAULT_AUTOMATION): AutomationConfig {
  const r = (raw ?? {}) as Partial<AutomationConfig>
  const ab = (r.autoBoost ?? {}) as Partial<AutomationConfig['autoBoost']>
  const sc = (r.scheduledClean ?? {}) as Partial<AutomationConfig['scheduledClean']>
  const al = (r.alerts ?? {}) as Partial<AutomationConfig['alerts']>
  const bg = (r.background ?? {}) as Partial<AutomationConfig['background']>
  const apps = Array.isArray(ab.apps)
    ? [...new Set(ab.apps.filter((a): a is string => typeof a === 'string' && /^[\w .+()-]{1,64}$/.test(a.trim())).map(normalizeAppName))].slice(0, 30)
    : previous.autoBoost.apps
  const threshold = Number(al.diskThreshold)
  return {
    autoBoost: { enabled: bool(ab.enabled, previous.autoBoost.enabled), games: bool(ab.games, previous.autoBoost.games), apps },
    scheduledClean: {
      enabled: bool(sc.enabled, previous.scheduledClean.enabled),
      frequency: sc.frequency === 'daily' || sc.frequency === 'weekly' ? sc.frequency : previous.scheduledClean.frequency,
      // Never taken from the UI: only the scheduler writes it.
      lastRun: previous.scheduledClean.lastRun
    },
    alerts: {
      memoryGrowth: bool(al.memoryGrowth, previous.alerts.memoryGrowth),
      diskLow: bool(al.diskLow, previous.alerts.diskLow),
      diskThreshold: Number.isFinite(threshold) ? Math.min(98, Math.max(70, Math.round(threshold))) : previous.alerts.diskThreshold
    },
    background: { keepInTray: bool(bg.keepInTray, previous.background.keepInTray), launchAtLogin: bool(bg.launchAtLogin, previous.background.launchAtLogin) }
  }
}
