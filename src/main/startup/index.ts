import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Platform, StartupChangeOutcome, StartupChangeRequest, StartupEntry, StartupReport } from '../../shared/types'
import { MACHINE_SOURCES, assessStartup, isStartupId, matchRunning, measureImpact, parseCommand } from '../../shared/engine/startup'
import type { Engine } from '../engine'
import { readFileMeta } from '../engine/metadata'
import { isElevated } from '../engine/privileges'
import { darwinAdapter } from './darwin'
import { linuxAdapter } from './linux'
import type { JournalEntry, RawStartup, StartupAdapter } from './types'
import { windowsAdapter } from './windows'

const MAX_IDS = 200
const ADAPTERS: Partial<Record<Platform, StartupAdapter>> = { win32: windowsAdapter, darwin: darwinAdapter, linux: linuxAdapter }

interface Resolved {
  raw: RawStartup
  entry: StartupEntry
}

export function parseStartupRequest(raw: unknown): StartupChangeRequest {
  const req = raw as Partial<StartupChangeRequest> | null
  if (!req || !Array.isArray(req.ids) || !req.ids.length || req.ids.length > MAX_IDS || !req.ids.every(isStartupId) || typeof req.enabled !== 'boolean') {
    throw new Error('Invalid startup request')
  }
  return { ids: [...new Set(req.ids)], enabled: req.enabled, allowCaution: req.allowCaution === true }
}

/**
 * Lists and toggles autostart entries. The UI only ever sends ids; every
 * action re-scans, re-classifies and re-checks protection before touching the
 * OS, then scans again to verify the change actually took effect.
 */
export class StartupManager {
  private readonly adapter = ADAPTERS[process.platform as Platform]
  private elevated: Promise<boolean> | null = null

  constructor(
    private readonly engine: Engine,
    private readonly journalPath: string
  ) {}

  async scan(): Promise<StartupReport> {
    this.elevated ??= isElevated()
    if (!this.adapter) return { entries: [], elevated: false, supported: false, scannedAt: Date.now() }
    const resolved = await this.resolve(await this.readJournal())
    return { entries: resolved.map((r) => r.entry), elevated: await this.elevated, supported: true, scannedAt: Date.now() }
  }

  async set(raw: unknown): Promise<StartupChangeOutcome[]> {
    const req = parseStartupRequest(raw)
    if (!this.adapter) return req.ids.map((id) => ({ id, name: id, status: 'failed', error: 'unsupported' }))
    const journal = await this.readJournal()
    const byId = new Map((await this.resolve(journal)).map((r) => [r.entry.id, r]))
    const outcomes: StartupChangeOutcome[] = []
    const attempted: Resolved[] = []

    for (const id of req.ids) {
      const r = byId.get(id)
      if (!r) {
        outcomes.push({ id, name: id, status: 'not-found' })
        continue
      }
      const { entry } = r
      // Re-enabling is always allowed for entries RePID disabled itself, even if they are classified as caution.
      const restoring = req.enabled && entry.changedByRepid
      if (entry.risk === 'critical' || r.raw.policyLocked || (entry.risk === 'caution' && !req.allowCaution && !restoring)) {
        outcomes.push({ id, name: entry.name, status: 'protected' })
        continue
      }
      if (entry.enabled === req.enabled) {
        outcomes.push({ id, name: entry.name, status: 'unchanged' })
        if (req.enabled) this.forget(journal, id)
        continue
      }
      const res = await this.adapter.setEnabled(r.raw, req.enabled)
      if (!res.ok) {
        outcomes.push({ id, name: entry.name, status: res.error ?? 'failed', error: res.message })
        continue
      }
      attempted.push(r)
      outcomes.push({ id, name: entry.name, status: 'changed' })
    }

    if (attempted.length) {
      // Verify against a fresh read: a write can "succeed" while a policy or the app itself puts the entry back.
      const after = new Map((await this.adapter.list(journal)).map((x) => [x.id, x]))
      for (const r of attempted) {
        const now = after.get(r.entry.id)
        const outcome = outcomes.find((o) => o.id === r.entry.id)!
        const applied = req.enabled ? !now || now.enabled : now ? !now.enabled : true
        if (!applied) {
          outcome.status = 'failed'
          outcome.error = 'not-applied'
          continue
        }
        if (req.enabled) this.forget(journal, r.entry.id)
        else journal.push({ id: r.entry.id, name: r.entry.name, at: Date.now(), data: r.raw.source === 'login-item' ? r.raw.data : undefined })
      }
    }
    await this.writeJournal(journal)
    return outcomes
  }

  /** Re-enables everything RePID disabled (and nothing else). */
  async restore(): Promise<StartupChangeOutcome[]> {
    const journal = await this.readJournal()
    if (!journal.length) return []
    return this.set({ ids: journal.map((j) => j.id).slice(0, MAX_IDS), enabled: true, allowCaution: true })
  }

  private async resolve(journal: JournalEntry[]): Promise<Resolved[]> {
    const platform = process.platform as Exclude<Platform, 'web'>
    const [raws, current] = await Promise.all([this.adapter!.list(journal), this.engine.current()])
    const parsed = raws.map((raw) => {
      const cmd = parseCommand(raw.command)
      return { raw, exe: raw.exe || cmd.exe, launches: cmd.launches }
    })
    const meta = await readFileMeta([...new Set(parsed.map((p) => p.exe).filter((e) => /\.exe$/i.test(e)))])
    const journaled = new Set(journal.map((j) => j.id))

    return parsed.map(({ raw, exe, launches }) => {
      const m = meta.get(exe)
      const a = assessStartup({
        platform,
        label: raw.label,
        command: raw.command,
        exe,
        launches,
        declaredName: raw.declaredName,
        publisher: m?.company,
        description: m?.description,
        userProtected: this.engine.protectedNames
      })
      const { running, impact } = measureImpact(raw.enabled ? matchRunning(exe, launches, current.groups) : [])
      const machine = MACHINE_SOURCES.has(raw.source) || (raw.source === 'launch-agent' && raw.data?.scope === 'machine')
      return {
        raw,
        entry: {
          id: raw.id,
          name: a.name,
          publisher: m?.company,
          command: raw.command,
          exe: exe || undefined,
          source: raw.source,
          scope: machine ? 'machine' : 'user',
          enabled: raw.enabled,
          risk: raw.policyLocked ? 'critical' : a.risk,
          effect: a.effect,
          recommended: a.recommended && raw.enabled && !raw.policyLocked,
          // macOS launchd overrides and XDG user copies never need root; HKLM values do.
          requiresAdmin: platform === 'win32' && machine,
          running,
          impact: raw.enabled ? impact : 'not-running',
          changedByRepid: journaled.has(raw.id) && !raw.enabled
        }
      }
    })
  }

  private forget(journal: JournalEntry[], id: string): void {
    const i = journal.findIndex((j) => j.id === id)
    if (i >= 0) journal.splice(i, 1)
  }

  private async readJournal(): Promise<JournalEntry[]> {
    try {
      const data = JSON.parse(await readFile(this.journalPath, 'utf8')) as { entries?: JournalEntry[] }
      return Array.isArray(data.entries) ? data.entries.filter((e) => e && isStartupId(e.id) && typeof e.name === 'string') : []
    } catch {
      return []
    }
  }

  /** Atomic replace so a crash mid-write never leaves a truncated journal. */
  private async writeJournal(entries: JournalEntry[]): Promise<void> {
    await mkdir(dirname(this.journalPath), { recursive: true })
    const tmp = `${this.journalPath}.tmp`
    await writeFile(tmp, JSON.stringify({ version: 1, entries }, null, 2), 'utf8')
    await rename(tmp, this.journalPath)
  }
}
