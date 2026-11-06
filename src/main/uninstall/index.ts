import { mkdir, rmdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type {
  LeftoverCleanRequest,
  LeftoverCleanResult,
  LeftoverOutcome,
  Platform,
  UninstallReport,
  UninstallRequest,
  UninstallResult
} from '../../shared/types'
import { isUninstallId } from '../../shared/engine/uninstall'
import { isInside } from '../cleaner/fsops'
import type { Engine } from '../engine'
import { isElevated } from '../engine/privileges'
import { darwinUninstaller } from './darwin'
import { exists } from './fsutil'
import { linuxUninstaller } from './linux'
import type { AppRecord, LeftoverRecord, PlatformUninstaller } from './types'
import { isOfferablePath, windowsUninstaller } from './windows'

const PLATFORMS: Partial<Record<Platform, PlatformUninstaller>> = { win32: windowsUninstaller, darwin: darwinUninstaller, linux: linuxUninstaller }
const MAX_IDS = 500

export function parseUninstallRequest(raw: unknown): UninstallRequest {
  const r = raw as Partial<UninstallRequest> | null
  if (!r || !isUninstallId(r.id) || (r.mode !== 'standard' && r.mode !== 'quiet')) throw new Error('Invalid uninstall request')
  return { id: r.id, mode: r.mode, closeRunning: r.closeRunning === true, allowCaution: r.allowCaution === true }
}

export function parseCleanRequest(raw: unknown): LeftoverCleanRequest {
  const r = raw as Partial<LeftoverCleanRequest> | null
  if (!r || !isUninstallId(r.appId) || !Array.isArray(r.ids) || !r.ids.length || r.ids.length > MAX_IDS || !r.ids.every((i) => typeof i === 'string' && /^[a-z0-9]{2,40}$/.test(i))) {
    throw new Error('Invalid leftover request')
  }
  return { appId: r.appId, ids: [...new Set(r.ids)] }
}

export interface UninstallerDeps {
  /** Moves a file or folder to the Recycle Bin / Trash (Electron's shell.trashItem). */
  trash: (path: string) => Promise<void>
  /** Opens a folder in the file manager. */
  openPath: (path: string) => Promise<unknown>
  /** Registry/task backups are written under this folder (userData). */
  backupRoot: string
}

/**
 * Smart uninstaller. Order of operations for one app:
 *  1. re-inventory and re-check protection (the UI only sends an id);
 *  2. optionally end the app's running processes through the engine;
 *  3. run the app's OWN uninstaller (or move a macOS bundle to the Trash);
 *  4. verify the app is really gone, then look for leftovers;
 *  5. delete only the leftovers the user ticks: files/folders go to the
 *     Recycle Bin/Trash, registry keys and tasks are exported first.
 */
export class Uninstaller {
  private readonly platform = PLATFORMS[process.platform as Platform]
  private sessions = new Map<string, Map<string, LeftoverRecord>>()

  constructor(
    private readonly engine: Engine,
    private readonly deps: UninstallerDeps
  ) {}

  private async inventory(): Promise<AppRecord[]> {
    if (!this.platform) return []
    const records = await this.platform.inventory()
    const { groups } = await this.engine.current()
    for (const r of records) {
      const loc = r.app.installLocation
      if (!loc) continue
      r.app.runningPids = groups.filter((g) => g.path && g.risk !== 'critical' && isInside(g.path, loc)).flatMap((g) => g.pids)
    }
    return records
  }

  async list(): Promise<UninstallReport> {
    const apps = (await this.inventory()).map((r) => r.app).sort((a, b) => a.name.localeCompare(b.name))
    return { apps, elevated: await isElevated(), supported: !!this.platform, scannedAt: Date.now() }
  }

  async run(raw: unknown): Promise<UninstallResult> {
    const req = parseUninstallRequest(raw)
    if (!this.platform) return { id: req.id, status: 'not-found', leftovers: [] }
    const records = await this.inventory()
    const rec = records.find((r) => r.app.id === req.id)
    if (!rec) return { id: req.id, status: 'not-found', leftovers: [] }
    if (rec.app.risk === 'critical' || (rec.app.risk === 'caution' && !req.allowCaution)) return { id: req.id, status: 'protected', leftovers: [] }
    if (rec.app.uninstallerMissing) return { id: req.id, status: 'uninstaller-failed', error: 'missing', leftovers: [] }

    if (req.closeRunning && rec.app.runningPids.length) {
      await this.engine.kill({ pids: rec.app.runningPids, force: false, allowCaution: req.allowCaution })
    }

    if (rec.app.source === 'mac-app') {
      try {
        await this.deps.trash(rec.data.path)
      } catch (err) {
        return { id: req.id, status: 'needs-admin', error: err instanceof Error ? err.message : String(err), leftovers: [] }
      }
    } else {
      const outcome = await this.platform.run(rec, req.mode)
      if (outcome.status === 'cancelled') return { id: req.id, status: 'cancelled', exitCode: outcome.exitCode, leftovers: [] }
      if (outcome.status === 'needs-admin') return { id: req.id, status: 'needs-admin', exitCode: outcome.exitCode, error: outcome.error, leftovers: [] }
      if (outcome.status === 'missing') return { id: req.id, status: 'uninstaller-failed', error: 'missing', leftovers: [] }
      if (outcome.status === 'failed') return { id: req.id, status: 'uninstaller-failed', exitCode: outcome.exitCode, error: outcome.error, leftovers: [] }
    }

    // The user may have cancelled inside the vendor's window: never hunt leftovers of an app that is still installed.
    const after = await this.inventory()
    if (after.some((r) => r.app.id === req.id)) return { id: req.id, status: 'still-installed', leftovers: [] }
    return { id: req.id, status: 'uninstalled', leftovers: await this.scan(rec, after) }
  }

  /** Only for apps whose registered uninstaller no longer exists. */
  async forceScan(id: unknown): Promise<UninstallResult> {
    if (!isUninstallId(id) || !this.platform) throw new Error('Invalid id')
    const records = await this.inventory()
    const rec = records.find((r) => r.app.id === id)
    if (!rec) return { id, status: 'not-found', leftovers: [] }
    if (!rec.app.uninstallerMissing || rec.app.risk === 'critical') return { id, status: 'protected', leftovers: [] }
    return { id, status: 'uninstalled', leftovers: await this.scan(rec, records.filter((r) => r !== rec)) }
  }

  private async scan(rec: AppRecord, others: AppRecord[]) {
    const found = await this.platform!.leftovers(rec, others)
    this.sessions.set(rec.app.id, new Map(found.map((l) => [l.id, l])))
    // Strip the private `target` before handing leftovers to the renderer.
    return found.map(({ target: _t, ...l }) => l)
  }

  async clean(raw: unknown): Promise<LeftoverCleanResult> {
    const req = parseCleanRequest(raw)
    const session = this.sessions.get(req.appId)
    if (!session) throw new Error('No leftover scan for this app')
    const backupDir = join(this.deps.backupRoot, `${new Date().toISOString().replace(/[:.]/g, '-')}`)
    let backupUsed = false
    let recycledBytes = 0
    const outcomes: LeftoverOutcome[] = []

    for (const id of req.ids) {
      const l = session.get(id)
      if (!l) {
        outcomes.push({ id, status: 'failed', error: 'unknown' })
        continue
      }
      if (l.target.type === 'path') {
        const p = l.target.path
        if (!this.isRemovablePath(p)) {
          outcomes.push({ id, status: 'failed', error: 'refused' })
          continue
        }
        if (!(await exists(p))) {
          outcomes.push({ id, status: 'gone' })
          session.delete(id)
          continue
        }
        try {
          await this.deps.trash(p)
          recycledBytes += l.sizeBytes
          outcomes.push({ id, status: 'removed' })
          session.delete(id)
          // `Vendor\Product` removed and `Vendor` now empty: remove the empty folder too (rmdir never deletes content).
          if (l.reason === 'vendor-dir' && this.isRemovablePath(dirname(p))) await rmdir(dirname(p)).catch(() => undefined)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          outcomes.push({ id, status: /EPERM|EACCES|denied|permission/i.test(msg) ? 'needs-admin' : 'failed', error: msg })
        }
        continue
      }
      if (!this.platform?.removeNonFile) {
        outcomes.push({ id, status: 'failed', error: 'unsupported' })
        continue
      }
      if (!backupUsed) {
        await mkdir(backupDir, { recursive: true })
        backupUsed = true
      }
      const res = await this.platform.removeNonFile(l, backupDir)
      if (res.ok) {
        outcomes.push({ id, status: 'removed' })
        session.delete(id)
      } else outcomes.push({ id, status: res.needsAdmin ? 'needs-admin' : 'failed', error: res.error })
    }
    return { outcomes, recycledBytes, backupDir: backupUsed ? backupDir : undefined }
  }

  async openBackups(): Promise<void> {
    await mkdir(this.deps.backupRoot, { recursive: true })
    await this.deps.openPath(this.deps.backupRoot)
  }

  /** Second line of defence at deletion time, independent of how the leftover was found. */
  private isRemovablePath(p: string): boolean {
    if (process.platform === 'win32') return isOfferablePath(p)
    const abs = resolve(p)
    const home = homedir()
    // macOS/Linux leftovers live in the user's Library/.var/.config/.local/.cache, or are the .app bundle (handled in run()).
    return [join(home, 'Library'), join(home, '.var', 'app'), join(home, '.config'), join(home, '.local', 'share'), join(home, '.cache')].some((root) => isInside(abs, root))
  }
}
