import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import type { EngineSettings, KillRequest, RepoPath } from '../shared/types'
import { DONATE_URL, REPO_URL } from '../shared/constants'
import type { Automation } from './automation'
import type { Booster } from './boost'
import type { Cleaner } from './cleaner'
import type { DiskAnalyzer } from './disk'
import type { Engine } from './engine'
import type { Health } from './health'
import type { Network } from './network'
import type { Services } from './services'
import type { Updater } from './updates'
import { relaunchElevated } from './engine/privileges'
import type { StartupManager } from './startup'
import type { Uninstaller } from './uninstall'

const REPO_PATHS: Record<RepoPath, string> = {
  '': '',
  stargazers: '/stargazers',
  issues: '/issues/new/choose',
  releases: '/releases',
  contributing: '/blob/main/CONTRIBUTING.md',
  translate: '/blob/main/docs/ADDING_A_LANGUAGE.md'
}

const MAX_PIDS = 500
const MAX_PROTECTED = 200

function isPid(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

/** Only our own renderer (dev server or packaged file) may drive the engine. */
function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  const devUrl = process.env.ELECTRON_RENDERER_URL
  const trusted = url.startsWith('file://') || (!app.isPackaged && !!devUrl && url.startsWith(devUrl))
  if (!trusted) throw new Error('Untrusted IPC sender')
}

function parseKillRequest(raw: unknown): KillRequest {
  const req = raw as Partial<KillRequest> | null
  if (!req || !Array.isArray(req.pids) || req.pids.length === 0 || req.pids.length > MAX_PIDS || !req.pids.every(isPid)) {
    throw new Error('Invalid kill request')
  }
  return { pids: [...new Set(req.pids)], force: req.force === true, allowCaution: req.allowCaution === true }
}

function parseSettings(raw: unknown): EngineSettings {
  const names = (raw as Partial<EngineSettings> | null)?.protectedNames
  if (!Array.isArray(names) || names.length > MAX_PROTECTED) throw new Error('Invalid settings')
  const language = (raw as Partial<EngineSettings>).language
  return {
    protectedNames: names.filter((n): n is string => typeof n === 'string' && n.trim().length > 0 && n.length <= 128),
    language: typeof language === 'string' && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(language) ? language : undefined
  }
}

export interface Modules {
  engine: Engine
  cleaner: Cleaner
  startup: StartupManager
  booster: Booster
  uninstaller: Uninstaller
  disk: DiskAnalyzer
  automation: Automation
  updater: Updater
  health: Health
  network: Network
  services: Services
}

export function registerIpc({ engine, cleaner, startup, booster, uninstaller, disk, automation, updater, health, network, services }: Modules, onTheme: (theme: 'dark' | 'light') => void): void {
  const handle = (channel: string, fn: (event: IpcMainInvokeEvent, arg: unknown) => unknown) =>
    ipcMain.handle(channel, (event, arg) => {
      assertTrustedSender(event)
      return fn(event, arg)
    })

  handle('repid:snapshot', () => engine.snapshot())
  handle('repid:details', (_e, pid) => {
    if (!isPid(pid)) throw new Error('Invalid pid')
    return engine.details(pid)
  })
  handle('repid:kill', (_e, req) => engine.kill(parseKillRequest(req)))
  handle('repid:stop-service', (_e, pid) => {
    if (!isPid(pid)) throw new Error('Invalid pid')
    return engine.stopService(pid)
  })
  handle('repid:settings', (_e, settings) => engine.setSettings(parseSettings(settings)))
  handle('repid:open-repo', (_e, path) => {
    const suffix = REPO_PATHS[(typeof path === 'string' ? path : '') as RepoPath]
    if (suffix === undefined) throw new Error('Invalid link')
    return shell.openExternal(REPO_URL + suffix)
  })
  handle('repid:cleaner-scan', () => cleaner.scan())
  // Payload validated in Cleaner.clean (parseCleanRequest): ids only, never paths.
  handle('repid:cleaner-clean', (_e, req) => cleaner.clean(req))
  // Startup and boost payloads are validated inside their modules (parseStartupRequest / parseBoostRequest):
  // ids only, re-resolved against a fresh scan, never paths or commands.
  handle('repid:startup-scan', () => startup.scan())
  handle('repid:startup-set', (_e, req) => startup.set(req))
  handle('repid:startup-restore', () => startup.restore())
  handle('repid:boost-status', () => booster.status())
  handle('repid:boost-apply', (_e, req) => booster.apply(req))
  handle('repid:boost-stop', () => booster.stop())
  // Uninstall payloads are validated in the module (parseUninstallRequest / parseCleanRequest):
  // app ids are re-resolved against a fresh inventory and leftovers are selected by session ids only.
  handle('repid:uninstall-list', () => uninstaller.list())
  handle('repid:uninstall-run', (_e, req) => uninstaller.run(req))
  handle('repid:uninstall-force-scan', (_e, id) => uninstaller.forceScan(id))
  handle('repid:uninstall-orphans', () => uninstaller.scanOrphans())
  handle('repid:uninstall-clean', (_e, req) => uninstaller.clean(req))
  handle('repid:uninstall-open-backups', () => uninstaller.openBackups())
  // The modules below validate their own payloads: ids from their last scan only, never paths or commands.
  handle('repid:disk-roots', () => disk.roots())
  handle('repid:disk-scan', (_e, rootId) => disk.scan(rootId))
  handle('repid:disk-duplicates', () => disk.duplicates())
  handle('repid:disk-cancel', () => disk.cancel())
  handle('repid:disk-delete', (_e, req) => disk.delete(req))
  handle('repid:disk-reveal', (_e, id) => disk.reveal(id))
  handle('repid:automation-get', () => automation.state())
  handle('repid:automation-set', (_e, cfg) => automation.set(cfg))
  handle('repid:updates-scan', () => updater.scan())
  handle('repid:updates-apply', (_e, ids) => updater.apply(ids))
  handle('repid:health-scan', () => health.scan())
  handle('repid:restore-point', (_e, reason) => health.restorePoint(reason))
  handle('repid:network-scan', () => network.scan())
  handle('repid:network-block', (_e, req) => network.block(req))
  handle('repid:services-scan', () => services.scan())
  handle('repid:services-set', (_e, req) => services.set(req))
  handle('repid:open-donate', () => shell.openExternal(DONATE_URL))
  handle('repid:relaunch-elevated', async () => {
    const ok = await relaunchElevated(process.execPath, app.isPackaged ? [] : process.argv.slice(1))
    if (ok) app.exit(0)
    return ok
  })
  handle('repid:titlebar-theme', (_e, theme) => onTheme(theme === 'light' ? 'light' : 'dark'))
}
