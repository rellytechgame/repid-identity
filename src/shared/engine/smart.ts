import type { AppGroup, Category } from '../types'

/** Categories Smart Free never proposes: ending them rarely helps and often hurts. */
const NEVER_SUGGEST: ReadonlySet<Category> = new Set(['system', 'security', 'service'])

export interface SmartFreeOptions {
  /** Minimum impact score (0–100) for a group to be suggested. */
  threshold: number
  limit?: number
}

/**
 * Picks the apps worth ending to reclaim resources: user-level, unprotected,
 * above the impact threshold, heaviest first. Only suggests — the user confirms.
 */
export function suggestTargets(groups: AppGroup[], { threshold, limit = 6 }: SmartFreeOptions): AppGroup[] {
  return groups
    .filter((g) => g.risk === 'safe' && !NEVER_SUGGEST.has(g.identity.category) && g.services.length === 0 && g.impact >= threshold)
    .sort((a, b) => b.impact - a.impact)
    .slice(0, limit)
}
