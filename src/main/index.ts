import { join } from 'node:path'
import { app, BrowserWindow, Menu, nativeImage, Notification, session, shell, Tray } from 'electron'
import type { AutomationConfig, TaskProgress } from '../shared/types'
import { Automation } from './automation'
import { Booster } from './boost'
import { Cleaner } from './cleaner'
import { DiskAnalyzer } from './disk'
import { Engine } from './engine'
import { Health } from './health'
import { registerIpc } from './ipc'
import { Network } from './network'
import { Services } from './services'
import { StartupManager } from './startup'
import { Uninstaller } from './uninstall'
import { Updater } from './updates'

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
let tray: Tray | null = null
let quitting = false
let automation: Automation | null = null
/** Started by the login item: stay in the tray until the user opens the window. */
const startHidden = process.argv.includes('--hidden')
const ICON = join(__dirname, '../../build/icon.png')

function showWindow(view?: string): void {
  if (!win) createWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (view) win.webContents.send('repid:navigate', view)
}

function emitProgress(progress: TaskProgress): void {
  win?.webContents.send('repid:progress', progress)
}

/** Tray icon while "keep running in the background" is on; login item on Windows/macOS. */
function applyBackground(cfg: AutomationConfig['background']): void {
  if (cfg.keepInTray && !tray) {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }))
    tray.setToolTip('RePID Identity')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'RePID Identity', click: () => showWindow() },
        { type: 'separator' },
        {
          label: app.getLocale().startsWith('es') ? 'Salir' : 'Quit',
          click: () => {
            quitting = true
            app.quit()
          }
        }
      ])
    )
    tray.on('click', () => showWindow())
  } else if (!cfg.keepInTray && tray) {
    tray.destroy()
    tray = null
  }
  if (process.platform === 'win32' || isMac) {
    app.setLoginItemSettings({ openAtLogin: cfg.launchAtLogin, args: ['--hidden'] })
  }
}

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
    icon: ICON,
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

  win.once('ready-to-show', () => {
    if (!(startHidden && automation?.keepInTray)) win?.show()
  })
  // With "keep running in the background", closing hides the window so automation keeps working.
  win.on('close', (event) => {
    if (!quitting && automation?.keepInTray) {
      event.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => {
    win = null
  })

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
  app.on('second-instance', () => showWindow())

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
    const cleaner = new Cleaner(engine)
    const disk = new DiskAnalyzer({ trash: (p) => shell.trashItem(p), reveal: (p) => shell.showItemInFolder(p), emit: emitProgress })
    automation = new Automation({
      engine,
      booster,
      cleaner,
      configPath: join(app.getPath('userData'), 'automation.json'),
      language: () => engine.language,
      applyBackground,
      notify: (title, body, view) => {
        if (!Notification.isSupported()) return
        const n = new Notification({ title, body, icon: ICON })
        n.on('click', () => showWindow(view))
        n.show()
      }
    })
    registerIpc(
      {
        engine,
        cleaner,
        startup,
        booster,
        uninstaller,
        disk,
        automation,
        updater: new Updater(emitProgress),
        health: new Health(),
        network: new Network(engine),
        services: new Services(join(app.getPath('userData'), 'services-journal.json'))
      },
      (theme) => {
      if (!isMac) win?.setTitleBarOverlay(TITLEBAR[theme])
      win?.setBackgroundColor(TITLEBAR[theme].color)
      }
    )
    void automation.start().finally(() => createWindow())

    // Performance mode changes live processes: put every priority back before exiting.
    let restored = false
    app.on('before-quit', (event) => {
      quitting = true
      automation?.stop()
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
    if (!isMac && !automation?.keepInTray) app.quit()
  })
}
