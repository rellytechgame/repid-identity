import type { AppGroup, Category, Platform, Risk, StartupEffect, StartupImpact, StartupSource } from '../types'
import { basename, classify } from './classifier'
import { lookupCatalog } from './catalog'
import { normalizeName } from './protection'

export interface ParsedCommand {
  exe: string
  args: string
  /** Squirrel installers start `Update.exe --processStart App.exe`; this is the real app. */
  launches?: string
}

/**
 * Splits an autostart command into executable and arguments. Handles quoted
 * paths, unquoted Windows paths with spaces ("C:\Program Files\x\a.exe arg"),
 * `env VAR=1 app` prefixes from desktop files and Squirrel launchers.
 */
export function parseCommand(command: string): ParsedCommand {
  let c = command.trim()
  let exe: string
  let args: string
  if (c.startsWith('"')) {
    const end = c.indexOf('"', 1)
    exe = end > 0 ? c.slice(1, end) : c.slice(1)
    args = end > 0 ? c.slice(end + 1).trim() : ''
  } else {
    if (/^env\s/.test(c)) c = c.replace(/^env\s+(?:[A-Za-z_][\w]*=\S*\s+)*/, '')
    const win = c.match(/^(.*?\.(?:exe|com|bat|cmd))(?=\s|$)/i)
    if (win) {
      exe = win[1]
      args = c.slice(win[1].length).trim()
    } else {
      const sp = c.search(/\s/)
      exe = sp < 0 ? c : c.slice(0, sp)
      args = sp < 0 ? '' : c.slice(sp + 1).trim()
    }
  }
  const squirrel = args.match(/--processStart\s+(?:"([^"]+)"|(\S+))/i)
  return { exe, args, launches: squirrel ? (squirrel[1] ?? squirrel[2]) : undefined }
}

function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i > 0 ? p.slice(0, i) : ''
}

const SECURITY = /defender|antivirus|anti-virus|kaspersky|avast|\bavg\b|bitdefender|\beset\b|norton|mcafee|malwarebytes|sophos|trend micro|webroot|1password|bitwarden|keepass|lastpass|dashlane|\bvpn\b|nordvpn|expressvpn|protonvpn|wireguard|openvpn|securityhealth/i
const HARDWARE = /realtek|nvidia|advanced micro|\bamd\b|radeon|\bintel\b|synaptics|\belan\b|logitech|\blogi\b|razer|corsair|steelseries|dolby|waves maxx|conexant|\basus\b|armoury|lenovo|\bdell\b|alienware|\bhp\b|hewlett|\bomen\b|\bacer\b|micro-star|\bmsi\b|wacom|broadcom|qualcomm|killer|nahimic|tobii|\balps\b|bluetooth|touchpad|hotkey/i
const CLOUD = /onedrive|dropbox|google ?drive|googledrivefs|icloud|box ?sync|\bmega(sync)?\b|pcloud|nextcloud|owncloud|syncthing|insync/i
const UPDATER = /update|updater|upgrade|jusched|download assistant|installmonitor/i
const BROWSER = /\b(opera|chrome|msedge|edge|firefox|brave|vivaldi)\b/i
/** Linux/macOS desktop plumbing: disabling these breaks settings, keyring, input methods or accessibility. */
const UNIX_ESSENTIAL = /^(org\.gnome\.|org\.kde\.|org\.freedesktop\.|com\.apple\.|gnome-|at-spi|polkit|xdg-|pulseaudio|pipewire|wireplumber|ibus|fcitx|gnome-keyring|geoclue|snap-userd|user-dirs|im-launch|spice-vdagent|xembedsniproxy|kded|ksmserver|baloo|tracker-|evolution-|mate-settings|xfsettingsd|lxpolkit|cinnamon-)/i

const EFFECT_BY_CATEGORY: Partial<Record<Category, StartupEffect>> = {
  browser: 'browser',
  communication: 'communication',
  media: 'media',
  gaming: 'gaming',
  cloud: 'cloud',
  security: 'security',
  updater: 'updater',
  development: 'development',
  virtualization: 'development',
  runtime: 'development'
}

const CAUTION_EFFECTS = new Set<StartupEffect>(['security', 'hardware', 'cloud'])
/** Typically pre-loaded "just in case": the app works the same when opened by hand. */
const RECOMMENDED_EFFECTS = new Set<StartupEffect>(['updater', 'browser', 'communication', 'media', 'gaming'])

export interface StartupAssessInput {
  platform: Exclude<Platform, 'web'>
  /** Label from the source: registry value, shortcut, task, label or desktop file name. */
  label: string
  command: string
  exe?: string
  launches?: string
  /** Name the entry declares itself (shortcut, Store manifest, desktop Name=): what the user recognises. */
  declaredName?: string
  publisher?: string
  description?: string
  userProtected?: ReadonlySet<string>
}

export interface StartupAssessment {
  name: string
  category: Category
  risk: Risk
  effect: StartupEffect
  recommended: boolean
}

/**
 * Decides how an autostart entry is presented and guarded:
 *  - OS components (outside DriverStore) and desktop plumbing are locked;
 *  - security, hardware utilities and cloud sync need an explicit warning;
 *  - updaters, browsers, chat, media and game launchers are suggested.
 */
export function assessStartup(input: StartupAssessInput): StartupAssessment {
  const exe = input.exe ?? ''
  const target = input.launches ?? basename(exe)
  const identity = classify({ name: target, path: input.launches ? `${dirOf(exe)}\\${input.launches}` : exe, command: input.command })
  const catalog = lookupCatalog(normalizeName(target))
  const evidence = [input.label, target, exe, input.publisher ?? '', input.description ?? ''].join(' ')
  const name = (input.declaredName?.trim() || undefined) ?? cleanDescription(input.description) ?? catalog?.product ?? identity.product ?? prettyLabel(input.label)

  const userLocked = input.userProtected?.has(normalizeName(target)) ?? false
  const winSystem = input.platform === 'win32' && /^[a-z]:\\windows\\/i.test(exe) && !/\\driverstore\\/i.test(exe)
  const unixEssential = input.platform !== 'win32' && (UNIX_ESSENTIAL.test(input.label) || UNIX_ESSENTIAL.test(target))
  if (userLocked || winSystem || unixEssential || catalog?.category === 'system') {
    return { name, category: identity.category, risk: 'critical', effect: catalog?.category === 'security' || SECURITY.test(evidence) ? 'security' : 'system', recommended: false }
  }

  let effect: StartupEffect
  if (catalog?.category === 'security' || SECURITY.test(evidence)) effect = 'security'
  else if (catalog?.category === 'cloud' || CLOUD.test(evidence)) effect = 'cloud'
  else if (catalog && EFFECT_BY_CATEGORY[catalog.category]) effect = EFFECT_BY_CATEGORY[catalog.category]!
  else if (UPDATER.test(target) || UPDATER.test(input.label) || identity.category === 'updater') effect = 'updater'
  else if (BROWSER.test(evidence)) effect = 'browser'
  else if (catalog?.id === 'nvidia' || catalog?.id === 'amd' || HARDWARE.test(evidence)) effect = 'hardware'
  else effect = EFFECT_BY_CATEGORY[identity.category] ?? 'generic'

  const risk: Risk = CAUTION_EFFECTS.has(effect) ? 'caution' : 'safe'
  return { name, category: identity.category, risk, effect, recommended: risk === 'safe' && RECOMMENDED_EFFECTS.has(effect) }
}

/** FileDescription values like "Application" or "Launcher" say nothing; keep real product names. */
function cleanDescription(d: string | undefined): string | undefined {
  const s = d?.trim()
  if (!s || s.length < 3 || /^(application|launcher|app|program|setup|electron|helper)$/i.test(s)) return undefined
  return s
}

/** "MicrosoftEdgeAutoLaunch_09B2…" → "MicrosoftEdgeAutoLaunch", "Spotify.lnk" → "Spotify". */
function prettyLabel(label: string): string {
  return label.replace(/\.(lnk|desktop|plist)$/i, '').replace(/_[0-9A-F]{16,}$/i, '').replace(/^\\/, '').trim() || label
}

/**
 * Running groups that belong to an autostart entry: same executable path,
 * the app a Squirrel launcher starts (inside the launcher's folder), or — when
 * the command has no directory (Linux `Exec=discord`) or points at an app
 * execution alias — the same well-known executable name.
 */
export function matchRunning(exe: string | undefined, launches: string | undefined, groups: AppGroup[]): AppGroup[] {
  if (!exe) return []
  const exeLower = exe.toLowerCase()
  const dir = dirOf(exeLower)
  const name = normalizeName(basename(launches ?? exe))
  const byName = !dir || /\\windowsapps\\/i.test(exeLower) || lookupCatalog(name) !== undefined
  return groups.filter((g) => {
    const path = g.path.toLowerCase()
    if (path && path === exeLower && !launches) return true
    const gName = normalizeName(g.name)
    if (launches && gName === name && path.startsWith(dir)) return true
    return byName && gName === name
  })
}

export function measureImpact(groups: AppGroup[]): { running: { pids: number; memBytes: number; cpu: number } | null; impact: StartupImpact } {
  if (!groups.length) return { running: null, impact: 'not-running' }
  const running = {
    pids: groups.reduce((s, g) => s + g.pids.length, 0),
    memBytes: groups.reduce((s, g) => s + g.memBytes, 0),
    cpu: Math.round(groups.reduce((s, g) => s + g.cpu, 0) * 10) / 10
  }
  const mb = running.memBytes / 1024 ** 2
  const impact: StartupImpact = mb >= 300 || running.cpu >= 5 ? 'high' : mb >= 100 || running.cpu >= 1 ? 'medium' : 'low'
  return { running, impact }
}

export const MACHINE_SOURCES = new Set<StartupSource>(['hklm-run', 'hklm-run32', 'common-folder', 'xdg-system'])

/** Ids travel from the UI back to the main process; they only ever select an entry found by a fresh scan. */
export function isStartupId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 2 && value.length <= 600 && !/[\u0000-\u001f]/.test(value)
}
