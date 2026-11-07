import { app, BrowserWindow, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import type { SystemSnapshot } from '../../shared/types'
import { parseQuickAction, type QuickAction } from './args'

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'

export interface DesktopDeps {
  icon: string
  /** Opens/raises the main window, optionally on a view. */
  show: (view?: string) => void
  /** Opens the main window and triggers the Smart Free dialog. */
  smartFree: () => void
  /** Opens the Disk analyzer for a folder (context menu). */
  diskScan: (path: string) => void
  /** Latest snapshot for the tray tooltip/menu and the widget (null until the first sample). */
  snapshot: () => SystemSnapshot | null
  /** Current UI language for menu labels. */
  language: () => string
  quit: () => void
  /** Whether "keep running in the background" is on (controls whether the tray stays). */
  keepInTray: () => boolean
  /** The main window's preload, reused by the widget so it gets the same `window.repid`. */
  preload: string
  rendererUrl?: string
  rendererFile: string
}

const L = (lang: string, es: string, en: string) => (lang.toLowerCase().startsWith('es') ? es : en)
const fmtMb = (b: number) => `${Math.round(b / 1024 / 1024 / 1024 * 10) / 10} GB`

/**
 * Desktop OS integration: a floating always-on-top widget, an enriched tray
 * menu with live stats, and native quick actions (Windows jump list, macOS
 * dock menu; Linux .desktop actions and the Windows context menu arrive as
 * launch args and are handled here too).
 */
export class DesktopIntegration {
  private tray: Tray | null = null
  private widget: BrowserWindow | null = null
  private widgetOn = false
  private refresh: NodeJS.Timeout | null = null

  constructor(private readonly deps: DesktopDeps) {}

  /** Call once the app is ready. Reflects the current tray/jump-list state. */
  start(): void {
    this.installQuickActions()
    this.refresh = setInterval(() => this.updateTray(), 2500)
    this.refresh.unref()
  }

  stop(): void {
    if (this.refresh) clearInterval(this.refresh)
    this.tray?.destroy()
    this.tray = null
    this.widget?.destroy()
    this.widget = null
  }

  /** Run a quick action parsed from argv (initial launch or second instance). */
  handleArgs(argv: readonly string[]): boolean {
    const action = parseQuickAction(argv)
    if (!action) return false
    this.run(action)
    return true
  }

  private run(action: QuickAction): void {
    switch (action.kind) {
      case 'open':
        this.deps.show(action.view)
        break
      case 'smart-free':
        this.deps.smartFree()
        break
      case 'toggle-widget':
        this.toggleWidget()
        break
      case 'disk-scan':
        this.deps.diskScan(action.path)
        break
    }
  }

  // ───────────── Tray ─────────────

  syncTray(): void {
    if (this.deps.keepInTray()) {
      if (!this.tray) this.createTray()
      else this.updateTray()
    } else if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }

  private createTray(): void {
    this.tray = new Tray(nativeImage.createFromPath(this.deps.icon).resize({ width: 16, height: 16 }))
    this.tray.on('click', () => this.deps.show())
    this.updateTray()
  }

  private trayTemplate(): MenuItemConstructorOptions[] {
    const lang = this.deps.language()
    const s = this.deps.snapshot()
    const stats: MenuItemConstructorOptions[] = s
      ? [
          { label: `CPU: ${Math.round(s.cpu.load)}%`, enabled: false },
          { label: `${L(lang, 'Memoria', 'Memory')}: ${fmtMb(s.mem.used)} / ${fmtMb(s.mem.total)}`, enabled: false },
          { label: `${L(lang, 'Disco', 'Disk')}: ↓${fmtRate(s.diskRead)} ↑${fmtRate(s.diskWrite)}`, enabled: false },
          { type: 'separator' }
        ]
      : []
    return [
      { label: 'RePID Identity', click: () => this.deps.show() },
      { type: 'separator' },
      ...stats,
      { label: L(lang, 'Liberación inteligente', 'Smart Free'), click: () => this.deps.smartFree() },
      { label: L(lang, 'Procesos', 'Processes'), click: () => this.deps.show('processes') },
      { label: L(lang, 'Limpieza', 'Cleanup'), click: () => this.deps.show('cleaner') },
      { label: this.widgetOn ? L(lang, 'Ocultar widget', 'Hide widget') : L(lang, 'Mostrar widget', 'Show widget'), click: () => this.toggleWidget() },
      { type: 'separator' },
      { label: L(lang, 'Salir', 'Quit'), click: () => this.deps.quit() }
    ]
  }

  private updateTray(): void {
    if (!this.tray) return
    const s = this.deps.snapshot()
    this.tray.setToolTip(s ? `RePID · CPU ${Math.round(s.cpu.load)}% · RAM ${Math.round((s.mem.used / s.mem.total) * 100)}%` : 'RePID Identity')
    this.tray.setContextMenu(Menu.buildFromTemplate(this.trayTemplate()))
  }

  // ───────────── Floating widget ─────────────

  get widgetVisible(): boolean {
    return this.widgetOn
  }

  setWidget(on: boolean): void {
    if (on === this.widgetOn && (!on || this.widget)) return
    this.widgetOn = on
    if (on) this.createWidget()
    else {
      this.widget?.destroy()
      this.widget = null
    }
    this.updateTray()
  }

  private toggleWidget(): void {
    this.setWidget(!this.widgetOn)
  }

  private createWidget(): void {
    this.widget = new BrowserWindow({
      width: 230,
      height: 150,
      resizable: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreenable: false,
      maximizable: false,
      minimizable: false,
      title: 'RePID',
      webPreferences: {
        preload: this.deps.preload,
        additionalArguments: [`--repid-version=${app.getVersion()}`, '--repid-widget'],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.widget.setAlwaysOnTop(true, 'floating')
    this.widget.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
    this.widget.on('closed', () => {
      this.widget = null
      this.widgetOn = false
      this.updateTray()
    })
    const hash = '#widget'
    if (this.deps.rendererUrl) void this.widget.loadURL(this.deps.rendererUrl + hash)
    else void this.widget.loadFile(this.deps.rendererFile, { hash: 'widget' })
  }

  // ───────────── OS quick actions ─────────────

  private installQuickActions(): void {
    const lang = this.deps.language()
    if (isWin) {
      app.setUserTasks([
        task(L(lang, 'Liberación inteligente', 'Smart Free'), '--smart-free', 0),
        task(L(lang, 'Procesos', 'Processes'), '--open=processes', 0),
        task(L(lang, 'Limpieza', 'Cleanup'), '--open=cleaner', 0),
        task(L(lang, 'Mostrar/ocultar widget', 'Show/hide widget'), '--toggle-widget', 0)
      ])
    }
    if (isMac && app.dock) {
      app.dock.setMenu(
        Menu.buildFromTemplate([
          { label: L(lang, 'Liberación inteligente', 'Smart Free'), click: () => this.deps.smartFree() },
          { label: L(lang, 'Procesos', 'Processes'), click: () => this.deps.show('processes') },
          { label: L(lang, 'Limpieza', 'Cleanup'), click: () => this.deps.show('cleaner') },
          { label: L(lang, 'Mostrar/ocultar widget', 'Show/hide widget'), click: () => this.toggleWidget() }
        ])
      )
    }
    // Linux .desktop actions launch a new instance with the flag; handled by handleArgs on second-instance.
  }
}

function task(title: string, arg: string, iconIndex: number): Electron.Task {
  return { program: process.execPath, arguments: arg, title, description: title, iconPath: process.execPath, iconIndex }
}

function fmtRate(bytesPerSec?: number): string {
  if (!bytesPerSec || bytesPerSec < 1024) return '0'
  const mb = bytesPerSec / 1024 / 1024
  return mb >= 1 ? `${mb.toFixed(1)}MB/s` : `${Math.round(bytesPerSec / 1024)}KB/s`
}
