import { join } from 'node:path'
import { app, BrowserWindow, Menu, session, shell } from 'electron'
import { Booster } from './boost'
import { Cleaner } from './cleaner'
import { Engine } from './engine'
import { registerIpc } from './ipc'
import { StartupManager } from './startup'
import { Uninstaller } from './uninstall'

const isMac = process.platform === 'darwin'
const TITLEBAR = {
  dark: { color: '#0b0f19', symbolColor: '#cbd5e1', height: 44 },
  light: { color: '#f8fafc', symbolColor: '#334155', height: 44 }
}

// Production CSP. In development Vite injects inline scripts for hot reload, so it is skipped there.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://api.github.com",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'"
].join('; ')

let win: BrowserWindow | null = null

function selfPids(): Set<number> {
  const pids = new Set(app.getAppMetrics().map((m) => m.pid))
  pids.add(process.pid)
  // In dev the electron-vite CLI is our parent; ending it would kill the session.
  if (!app.isPackaged) pids.add(process.ppid)
  return pids
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'RePID Identity',
    backgroundColor: TITLEBAR.dark.color,
    icon: join(__dirname, '../../build/icon.png'),
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 14 } } : { titleBarOverlay: TITLEBAR.dark }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      additionalArguments: [`--repid-version=${app.getVersion()}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win?.show())

  // Never navigate away from the app or open new windows; https links go to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.voxelenterprise.repid-identity')
    if (!isMac) Menu.setApplicationMenu(null)

    if (app.isPackaged) {
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } })
      })
    }
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

    const engine = new Engine(selfPids)
    const booster = new Booster(engine)
    const startup = new StartupManager(engine, join(app.getPath('userData'), 'startup-journal.json'))
    const uninstaller = new Uninstaller(engine, {
      trash: (p) => shell.trashItem(p),
      openPath: (p) => shell.openPath(p),
      backupRoot: join(app.getPath('userData'), 'uninstall-backups')
    })
    registerIpc({ engine, cleaner: new Cleaner(engine), startup, booster, uninstaller }, (theme) => {
      if (!isMac) win?.setTitleBarOverlay(TITLEBAR[theme])
      win?.setBackgroundColor(TITLEBAR[theme].color)
    })
    createWindow()

    // Performance mode changes live processes: put every priority back before exiting.
    let restored = false
    app.on('before-quit', (event) => {
      if (restored || !booster.active) return
      event.preventDefault()
      restored = true
      const timeout = new Promise((resolve) => setTimeout(resolve, 8000))
      void Promise.race([booster.stop().catch(() => undefined), timeout]).finally(() => app.quit())
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })
}
