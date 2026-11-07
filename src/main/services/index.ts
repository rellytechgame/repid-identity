import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ServiceChangeOutcome, ServiceEntry, ServicesReport } from '../../shared/types'
import { SERVICE_NAME, classifyService } from '../../shared/engine/services'
import { powershell, run } from '../engine/exec'
import { isElevated } from '../engine/privileges'

const MAX_NAMES = 100

/** Every non-disabled service with its start mode, state and the company of its executable. */
const LIST = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$out = foreach ($s in Get-CimInstance Win32_Service) {
  $exe = $s.PathName -replace '^\\s*"([^"]+)".*$', '$1'
  if ($exe -eq $s.PathName) { $exe = ($s.PathName -split '\\s+(?=[-/])')[0] }
  $co = ''
  try { $co = (Get-Item -LiteralPath $exe -ErrorAction Stop).VersionInfo.CompanyName } catch {}
  [pscustomobject]@{ name = $s.Name; display = $s.DisplayName; mode = $s.StartMode; delayed = [bool]$s.DelayedAutoStart; state = $s.State; path = [string]$s.PathName; company = [string]$co }
}
ConvertTo-Json -InputObject @($out) -Compress
`

const SET_MANUAL = `
$ErrorActionPreference = 'Stop'
Set-Service -Name $env:REPID_SVC -StartupType Manual
'ok'
`
const SET_AUTO = `
$ErrorActionPreference = 'Stop'
Set-Service -Name $env:REPID_SVC -StartupType Automatic
'ok'
`

interface RawService {
  name: string
  display: string
  mode: string
  delayed: boolean
  state: string
  path: string
  company: string
}

type Journal = Record<string, 'auto' | 'delayed'>

/**
 * Curated list of auto-start services that can safely start on demand
 * instead (Windows only). Every change is journaled, verified by reading the
 * service again, and can be undone exactly as RePID found it.
 */
export class Services {
  constructor(private readonly journalPath: string) {}

  private async journal(): Promise<Journal> {
    try {
      return JSON.parse(await readFile(this.journalPath, 'utf8')) as Journal
    } catch {
      return {}
    }
  }

  private async saveJournal(j: Journal): Promise<void> {
    await mkdir(dirname(this.journalPath), { recursive: true })
    await writeFile(`${this.journalPath}.tmp`, JSON.stringify(j, null, 2), 'utf8')
    await rename(`${this.journalPath}.tmp`, this.journalPath)
  }

  private async raw(): Promise<RawService[]> {
    const res = await powershell(LIST, undefined, 90000)
    try {
      return JSON.parse(res.stdout || '[]') as RawService[]
    } catch {
      return []
    }
  }

  async scan(): Promise<ServicesReport> {
    if (process.platform !== 'win32') return { supported: false, elevated: false, services: [], scannedAt: Date.now() }
    const [list, journal, elevated] = await Promise.all([this.raw(), this.journal(), isElevated()])
    const services: ServiceEntry[] = []
    for (const s of list) {
      const mode = modeOf(s)
      const changed = journal[s.name]
      // Show auto-start services, plus the ones RePID switched (so they can be undone).
      if (!changed && mode !== 'auto' && mode !== 'delayed') continue
      const verdict = classifyService({ name: s.name, displayName: s.display, company: s.company, path: s.path })
      if (!verdict && !changed) continue
      services.push({
        name: s.name,
        displayName: s.display || s.name,
        catalogKey: verdict?.catalogKey ?? 'thirdParty',
        vendor: s.company || undefined,
        thirdParty: verdict?.thirdParty ?? true,
        startMode: mode,
        running: /running/i.test(s.state),
        risk: verdict?.risk ?? 'caution',
        recommended: !changed && (verdict?.recommended ?? false),
        changedByRepid: !!changed,
        originalMode: changed
      })
    }
    services.sort((a, b) => Number(b.recommended) - Number(a.recommended) || Number(a.risk === 'caution') - Number(b.risk === 'caution') || a.displayName.localeCompare(b.displayName))
    return { supported: true, elevated, services, scannedAt: Date.now() }
  }

  async set(raw: unknown): Promise<ServiceChangeOutcome[]> {
    const req = raw as { names?: unknown; restore?: unknown; allowCaution?: unknown } | null
    if (!req || !Array.isArray(req.names) || !req.names.length || req.names.length > MAX_NAMES || typeof req.restore !== 'boolean') throw new Error('Invalid request')
    const names = [...new Set(req.names.filter((n): n is string => typeof n === 'string' && SERVICE_NAME.test(n)))]
    if (process.platform !== 'win32') return names.map((name) => ({ name, status: 'failed', error: 'unsupported' }))
    if (!(await isElevated())) return names.map((name) => ({ name, status: 'needs-admin' }))

    // Re-resolve against a fresh read: only services the scan would offer (or RePID changed) are touched.
    const report = await this.scan()
    const byName = new Map(report.services.map((s) => [s.name, s]))
    const journal = await this.journal()
    const out: ServiceChangeOutcome[] = []
    for (const name of names) {
      const s = byName.get(name)
      if (!s) {
        out.push({ name, status: 'not-found' })
        continue
      }
      if (req.restore) {
        const original = journal[name]
        if (!original) {
          out.push({ name, status: 'not-allowed' })
          continue
        }
        const res =
          original === 'delayed'
            ? await run('sc.exe', ['config', name, 'start=', 'delayed-auto'], { timeoutMs: 30000 })
            : await powershell(SET_AUTO, { REPID_SVC: name }, 30000)
        if (res.ok) {
          delete journal[name]
          out.push({ name, status: 'changed' })
        } else out.push({ name, status: 'failed', error: (res.stderr || res.stdout).trim().slice(0, 300) })
      } else {
        if (s.startMode !== 'auto' && s.startMode !== 'delayed') {
          out.push({ name, status: 'not-allowed' })
          continue
        }
        if (s.risk === 'caution' && req.allowCaution !== true) {
          out.push({ name, status: 'not-allowed' })
          continue
        }
        const res = await powershell(SET_MANUAL, { REPID_SVC: name }, 30000)
        if (res.stdout.trim().endsWith('ok')) {
          journal[name] = s.startMode
          out.push({ name, status: 'changed' })
        } else if (/denied|denegado/i.test(res.stderr)) out.push({ name, status: 'needs-admin' })
        else out.push({ name, status: 'failed', error: res.stderr.trim().slice(0, 300) })
      }
    }
    await this.saveJournal(journal)
    // Verify: what Windows reports now must match what was asked.
    const after = new Map((await this.raw()).map((s) => [s.name, modeOf(s)]))
    for (const o of out) {
      if (o.status !== 'changed') continue
      const mode = after.get(o.name)
      const ok = req.restore ? mode === 'auto' || mode === 'delayed' : mode === 'manual'
      if (!ok) Object.assign(o, { status: 'failed', error: `Windows reports ${mode ?? 'unknown'}` })
    }
    return out
  }
}

function modeOf(s: RawService): ServiceEntry['startMode'] {
  const m = s.mode.toLowerCase()
  if (m === 'auto') return s.delayed ? 'delayed' : 'auto'
  if (m === 'manual') return 'manual'
  return 'disabled'
}
