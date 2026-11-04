import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import type { EngineSettings, KillRequest, RepoPath } from '../shared/types'
import { DONATE_URL, REPO_URL } from '../shared/constants'
import type { Cleaner } from './cleaner'
import type { Engine } from './engine'
import { relaunchElevated } from './engine/privileges'

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
  return {
    protectedNames: names.filter((n): n is string => typeof n === 'string' && n.trim().length > 0 && n.length <= 128)
  }
}

export function registerIpc(engine: Engine, cleaner: Cleaner, onTheme: (theme: 'dark' | 'light') => void): void {
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
  handle('repid:open-donate', () => shell.openExternal(DONATE_URL))
  handle('repid:relaunch-elevated', async () => {
    const ok = await relaunchElevated(process.execPath, app.isPackaged ? [] : process.argv.slice(1))
    if (ok) app.exit(0)
    return ok
  })
  handle('repid:titlebar-theme', (_e, theme) => onTheme(theme === 'light' ? 'light' : 'dark'))
}
