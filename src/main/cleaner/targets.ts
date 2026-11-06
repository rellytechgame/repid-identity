import path from 'node:path'
import type { CleanerKind, CleanerRisk, CleanerTarget, Platform } from '../../shared/types'

/** Directories the definitions are built from. Injected so tests can use any platform. */
export interface CleanerEnv {
  platform: Exclude<Platform, 'web'>
  home: string
  /** Windows %APPDATA% (Roaming). */
  appData: string
  /** Windows %LOCALAPPDATA%. */
  localAppData: string
  temp: string
  /** Windows %SystemRoot%. */
  systemRoot: string
  /** Windows %ProgramData%. */
  programData: string
}

/**
 * What to delete:
 *  - contents: everything inside `dir` (the directory itself is kept)
 *  - files: only the listed file names inside `dir`
 *  - match: files in `dir` whose name matches `pattern`
 * Nothing outside `dir` is ever touched (enforced in fsops).
 */
export type PathSpec =
  | { mode: 'contents'; dir: string; exclude?: string[] }
  | { mode: 'files'; dir: string; names: string[] }
  | { mode: 'match'; dir: string; pattern: RegExp }

/** Special handlers that are not plain file deletion. */
export type CleanerAction = 'recycle-bin-windows' | 'dns-flush' | 'firefox-history' | 'windows-setup-cleanup'

export interface TargetDef {
  id: string
  kind: CleanerKind
  group: CleanerTarget['group']
  browser?: string
  risk: CleanerRisk
  requiresAdmin: boolean
  defaultSelected: boolean
  measurable: boolean
  specs: PathSpec[]
  actions?: CleanerAction[]
  /** Fixed shell lines run once, elevated, on macOS/Linux. Never interpolate runtime values here. */
  privileged?: string[]
  /** Normalized process names that lock the files (browser must be closed). */
  processNames?: string[]
  /**
   * Specs are only MEASURED (to show the size); the actions do the deletion.
   * Used for Windows.old, whose ACLs only Windows' own cleanup tool can handle.
   */
  measureOnly?: boolean
  /** Offer the target even when nothing measurable was found (the action may still free space). */
  alwaysAvailable?: boolean
}

const KIND_META: Record<CleanerKind, Pick<TargetDef, 'risk' | 'defaultSelected' | 'group'>> = {
  'user-temp': { risk: 'safe', defaultSelected: true, group: 'system' },
  'system-temp': { risk: 'caution', defaultSelected: true, group: 'system' },
  'update-cache': { risk: 'caution', defaultSelected: false, group: 'system' },
  'recycle-bin': { risk: 'sensitive', defaultSelected: false, group: 'system' },
  'dns-cache': { risk: 'safe', defaultSelected: true, group: 'system' },
  'dev-caches': { risk: 'caution', defaultSelected: false, group: 'apps' },
  'browser-cache': { risk: 'safe', defaultSelected: true, group: 'browsers' },
  'browser-history': { risk: 'sensitive', defaultSelected: false, group: 'browsers' },
  'browser-cookies': { risk: 'sensitive', defaultSelected: false, group: 'browsers' },
  'app-caches': { risk: 'safe', defaultSelected: true, group: 'apps' },
  'crash-dumps': { risk: 'safe', defaultSelected: true, group: 'system' },
  'windows-old': { risk: 'caution', defaultSelected: false, group: 'system' }
}

function def(kind: CleanerKind, rest: Omit<TargetDef, 'kind' | 'risk' | 'defaultSelected' | 'group' | 'id'> & { id?: string }): TargetDef {
  return { id: rest.id ?? kind, kind, ...KIND_META[kind], ...rest }
}

// ───────────── Browsers ─────────────

export interface ChromiumBrowser {
  id: string
  name: string
  /** "User Data" directory holding the profiles. */
  userData: string
  /** Opera keeps a single profile directly in its user-data dir. */
  singleProfile?: boolean
  /** Extra OS-level cache directory (macOS ~/Library/Caches, Linux ~/.cache). */
  cacheRoot?: string
  processNames: string[]
}

export function chromiumBrowsers(env: CleanerEnv): ChromiumBrowser[] {
  const p = env.platform === 'win32' ? path.win32 : path.posix
  if (env.platform === 'win32') {
    const L = env.localAppData
    const R = env.appData
    return [
      { id: 'chrome', name: 'Google Chrome', userData: p.join(L, 'Google', 'Chrome', 'User Data'), processNames: ['chrome'] },
      { id: 'edge', name: 'Microsoft Edge', userData: p.join(L, 'Microsoft', 'Edge', 'User Data'), processNames: ['msedge'] },
      { id: 'brave', name: 'Brave', userData: p.join(L, 'BraveSoftware', 'Brave-Browser', 'User Data'), processNames: ['brave'] },
      { id: 'vivaldi', name: 'Vivaldi', userData: p.join(L, 'Vivaldi', 'User Data'), processNames: ['vivaldi'] },
      { id: 'opera', name: 'Opera', userData: p.join(R, 'Opera Software', 'Opera Stable'), singleProfile: true, cacheRoot: p.join(L, 'Opera Software', 'Opera Stable'), processNames: ['opera'] },
      { id: 'opera-gx', name: 'Opera GX', userData: p.join(R, 'Opera Software', 'Opera GX Stable'), singleProfile: true, cacheRoot: p.join(L, 'Opera Software', 'Opera GX Stable'), processNames: ['opera'] }
    ]
  }
  if (env.platform === 'darwin') {
    const AS = p.join(env.home, 'Library', 'Application Support')
    const C = p.join(env.home, 'Library', 'Caches')
    return [
      { id: 'chrome', name: 'Google Chrome', userData: p.join(AS, 'Google', 'Chrome'), cacheRoot: p.join(C, 'Google', 'Chrome'), processNames: ['google chrome'] },
      { id: 'edge', name: 'Microsoft Edge', userData: p.join(AS, 'Microsoft Edge'), cacheRoot: p.join(C, 'Microsoft Edge'), processNames: ['microsoft edge'] },
      { id: 'brave', name: 'Brave', userData: p.join(AS, 'BraveSoftware', 'Brave-Browser'), cacheRoot: p.join(C, 'BraveSoftware', 'Brave-Browser'), processNames: ['brave browser'] },
      { id: 'vivaldi', name: 'Vivaldi', userData: p.join(AS, 'Vivaldi'), cacheRoot: p.join(C, 'Vivaldi'), processNames: ['vivaldi'] },
      { id: 'opera', name: 'Opera', userData: p.join(AS, 'com.operasoftware.Opera'), singleProfile: true, cacheRoot: p.join(C, 'com.operasoftware.Opera'), processNames: ['opera'] }
    ]
  }
  const CFG = p.join(env.home, '.config')
  const C = p.join(env.home, '.cache')
  return [
    { id: 'chrome', name: 'Google Chrome', userData: p.join(CFG, 'google-chrome'), cacheRoot: p.join(C, 'google-chrome'), processNames: ['chrome'] },
    { id: 'chromium', name: 'Chromium', userData: p.join(CFG, 'chromium'), cacheRoot: p.join(C, 'chromium'), processNames: ['chromium', 'chromium-browser'] },
    { id: 'edge', name: 'Microsoft Edge', userData: p.join(CFG, 'microsoft-edge'), cacheRoot: p.join(C, 'microsoft-edge'), processNames: ['msedge'] },
    { id: 'brave', name: 'Brave', userData: p.join(CFG, 'BraveSoftware', 'Brave-Browser'), cacheRoot: p.join(C, 'BraveSoftware', 'Brave-Browser'), processNames: ['brave'] },
    { id: 'vivaldi', name: 'Vivaldi', userData: p.join(CFG, 'vivaldi'), cacheRoot: p.join(C, 'vivaldi'), processNames: ['vivaldi-bin', 'vivaldi'] },
    { id: 'opera', name: 'Opera', userData: p.join(CFG, 'opera'), singleProfile: true, cacheRoot: p.join(C, 'opera'), processNames: ['opera'] }
  ]
}

const CHROMIUM_CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Service Worker/CacheStorage', 'Service Worker/ScriptCache']
const CHROMIUM_ROOT_CACHE_DIRS = ['GrShaderCache', 'ShaderCache', 'GraphiteDawnCache']
// Bookmarks ("Bookmarks"), passwords ("Login Data"), autofill ("Web Data"), extensions and preferences are deliberately absent.
const CHROMIUM_HISTORY_FILES = ['History', 'History-journal', 'Visited Links', 'Top Sites', 'Top Sites-journal', 'Shortcuts', 'Shortcuts-journal', 'Network Action Predictor', 'Network Action Predictor-journal']
const CHROMIUM_COOKIE_FILES = ['Cookies', 'Cookies-journal']

/** Targets for one Chromium browser given the profile directories that exist on disk. */
export function chromiumTargets(b: ChromiumBrowser, profiles: string[], platform: CleanerEnv['platform']): TargetDef[] {
  const p = platform === 'win32' ? path.win32 : path.posix
  const cache: PathSpec[] = []
  const history: PathSpec[] = []
  const cookies: PathSpec[] = []
  for (const profile of profiles) {
    for (const d of CHROMIUM_CACHE_DIRS) cache.push({ mode: 'contents', dir: p.join(profile, ...d.split('/')) })
    history.push({ mode: 'files', dir: profile, names: CHROMIUM_HISTORY_FILES })
    history.push({ mode: 'contents', dir: p.join(profile, 'Sessions') })
    cookies.push({ mode: 'files', dir: p.join(profile, 'Network'), names: CHROMIUM_COOKIE_FILES })
    cookies.push({ mode: 'files', dir: profile, names: CHROMIUM_COOKIE_FILES })
  }
  if (!b.singleProfile) for (const d of CHROMIUM_ROOT_CACHE_DIRS) cache.push({ mode: 'contents', dir: p.join(b.userData, d) })
  if (b.cacheRoot) cache.push({ mode: 'contents', dir: b.cacheRoot })
  const base = { browser: b.name, requiresAdmin: false, measurable: true, processNames: b.processNames }
  return [
    def('browser-cache', { ...base, id: `browser:${b.id}:cache`, specs: cache }),
    def('browser-history', { ...base, id: `browser:${b.id}:history`, specs: history }),
    def('browser-cookies', { ...base, id: `browser:${b.id}:cookies`, specs: cookies })
  ]
}

export interface FirefoxLayout {
  profilesRoot: string
  /** Where cache2 lives for a profile name (local appdata / ~/.cache / ~/Library/Caches). */
  cacheRootFor: (profileName: string) => string
}

export function firefoxLayout(env: CleanerEnv): FirefoxLayout {
  if (env.platform === 'win32') {
    const p = path.win32
    return {
      profilesRoot: p.join(env.appData, 'Mozilla', 'Firefox', 'Profiles'),
      cacheRootFor: (n) => p.join(env.localAppData, 'Mozilla', 'Firefox', 'Profiles', n)
    }
  }
  const p = path.posix
  if (env.platform === 'darwin') {
    return {
      profilesRoot: p.join(env.home, 'Library', 'Application Support', 'Firefox', 'Profiles'),
      cacheRootFor: (n) => p.join(env.home, 'Library', 'Caches', 'Firefox', 'Profiles', n)
    }
  }
  return {
    profilesRoot: p.join(env.home, '.mozilla', 'firefox'),
    cacheRootFor: (n) => p.join(env.home, '.cache', 'mozilla', 'firefox', n)
  }
}

export function firefoxTargets(env: CleanerEnv, profileNames: string[]): TargetDef[] {
  const p = env.platform === 'win32' ? path.win32 : path.posix
  const layout = firefoxLayout(env)
  const cache: PathSpec[] = []
  const history: PathSpec[] = []
  const cookies: PathSpec[] = []
  for (const name of profileNames) {
    const profile = p.join(layout.profilesRoot, name)
    cache.push({ mode: 'contents', dir: p.join(layout.cacheRootFor(name), 'cache2') })
    cache.push({ mode: 'contents', dir: p.join(layout.cacheRootFor(name), 'startupCache') })
    cache.push({ mode: 'contents', dir: p.join(layout.cacheRootFor(name), 'thumbnails') })
    // History rows are removed with SQL (places.sqlite also stores bookmarks); session files restore old tabs.
    history.push({ mode: 'files', dir: profile, names: ['sessionstore.jsonlz4'] })
    history.push({ mode: 'contents', dir: p.join(profile, 'sessionstore-backups') })
    cookies.push({ mode: 'files', dir: profile, names: ['cookies.sqlite', 'cookies.sqlite-wal', 'cookies.sqlite-shm'] })
  }
  const base = { browser: 'Firefox', requiresAdmin: false, measurable: true, processNames: ['firefox', 'firefox-bin', 'firefox-esr'] }
  return [
    def('browser-cache', { ...base, id: 'browser:firefox:cache', specs: cache }),
    def('browser-history', { ...base, id: 'browser:firefox:history', specs: history, actions: ['firefox-history'] }),
    def('browser-cookies', { ...base, id: 'browser:firefox:cookies', specs: cookies })
  ]
}

export function safariTargets(env: CleanerEnv): TargetDef[] {
  if (env.platform !== 'darwin') return []
  const p = path.posix
  const lib = p.join(env.home, 'Library')
  const container = p.join(lib, 'Containers', 'com.apple.Safari', 'Data', 'Library')
  const base = { browser: 'Safari', requiresAdmin: false, measurable: true, processNames: ['safari'] }
  return [
    def('browser-cache', { ...base, id: 'browser:safari:cache', specs: [{ mode: 'contents', dir: p.join(lib, 'Caches', 'com.apple.Safari') }, { mode: 'contents', dir: p.join(container, 'Caches') }] }),
    def('browser-history', { ...base, id: 'browser:safari:history', specs: [{ mode: 'files', dir: p.join(lib, 'Safari'), names: ['History.db', 'History.db-wal', 'History.db-shm', 'LastSession.plist'] }] }),
    def('browser-cookies', { ...base, id: 'browser:safari:cookies', specs: [{ mode: 'files', dir: p.join(container, 'Cookies'), names: ['Cookies.binarycookies'] }] })
  ]
}

// ───────────── System ─────────────

/** Browser caches live inside the generic user cache dirs on macOS/Linux; excluded there to avoid double counting. */
const UNIX_BROWSER_CACHE_DIRS = ['google', 'google-chrome', 'chromium', 'mozilla', 'firefox', 'microsoft-edge', 'microsoft edge', 'bravesoftware', 'vivaldi', 'opera', 'com.operasoftware.opera', 'com.apple.safari']

export function systemTargets(env: CleanerEnv): TargetDef[] {
  if (env.platform === 'win32') {
    const p = path.win32
    const L = env.localAppData
    return [
      def('user-temp', {
        requiresAdmin: false,
        measurable: true,
        specs: [
          { mode: 'contents', dir: env.temp },
          { mode: 'contents', dir: p.join(L, 'CrashDumps') },
          { mode: 'contents', dir: p.join(L, 'D3DSCache') },
          { mode: 'contents', dir: p.join(L, 'NVIDIA', 'DXCache') },
          { mode: 'contents', dir: p.join(L, 'NVIDIA', 'GLCache') },
          { mode: 'contents', dir: p.join(L, 'AMD', 'DxCache') },
          { mode: 'match', dir: p.join(L, 'Microsoft', 'Windows', 'Explorer'), pattern: /^(thumbcache|iconcache)_.*\.db$/i }
        ]
      }),
      def('system-temp', {
        requiresAdmin: true,
        measurable: true,
        specs: [
          { mode: 'contents', dir: p.join(env.systemRoot, 'Temp') },
          { mode: 'contents', dir: p.join(env.programData, 'Microsoft', 'Windows', 'WER', 'ReportArchive') },
          { mode: 'contents', dir: p.join(env.programData, 'Microsoft', 'Windows', 'WER', 'ReportQueue') }
        ]
      }),
      def('update-cache', {
        requiresAdmin: true,
        measurable: true,
        specs: [
          { mode: 'contents', dir: p.join(env.systemRoot, 'SoftwareDistribution', 'Download') },
          { mode: 'contents', dir: p.join(env.systemRoot, 'ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization', 'Cache') }
        ]
      }),
      // Memory dumps written after crashes/blue screens: only useful to diagnose a crash that already happened.
      def('crash-dumps', {
        requiresAdmin: true,
        measurable: true,
        specs: [
          { mode: 'files', dir: env.systemRoot, names: ['MEMORY.DMP'] },
          { mode: 'contents', dir: p.join(env.systemRoot, 'Minidump') },
          { mode: 'contents', dir: p.join(env.systemRoot, 'LiveKernelReports') }
        ]
      }),
      // Previous Windows installation and applied-update leftovers, removed by Windows' own Disk Cleanup handlers.
      def('windows-old', {
        requiresAdmin: true,
        measurable: true,
        measureOnly: true,
        alwaysAvailable: true,
        specs: [
          { mode: 'contents', dir: p.join(p.parse(env.systemRoot).root, 'Windows.old') },
          { mode: 'contents', dir: p.join(p.parse(env.systemRoot).root, '$Windows.~BT') },
          { mode: 'contents', dir: p.join(p.parse(env.systemRoot).root, '$Windows.~WS') }
        ],
        actions: ['windows-setup-cleanup']
      }),
      def('recycle-bin', { requiresAdmin: false, measurable: true, specs: [], actions: ['recycle-bin-windows'] }),
      // ipconfig /flushdns needs an elevated token on current Windows releases.
      def('dns-cache', { requiresAdmin: true, measurable: false, specs: [], actions: ['dns-flush'] }),
      def('dev-caches', {
        requiresAdmin: false,
        measurable: true,
        specs: [
          { mode: 'contents', dir: p.join(L, 'npm-cache', '_cacache') },
          { mode: 'contents', dir: p.join(L, 'Yarn', 'Cache') },
          { mode: 'contents', dir: p.join(L, 'pip', 'cache') }
        ]
      })
    ]
  }

  const p = path.posix
  if (env.platform === 'darwin') {
    return [
      def('user-temp', {
        requiresAdmin: false,
        measurable: true,
        specs: [
          { mode: 'contents', dir: p.join(env.home, 'Library', 'Caches'), exclude: UNIX_BROWSER_CACHE_DIRS },
          { mode: 'contents', dir: p.join(env.home, 'Library', 'Logs', 'DiagnosticReports') }
        ]
      }),
      def('system-temp', {
        requiresAdmin: true,
        measurable: true,
        specs: [],
        privileged: [
          'find /Library/Caches -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true',
          'find /Library/Logs/DiagnosticReports -mindepth 1 -delete 2>/dev/null || true'
        ]
      }),
      def('recycle-bin', { requiresAdmin: false, measurable: true, specs: [{ mode: 'contents', dir: p.join(env.home, '.Trash') }] }),
      def('dns-cache', { requiresAdmin: true, measurable: false, specs: [], privileged: ['dscacheutil -flushcache', 'killall -HUP mDNSResponder 2>/dev/null || true'] }),
      def('dev-caches', { requiresAdmin: false, measurable: true, specs: [{ mode: 'contents', dir: p.join(env.home, '.npm', '_cacache') }] })
    ]
  }

  return [
    def('user-temp', {
      requiresAdmin: false,
      measurable: true,
      specs: [{ mode: 'contents', dir: p.join(env.home, '.cache'), exclude: UNIX_BROWSER_CACHE_DIRS }]
    }),
    def('system-temp', {
      requiresAdmin: true,
      measurable: true,
      specs: [],
      privileged: [
        'find /var/crash -mindepth 1 -delete 2>/dev/null || true',
        'find /var/tmp -mindepth 1 -mtime +7 -delete 2>/dev/null || true',
        'command -v journalctl >/dev/null && journalctl --vacuum-time=7d >/dev/null 2>&1 || true'
      ]
    }),
    def('update-cache', {
      requiresAdmin: true,
      measurable: true,
      specs: [],
      privileged: [
        'command -v apt-get >/dev/null && apt-get clean || true',
        'command -v dnf >/dev/null && dnf clean packages >/dev/null || true',
        'command -v pacman >/dev/null && pacman -Sc --noconfirm >/dev/null || true'
      ]
    }),
    def('recycle-bin', {
      requiresAdmin: false,
      measurable: true,
      specs: [
        { mode: 'contents', dir: p.join(env.home, '.local', 'share', 'Trash', 'files') },
        { mode: 'contents', dir: p.join(env.home, '.local', 'share', 'Trash', 'info') }
      ]
    }),
    def('dns-cache', { requiresAdmin: true, measurable: false, specs: [], privileged: ['command -v resolvectl >/dev/null && resolvectl flush-caches || true'] }),
    def('dev-caches', { requiresAdmin: false, measurable: true, specs: [{ mode: 'contents', dir: p.join(env.home, '.npm', '_cacache') }] })
  ]
}

/**
 * A directory is only cleanable if it is specific enough: never a drive or
 * filesystem root, the home folder, the OS folder or a well-known parent.
 * Guards against a misconfigured %TEMP% such as "C:\".
 */
/** Regenerable Chromium/Electron cache folders inside an app's user-data directory. */
export const APP_CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GrShaderCache', 'ShaderCache', 'CachedData', 'CachedExtensionVSIXs', path.join('Crashpad', 'reports')]

/** A user-data dir of a Chromium-based app has these next to its caches; without them a "Cache" folder may hold real data. */
export const CHROMIUM_MARKERS = ['Local State', 'Preferences', 'Local Storage', 'Session Storage', 'Network']

/**
 * Folders never scanned for app caches: browsers (their own targets handle
 * cache vs. history), system plumbing and RePID itself (Electron).
 */
export const APP_CACHE_EXCLUDE = new Set(
  ['Google', 'Microsoft', 'BraveSoftware', 'Vivaldi', 'Opera Software', 'Mozilla', 'Chromium', 'Yandex', 'Packages', 'Temp', 'RePID Identity', 'Electron', 'npm-cache', 'pip', 'Yarn'].map((n) => n.toLowerCase())
)

export function isSafeCleanRoot(dir: string, env: CleanerEnv): boolean {
  const p = env.platform === 'win32' ? path.win32 : path.posix
  const norm = (x: string) => p.resolve(x).replace(/[\\/]+$/, '').toLowerCase()
  const target = norm(dir)
  const forbidden = [env.home, env.appData, env.localAppData, env.systemRoot, env.programData, p.dirname(env.home), '/', '/users', '/home', '/library', '/var', '/usr', '/etc']
    .filter(Boolean)
    .map(norm)
  if (forbidden.includes(target)) return false
  const segments = target.split(/[\\/]/).filter((s) => s && !/^[a-z]:$/.test(s))
  // C:\Windows\Temp is the shallowest legitimate target (2 segments); C:\Temp or /tmp-like roots are refused.
  return segments.length >= 2
}
