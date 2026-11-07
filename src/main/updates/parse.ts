import type { AppUpdate } from '../../shared/types'

/** First numeric component of a version ("py310_23.5" → 23, "ad 9.0.12" → 9). */
function majorOf(version: string): number | null {
  const m = version.match(/(\d+)(?:\.\d+)+/) ?? version.match(/(\d+)/)
  return m ? Number(m[1]) : null
}

export function isMajorJump(current: string, available: string): boolean {
  const a = majorOf(current)
  const b = majorOf(available)
  return a !== null && b !== null && b > a
}

/** Package ids accepted on the command line: no spaces, quotes or shell syntax. */
export const PACKAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._+\-/@]{0,127}$/

/**
 * Parses `winget upgrade` text output. Column titles are localized, so the
 * columns are located by where each header word starts (Name, Id, Version,
 * Available, Source in every language), using the dashed rule line as anchor.
 * Spinner frames ("\r-\|/") and the trailing summary are ignored; rows with a
 * truncated id ("…") are dropped because they cannot be targeted exactly.
 */
export function parseWingetUpgrade(output: string): AppUpdate[] {
  const lines = output.split('\n').map((l) => {
    const parts = l.replace(/\r$/, '').split('\r')
    return parts[parts.length - 1]
  })
  const rule = lines.findIndex((l) => /^-{20,}\s*$/.test(l))
  if (rule < 1) return []
  const header = lines[rule - 1]
  const starts = [...header.matchAll(/\S+/g)].map((m) => m.index ?? 0)
  if (starts.length < 4) return []
  const col = (line: string, i: number) => line.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : undefined).trim()
  const out: AppUpdate[] = []
  for (const line of lines.slice(rule + 1)) {
    if (!line.trim()) break
    if (line.length < starts[3]) continue
    const id = col(line, 1)
    if (!PACKAGE_ID.test(id) || id.includes('…')) continue
    const source = starts.length >= 5 ? col(line, 4) : 'winget'
    if (source && source !== 'winget' && source !== 'msstore') continue
    const current = col(line, 2)
    const available = col(line, 3)
    out.push({ id, name: col(line, 0) || id, current, available, source: 'winget', major: isMajorJump(current, available) || undefined })
  }
  return out
}

/** `brew outdated --json=v2` */
export function parseBrewOutdated(json: string): AppUpdate[] {
  try {
    const data = JSON.parse(json) as {
      formulae?: Array<{ name: string; installed_versions?: string[]; current_version?: string; pinned?: boolean }>
      casks?: Array<{ name: string; installed_versions?: string[] | string; current_version?: string }>
    }
    const formulae = (data.formulae ?? [])
      .filter((f) => !f.pinned && PACKAGE_ID.test(f.name))
      .map<AppUpdate>((f) => ({ id: f.name, name: f.name, current: f.installed_versions?.at(-1) ?? '', available: f.current_version ?? '', source: 'brew' }))
    const casks = (data.casks ?? [])
      .filter((c) => PACKAGE_ID.test(c.name))
      .map<AppUpdate>((c) => ({
        id: c.name,
        name: c.name,
        current: Array.isArray(c.installed_versions) ? (c.installed_versions.at(-1) ?? '') : (c.installed_versions ?? ''),
        available: c.current_version ?? '',
        source: 'brew-cask'
      }))
    return [...casks, ...formulae]
  } catch {
    return []
  }
}

/** `flatpak remote-ls --updates --app --columns=application,name,version` (tab separated). */
export function parseFlatpakUpdates(output: string, installed: Map<string, string>): AppUpdate[] {
  return output
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((c) => c.length >= 2 && PACKAGE_ID.test(c[0].trim()))
    .map(([id, name, version]) => ({ id: id.trim(), name: (name ?? id).trim(), current: installed.get(id.trim()) ?? '', available: (version ?? '').trim(), source: 'flatpak' as const }))
}
