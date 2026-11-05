import type { AppGroup, BoostProfileId, Category } from '../types'
import { clusterKey } from './classifier'

/**
 * Performance mode never closes anything: it lowers the priority of
 * background apps (plus Windows 11 EcoQoS) and optionally raises one focus
 * app to above-normal. These rules decide which apps may be touched at all.
 */

/** OS plumbing, hosted services and security software keep their priority. */
const UNTOUCHABLE: ReadonlySet<Category> = new Set(['system', 'service', 'security'])

export function boostKey(group: Pick<AppGroup, 'name' | 'command'>): string {
  return clusterKey(group.name, group.command)
}

export function isEcoEligible(group: AppGroup): boolean {
  return (
    group.risk === 'safe' &&
    group.services.length === 0 &&
    !UNTOUCHABLE.has(group.identity.category) &&
    group.identity.catalogId !== 'repid'
  )
}

export function isFocusEligible(group: AppGroup): boolean {
  return group.risk !== 'critical' && !UNTOUCHABLE.has(group.identity.category) && group.identity.catalogId !== 'repid'
}

interface ProfileDef {
  /** Offers a focus app that gets above-normal priority. */
  focus: boolean
  /** Categories pre-selected for efficiency mode. Others are listed but left unchecked. */
  suggest: ReadonlySet<Category>
}

/**
 * Game launchers, overlays, voice chat and media stay untouched while gaming:
 * throttling them causes overlay lag or choppy voice. Unknown apps are never
 * pre-selected either — an unrecognised app may be the game itself — and
 * neither are running scripts or containers (a training job, a local server):
 * those are deliberate work the user starts, so only they decide.
 */
export const BOOST_PROFILES: Record<Exclude<BoostProfileId, 'custom'>, ProfileDef> = {
  gaming: { focus: true, suggest: new Set(['browser', 'cloud', 'updater', 'office', 'development', 'background']) },
  work: { focus: false, suggest: new Set(['gaming', 'updater', 'background']) },
  creative: { focus: true, suggest: new Set(['browser', 'communication', 'gaming', 'media', 'cloud', 'updater', 'office', 'background']) }
}

const MB = 1024 ** 2
/** Below this an app is idle; listing it would only add noise. */
const LIST_MIN = { cpu: 0.1, mem: 50 * MB }
/** Worth pre-selecting: it actually competes for CPU or holds a lot of memory. */
const SUGGEST_MIN = { cpu: 0.5, mem: 150 * MB }

export interface BoostCandidate {
  group: AppGroup
  recommended: boolean
}

export interface BoostPlan {
  candidates: BoostCandidate[]
  focusOptions: AppGroup[]
  /** Running apps RePID will not touch (OS, services, security, caution). */
  protectedCount: number
}

export function planBoost(groups: AppGroup[], profile: BoostProfileId, focusGroupId?: string): BoostPlan {
  const def = profile === 'custom' ? null : BOOST_PROFILES[profile]
  const focusKey = groups.find((g) => g.id === focusGroupId)
  const sameAsFocus = (g: AppGroup) => !!focusKey && boostKey(g) === boostKey(focusKey)
  const candidates: BoostCandidate[] = []
  let protectedCount = 0
  for (const g of groups) {
    if (!isEcoEligible(g)) {
      protectedCount++
      continue
    }
    if (sameAsFocus(g) || (g.cpu < LIST_MIN.cpu && g.memBytes < LIST_MIN.mem)) continue
    const heavy = g.cpu >= SUGGEST_MIN.cpu || g.memBytes >= SUGGEST_MIN.mem
    candidates.push({ group: g, recommended: !!def && heavy && def.suggest.has(g.identity.category) })
  }
  candidates.sort((a, b) => Number(b.recommended) - Number(a.recommended) || b.group.impact - a.group.impact)
  const focusOptions = !def || def.focus ? groups.filter(isFocusEligible).filter((g) => g.cpu >= LIST_MIN.cpu || g.memBytes >= LIST_MIN.mem) : []
  return { candidates, focusOptions, protectedCount }
}
