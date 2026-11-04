import type { AppGroup } from '../../shared/types'
import { powershell } from './exec'

interface FileMeta {
  description?: string
  company?: string
}

const BATCH = 60
const cache = new Map<string, FileMeta>()
let inflight = false

/**
 * Enriches groups the catalog does not know with the executable's own
 * FileDescription/CompanyName (Windows version resource). Lookups run in one
 * batched PowerShell call in the background and are cached per path for the
 * session, so a group shows its real product name from the next refresh on.
 */
export function enrichWithMetadata(groups: AppGroup[]): void {
  if (process.platform !== 'win32') return
  const missing: string[] = []
  for (const g of groups) {
    if (g.identity.catalogId || !g.path) continue
    const meta = cache.get(g.path)
    if (!meta) {
      missing.push(g.path)
      continue
    }
    if (meta.description) g.identity.product = meta.description
    if (meta.company) g.identity.publisher = meta.company
    if (g.identity.category === 'unknown' && (meta.description || meta.company)) g.identity.category = 'application'
  }
  if (missing.length && !inflight) void fetchBatch([...new Set(missing)].slice(0, BATCH))
}

async function fetchBatch(paths: string[]): Promise<void> {
  inflight = true
  try {
    // Paths travel as JSON in an env var, never interpolated into the script.
    const res = await powershell(
      '$paths = $env:REPID_PATHS | ConvertFrom-Json; ' +
        '$paths | ForEach-Object { try { $v = (Get-Item -LiteralPath $_ -ErrorAction Stop).VersionInfo; ' +
        '[pscustomobject]@{ p = $_; d = $v.FileDescription; c = $v.CompanyName } } catch { [pscustomobject]@{ p = $_ } } } | ConvertTo-Json -Compress',
      { REPID_PATHS: JSON.stringify(paths) }
    )
    const parsed: unknown = res.ok && res.stdout.trim() ? JSON.parse(res.stdout) : []
    const rows = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{ p: string; d?: string; c?: string }>
    for (const path of paths) cache.set(path, {})
    for (const row of rows) {
      if (row?.p) cache.set(row.p, { description: row.d?.trim() || undefined, company: row.c?.trim() || undefined })
    }
  } catch {
    for (const path of paths) cache.set(path, {})
  } finally {
    inflight = false
  }
}
