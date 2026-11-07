/** Compares dotted versions numerically ("1.10.0" > "1.9.3"); pre-release suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return Math.sign(d)
  }
  return 0
}

export interface ReleaseInfo {
  name?: string | null
  body?: string | null
  assets?: Array<{ name: string }>
}

const ASSET_VERSION = /RePID[-_. ]?Identity[-_. ]v?(\d+\.\d+\.\d+)/i
const ENTERPRISE_ASSET_VERSION = /RePID[-_. ]?Identity[-_. ]Enterprise[-_. ]v?(\d+\.\d+\.\d+)/i
const TEXT_VERSION = /\bv(\d+\.\d+\.\d+)\b/i

/**
 * The download page is a fixed tag ("win-release") whose installer is
 * replaced on every release, so the version is read from the installer's file
 * name (RePID-Identity-1.4.0-win.exe). Falls back to "v1.4.0" in the release
 * title or notes. Returns the highest version found, or null.
 */
export function latestFromRelease(release: ReleaseInfo, edition: 'free' | 'enterprise' = 'free'): string | null {
  // Each edition only follows its own installer (RePID-Identity-x vs RePID-Identity-Enterprise-x).
  const pattern = edition === 'enterprise' ? ENTERPRISE_ASSET_VERSION : ASSET_VERSION
  const found = (release.assets ?? []).map((a) => a.name.match(pattern)?.[1]).filter((v): v is string => !!v)
  if (!found.length) {
    const text = release.name?.match(TEXT_VERSION)?.[1] ?? release.body?.match(TEXT_VERSION)?.[1]
    if (text) found.push(text)
  }
  return found.sort(compareVersions).at(-1) ?? null
}
