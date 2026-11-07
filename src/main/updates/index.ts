import { access } from 'node:fs/promises'
import type { AppUpdate, TaskProgress, UpdateOutcome, UpdateReport } from '../../shared/types'
import { run } from '../engine/exec'
import { PACKAGE_ID, parseBrewOutdated, parseFlatpakUpdates, parseWingetUpgrade } from './parse'

const MAX_IDS = 100
const SCAN_TIMEOUT = 180_000
/** Installers can take a while (Visual Studio, Office…). */
const UPGRADE_TIMEOUT = 30 * 60_000

async function brewPath(): Promise<string | null> {
  for (const p of ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']) {
    try {
      await access(p)
      return p
    } catch {
      // try the next prefix
    }
  }
  return null
}

/**
 * Lists and installs app updates with the platform's own package manager
 * (winget, Homebrew, Flatpak). The UI sends package ids; every id must be in
 * the latest scan and is passed as a separate argument, never through a shell.
 */
export class Updater {
  private last: AppUpdate[] = []

  constructor(private readonly emit: (p: TaskProgress) => void) {}

  async scan(): Promise<UpdateReport> {
    const scannedAt = Date.now()
    if (process.platform === 'win32') {
      const res = await run('winget', ['upgrade', '--accept-source-agreements', '--disable-interactivity'], { timeoutMs: SCAN_TIMEOUT })
      if (!res.ok && res.code === 'ENOENT') return { supported: true, managerMissing: true, updates: [], scannedAt }
      this.last = parseWingetUpgrade(res.stdout)
    } else if (process.platform === 'darwin') {
      const brew = await brewPath()
      if (!brew) return { supported: true, managerMissing: true, updates: [], scannedAt }
      await run(brew, ['update', '--quiet'], { timeoutMs: SCAN_TIMEOUT })
      this.last = parseBrewOutdated((await run(brew, ['outdated', '--json=v2', '--greedy-auto-updates'], { timeoutMs: SCAN_TIMEOUT })).stdout)
    } else if (process.platform === 'linux') {
      const list = await run('flatpak', ['list', '--app', '--columns=application,version'], { timeoutMs: SCAN_TIMEOUT })
      if (!list.ok && list.code === 'ENOENT') return { supported: true, managerMissing: true, updates: [], scannedAt }
      const installed = new Map(list.stdout.split('\n').map((l) => l.split('\t')).filter((c) => c[0]).map((c) => [c[0].trim(), (c[1] ?? '').trim()]))
      const res = await run('flatpak', ['remote-ls', '--updates', '--app', '--columns=application,name,version'], { timeoutMs: SCAN_TIMEOUT })
      this.last = parseFlatpakUpdates(res.stdout, installed)
    } else {
      return { supported: false, updates: [], scannedAt }
    }
    return { supported: true, updates: this.last, scannedAt }
  }

  async apply(raw: unknown): Promise<UpdateOutcome[]> {
    if (!Array.isArray(raw) || !raw.length || raw.length > MAX_IDS || !raw.every((id) => typeof id === 'string' && PACKAGE_ID.test(id))) {
      throw new Error('Invalid update request')
    }
    const ids = [...new Set(raw as string[])]
    const out: UpdateOutcome[] = []
    let done = 0
    for (const id of ids) {
      const pkg = this.last.find((u) => u.id === id)
      this.emit({ task: 'updates', done, total: ids.length, current: pkg?.name ?? id })
      if (!pkg) {
        out.push({ id, status: 'not-found' })
        continue
      }
      out.push(await this.upgrade(pkg))
      done++
    }
    this.emit({ task: 'updates', done: ids.length, total: ids.length })
    const updated = new Set(out.filter((o) => o.status === 'updated').map((o) => o.id))
    this.last = this.last.filter((u) => !updated.has(u.id))
    return out
  }

  private async upgrade(pkg: AppUpdate): Promise<UpdateOutcome> {
    let res
    if (pkg.source === 'winget') {
      res = await run(
        'winget',
        ['upgrade', '--id', pkg.id, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'],
        { timeoutMs: UPGRADE_TIMEOUT }
      )
      const text = res.stdout + res.stderr
      // 0x8A15002B: already up to date (updated elsewhere meanwhile).
      if (res.ok || /0x8a15002b/i.test(text)) return { id: pkg.id, status: 'updated' }
      if (/0x800704c7|cancel/i.test(text)) return { id: pkg.id, status: 'cancelled' }
      if (/0x80070005|access is denied|acceso denegado|administrator|administrador/i.test(text)) return { id: pkg.id, status: 'needs-admin' }
      return { id: pkg.id, status: 'failed', error: lastLine(text) }
    }
    if (pkg.source === 'brew' || pkg.source === 'brew-cask') {
      const brew = await brewPath()
      if (!brew) return { id: pkg.id, status: 'failed', error: 'brew not found' }
      res = await run(brew, pkg.source === 'brew-cask' ? ['upgrade', '--cask', pkg.id] : ['upgrade', pkg.id], { timeoutMs: UPGRADE_TIMEOUT })
    } else {
      res = await run('flatpak', ['update', '-y', '--noninteractive', pkg.id], { timeoutMs: UPGRADE_TIMEOUT })
    }
    return res.ok ? { id: pkg.id, status: 'updated' } : { id: pkg.id, status: 'failed', error: lastLine(res.stderr || res.stdout) }
  }
}

function lastLine(text: string): string {
  return (
    text
      .split(/\r?\n|\r/)
      .map((l) => l.trim())
      .filter((l) => l.length > 3 && !/^[-\\|/ ]+$/.test(l))
      .at(-1) ?? ''
  ).slice(0, 300)
}
