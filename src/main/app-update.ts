import { net } from 'electron'
import type { AppUpdateInfo } from '../shared/types'
import { RELEASE_API_URL } from '../shared/constants'
import { compareVersions, latestFromRelease, type ReleaseInfo } from '../shared/engine/version'

/** GitHub allows 60 anonymous API calls per hour: never ask more than once every 30 minutes. */
const CACHE_MS = 30 * 60_000
const TIMEOUT_MS = 10_000

/**
 * Asks GitHub which installer the download page currently offers and
 * compares it with this build. Read-only: it never downloads or installs
 * anything; the UI only opens the fixed release page in the browser.
 */
export class AppUpdateChecker {
  private last: AppUpdateInfo | null = null

  constructor(private readonly current: string) {}

  async check(force: unknown): Promise<AppUpdateInfo> {
    if (this.last && force !== true && Date.now() - this.last.checkedAt < CACHE_MS) return this.last
    const base = { current: this.current, checkedAt: Date.now() }
    try {
      const res = await net.fetch(RELEASE_API_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'RePID-Identity' },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      if (!res.ok) throw new Error(`GitHub ${res.status}`)
      const latest = latestFromRelease((await res.json()) as ReleaseInfo)
      this.last = { ...base, latest: latest ?? undefined, available: !!latest && compareVersions(latest, this.current) > 0 }
    } catch (err) {
      // Offline or rate-limited: keep the last good answer if there is one.
      this.last = this.last ? { ...this.last, error: err instanceof Error ? err.message : String(err) } : { ...base, available: false, error: err instanceof Error ? err.message : String(err) }
    }
    return this.last
  }
}
