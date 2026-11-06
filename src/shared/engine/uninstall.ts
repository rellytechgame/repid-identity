import type { AppKind, Risk } from '../types'

/**
 * Pure rules of the smart uninstaller. Leftovers are matched by EXACT
 * normalized name (never "contains"), only directly under well-known roots,
 * and never when another installed app claims the same name or folder.
 */

/** "Notepad++" → "notepad", "Opera GX" → "operagx". */
export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '')
}

/**
 * Folder/key names that are shared by many products or by the OS. A match on
 * one of these is never a leftover, even if an app is literally called that.
 */
const GENERIC = new Set(
  [
    'microsoft', 'windows', 'google', 'apple', 'adobe', 'intel', 'nvidia', 'amd', 'mozilla', 'oracle', 'realtek', 'hp', 'dell', 'lenovo',
    'common', 'commonfiles', 'programs', 'program', 'packages', 'temp', 'tmp', 'cache', 'caches', 'data', 'app', 'apps', 'application',
    'update', 'updater', 'installer', 'setup', 'uninstall', 'bin', 'lib', 'logs', 'log', 'config', 'settings', 'users', 'public',
    'software', 'classes', 'policies', 'wow6432node', 'system', 'system32', 'drivers', 'fonts', 'startmenu', 'desktop', 'documents',
    'downloads', 'local', 'roaming', 'locallow', 'programdata', 'programfiles', 'appdata', 'crashpad', 'crashdumps', 'packagecache', 'helper',
    // Shared ecosystems: %APPDATA%\Python, \npm, .git… hold data of every version/tool, not one app.
    'node', 'nodejs', 'npm', 'python', 'pip', 'java', 'dotnet', 'nuget', 'git', 'electron', 'edge',
    'service', 'services', 'tools', 'utilities', 'client', 'launcher', 'games', 'game', 'studio', 'plugins', 'extensions', 'default'
  ].map(normalize)
)

export function isGenericName(s: string): boolean {
  const n = normalize(s)
  return n.length < 4 || GENERIC.has(n)
}

const LEGAL_SUFFIX = /[,.]?\s+(inc|llc|ltd|limited|corp|corporation|co|company|gmbh|ag|s\.?a|s\.?l|s\.?r\.?l|b\.?v|oy|ab|pty|plc|software|technologies|technology|labs|studios?)\.?$/i

/** "Opera Software" → ["operasoftware", "opera"]; "Mozilla Corporation" → ["mozillacorporation", "mozilla"]. */
export function vendorKeys(publisher: string | undefined): string[] {
  if (!publisher) return []
  let p = publisher.trim()
  const out = new Set([normalize(p)])
  for (let i = 0; i < 3 && LEGAL_SUFFIX.test(p); i++) {
    p = p.replace(LEGAL_SUFFIX, '').trim()
    out.add(normalize(p))
  }
  const first = p.split(/\s+/)[0]
  if (first) out.add(normalize(first))
  return [...out].filter((v) => v.length >= 2)
}

const ARCH = /\s*[([]?\b(x64|x86|x32|64-bit|32-bit|64 bit|32 bit|amd64|arm64|win64|win32)\b[)\]]?/gi
/** Only a TRAILING version is removed: "Visual Studio 2010 Tools for Office" must not shrink to "Visual Studio". */
const VERSION_TAIL = /[\s_-]+(version\s+)?v?\d+([.\-_]\d+)*([a-z]\d*)?$/i
/** "(x64 es-ES)", " - es-es": a locale is only stripped at the END, so words like "Wi-Fi" survive. */
const LOCALE_TAIL = /\s*(?:-\s*)?[([]?\s*\b[a-z]{2}-[a-z]{2}\b\s*[)\]]?\s*$/i

/** Top-level folder/key matches need a distinctive name; shorter ones ("Unity", "Zoom") only count under the vendor folder. */
export const MIN_TOP_LEVEL = 6

export interface ProductKeys {
  /** Distinctive names valid anywhere under the search roots. */
  primary: string[]
  /** Names without the vendor prefix ("Firefox", "Broadcast"): valid only inside the vendor's own folder/key. */
  vendorScoped: string[]
}

/**
 * An install-folder or key name counts as the app's name only when it starts
 * like the display name ("Opera GX" ↔ "Opera GX Stable", "Roadkil.Net" ↔
 * "Roadkil's Unstoppable Copier"). A trailing word ("Insiders", "BuildTools")
 * or a host app's folder ("obs-studio" for a plugin) does not.
 */
function related(folder: string, name: string): boolean {
  return folder.length >= 6 && (name.startsWith(folder) || folder.startsWith(name) || folder.slice(0, 5) === name.slice(0, 5))
}

/**
 * Names under which an app may leave folders and registry keys: its display
 * name without trailing version/architecture/locale, the same without the
 * vendor prefix ("Mozilla Firefox" → "Firefox", vendor-scoped), and its install
 * folder / uninstall key name when they are related to the display name (a
 * plugin installed into "obs-studio" must not claim OBS's name).
 */
export function productKeys(app: { name: string; publisher?: string; installLocation?: string; regKey?: string }): ProductKeys {
  const primary = new Set<string>()
  const scoped = new Set<string>()
  let clean = app.name.replace(ARCH, '').replace(LOCALE_TAIL, '').replace(/[([]\s*[)\]]/g, '').replace(/\s+-\s*$/, '').trim()
  for (let i = 0; i < 2; i++) clean = clean.replace(VERSION_TAIL, '').trim()
  const base = normalize(clean)
  primary.add(base)
  for (const v of vendorKeys(app.publisher)) {
    const words = clean.split(/\s+/)
    if (words.length > 1 && normalize(words[0]) === v) scoped.add(normalize(words.slice(1).join(' ')))
  }
  const extra = [app.installLocation?.replace(/[\\/]+$/, '').split(/[\\/]/).pop(), app.regKey && !/^\{?[0-9a-f-]{36}\}?$/i.test(app.regKey) ? app.regKey.replace(/_is\d+$/i, '') : undefined]
  for (const e of extra) {
    if (!e) continue
    const k = normalize(e.replace(VERSION_TAIL, ''))
    if (k && related(k, base)) primary.add(k)
  }
  const ok = (k: string) => !!k && !isGenericName(k)
  const p = [...primary].filter(ok)
  return { primary: p, vendorScoped: [...scoped].filter((k) => ok(k) && !p.includes(k)) }
}

/** Locked: the OS, shared runtimes other software depends on, and RePID itself. */
const CRITICAL = /^(microsoft (visual c\+\+|\.net|asp\.net|windows desktop runtime|edge webview2|edge$|edge update|update health|gameinput|windows sdk)|windows (sdk|driver package|software development kit|app certification)|\.net (runtime|framework|desktop runtime|host)|repid identity)/i
const RUNTIME = /(runtime|redistributable|framework|sdk|jre|jdk|webview|directx|vcredist|openal|physx)/i
const DRIVER = /(driver|chipset|realtek|nvidia|amd software|radeon|intel\(r\)|synaptics|elan|logitech|razer|corsair|bluetooth|audio|thunderbolt|firmware|bios)/i
const SECURITY = /(antivirus|anti-virus|defender|security|kaspersky|avast|\bavg\b|bitdefender|\beset\b|norton|mcafee|malwarebytes|sophos|vpn|firewall)/i

export function classifyApp(name: string, publisher = ''): { kind: AppKind; risk: Risk } {
  const text = `${name} ${publisher}`
  if (CRITICAL.test(name.trim())) return { kind: RUNTIME.test(name) ? 'runtime' : 'system', risk: 'critical' }
  if (SECURITY.test(text)) return { kind: 'security', risk: 'caution' }
  if (DRIVER.test(text)) return { kind: 'driver', risk: 'caution' }
  if (RUNTIME.test(name)) return { kind: 'runtime', risk: 'caution' }
  return { kind: 'app', risk: 'safe' }
}

/**
 * Uninstall commands as Windows stores them. MSI entries are rebuilt from the
 * product code (`msiexec /x {GUID}`) so the stored string is never executed.
 */
export function parseUninstallString(s: string): { kind: 'msi'; productCode: string } | { kind: 'exe'; exe: string; args: string } | null {
  const t = s.trim()
  if (!t) return null
  const msi = t.match(/^"?(?:[a-z]:\\[^"]*\\)?msiexec(?:\.exe)?"?\s+.*?\/[ix]\s*(\{[0-9a-f-]{36}\})/i)
  if (msi) return { kind: 'msi', productCode: msi[1].toUpperCase() }
  if (t.startsWith('"')) {
    const end = t.indexOf('"', 1)
    if (end < 0) return null
    return { kind: 'exe', exe: t.slice(1, end), args: t.slice(end + 1).trim() }
  }
  const m = t.match(/^(.*?\.exe)(?=\s|$)/i)
  return m ? { kind: 'exe', exe: m[1], args: t.slice(m[1].length).trim() } : null
}

export interface FolderCandidate {
  path: string
  reason: 'name-match' | 'vendor-dir'
  confidence: 'high' | 'medium'
}

/**
 * Leftover folders directly under a root (`root\Product`) or under the
 * vendor's folder (`root\Vendor\Product`). `listing` maps a directory to its
 * child folder names. Names claimed by other installed apps are excluded.
 */
export function matchFolders(
  root: string,
  listing: (dir: string) => string[],
  keys: ProductKeys,
  vendors: string[],
  claimedByOthers: ReadonlySet<string>,
  sep: '\\' | '/'
): FolderCandidate[] {
  const top = new Set(keys.primary.filter((p) => p.length >= MIN_TOP_LEVEL && !claimedByOthers.has(p)))
  const underVendor = new Set([...keys.primary, ...keys.vendorScoped].filter((p) => !claimedByOthers.has(p)))
  const out: FolderCandidate[] = []
  for (const child of listing(root)) {
    const n = normalize(child)
    if (top.has(n)) {
      out.push({ path: `${root}${sep}${child}`, reason: 'name-match', confidence: 'high' })
    } else if (vendors.includes(n)) {
      const vendorDir = `${root}${sep}${child}`
      for (const sub of listing(vendorDir)) {
        if (underVendor.has(normalize(sub))) out.push({ path: `${vendorDir}${sep}${sub}`, reason: 'vendor-dir', confidence: 'high' })
      }
    }
  }
  return out
}

export function isUninstallId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 3 && value.length <= 600 && !/[\u0000-\u001f]/.test(value)
}
