/** Contract shared by the main process (engine), the preload bridge and the UI. */

export type Platform = 'win32' | 'darwin' | 'linux' | 'web'

/** critical = never terminated · caution = allowed after an explicit warning · safe = normal */
export type Risk = 'critical' | 'caution' | 'safe'

export type Category =
  | 'system'
  | 'service'
  | 'browser'
  | 'development'
  | 'runtime'
  | 'communication'
  | 'media'
  | 'gaming'
  | 'graphics'
  | 'office'
  | 'cloud'
  | 'security'
  | 'virtualization'
  | 'updater'
  | 'background'
  | 'application'
  | 'unknown'

/**
 * Explains what a process does. The UI translates it:
 *  - catalogId → `catalog.<id>` in the locale files
 *  - otherwise heuristic → `heuristics.<key>` interpolated with params
 */
export interface Identity {
  category: Category
  catalogId?: string
  heuristic?: { key: string; params?: Record<string, string> }
  /** Human friendly vendor/product label when known (e.g. "Google Chrome"). */
  product?: string
  /** Company embedded in the executable's version resource (Windows) or bundle (macOS). */
  publisher?: string
}

export interface ServiceRef {
  /** Service manager identifier: Windows service name, systemd unit or launchd label. */
  name: string
  manager: 'windows-scm' | 'systemd' | 'launchd'
  /** systemd only: unit lives in the per-user manager (`systemctl --user`). */
  scope?: 'system' | 'user'
}

export interface ProcessInfo {
  pid: number
  ppid: number
  name: string
  path: string
  command: string
  user: string
  /** CPU usage in percent of total machine capacity (0–100). */
  cpu: number
  memBytes: number
  /** GPU engine utilization (0–100) when the platform exposes it per process. */
  gpu?: number
  started: string
}

/** Same-named processes that belong to one running application (e.g. 30 Chrome processes). */
export interface AppGroup {
  id: string
  name: string
  rootPid: number
  pids: number[]
  /** Descendants spawned by the app that would also be ended by a root kill. */
  descendantPids: number[]
  cpu: number
  memBytes: number
  gpu: number
  identity: Identity
  risk: Risk
  services: ServiceRef[]
  path: string
  command: string
  user: string
  /** 0–100 composite impact score used for ranking and Smart Free suggestions. */
  impact: number
  /** Disk/file read rate in bytes per second (Windows and Linux). Absent where unmeasured. */
  ioRead?: number
  /** Disk/file write rate in bytes per second. */
  ioWrite?: number
}

export interface GpuController {
  model: string
  vendor: string
  utilization?: number
  memTotalMb?: number
  memUsedMb?: number
}

export interface SystemSnapshot {
  timestamp: number
  platform: Platform
  hostname: string
  /** Running as Administrator/root: required to end other users' processes and stop services. */
  elevated: boolean
  cpu: { load: number; cores: number; brand: string }
  mem: { total: number; used: number; available: number }
  gpu: { utilization?: number; controllers: GpuController[] }
  processCount: number
  /** System-wide disk read/write in bytes per second (sum across processes). */
  diskRead?: number
  diskWrite?: number
  groups: AppGroup[]
}

export interface KillRequest {
  /** Root pids of the trees to end. The engine re-resolves descendants itself. */
  pids: number[]
  /** Skip the graceful phase and force-kill immediately. */
  force?: boolean
  /** Required to touch processes classified as `caution`. */
  allowCaution?: boolean
}

export interface KillOutcome {
  pid: number
  name: string
  status: 'killed' | 'already-exited' | 'protected' | 'denied' | 'failed'
  error?: string
}

export interface KillResult {
  outcomes: KillOutcome[]
  freedMemBytes: number
  freedCpu: number
}

export interface ServiceStopResult {
  service: string
  ok: boolean
  needsElevation: boolean
  error?: string
}

export interface ProcessDetails {
  pid: number
  description?: string
  company?: string
  version?: string
  tree: Array<{ pid: number; ppid: number; name: string; depth: number; cpu: number; memBytes: number }>
}

export interface EngineSettings {
  /** Extra process names the user never wants touched (case-insensitive). */
  protectedNames: string[]
  /** UI language, for the system notifications raised by the main process. */
  language?: string
}

// ───────────── Cleanup ─────────────

/** safe = regenerated automatically · caution = side effects worth knowing · sensitive = irreversible or logs you out */
export type CleanerRisk = 'safe' | 'caution' | 'sensitive'

export type CleanerKind =
  | 'user-temp'
  | 'system-temp'
  | 'update-cache'
  | 'recycle-bin'
  | 'dns-cache'
  | 'dev-caches'
  | 'browser-cache'
  | 'browser-history'
  | 'browser-cookies'
  | 'app-caches'
  | 'crash-dumps'
  | 'windows-old'

export interface CleanerTarget {
  /** Stable id, e.g. "user-temp" or "browser:chrome:history". */
  id: string
  kind: CleanerKind
  group: 'system' | 'browsers' | 'apps'
  /** Browser product name for browser targets. */
  browser?: string
  risk: CleanerRisk
  requiresAdmin: boolean
  defaultSelected: boolean
  /** False for actions with no measurable footprint (DNS flush). */
  measurable: boolean
  sizeBytes: number
  itemCount: number
  available: boolean
  unavailableReason?: 'not-found' | 'needs-full-disk-access' | 'unsupported'
  /** Running processes that lock these files; they must close first. */
  blockedBy: string[]
}

export interface CleanerReport {
  targets: CleanerTarget[]
  elevated: boolean
  scannedAt: number
}

export interface CleanRequest {
  ids: string[]
  /** End the blocking apps (e.g. open browsers) before cleaning. */
  closeBlocking: boolean
  /** Required when any selected target is `sensitive`. */
  acknowledgedSensitive: boolean
}

export interface CleanOutcome {
  id: string
  status: 'cleaned' | 'partial' | 'skipped-running' | 'needs-admin' | 'not-acknowledged' | 'failed'
  freedBytes: number
  removed: number
  skipped: number
  error?: string
}

export interface CleanResult {
  outcomes: CleanOutcome[]
  freedBytes: number
}

// ───────────── Startup manager ─────────────

/**
 * Where an autostart entry lives. Every source is disabled reversibly with the
 * OS's own mechanism (StartupApproved flags, task/launchd disable, XDG Hidden),
 * never by deleting the entry.
 */
export type StartupSource =
  | 'hkcu-run'
  | 'hklm-run'
  | 'hklm-run32'
  | 'user-folder'
  | 'common-folder'
  | 'store-app'
  | 'task'
  | 'launch-agent'
  | 'login-item'
  | 'xdg-user'
  | 'xdg-system'

/** Which consequence text the UI shows before disabling an entry. */
export type StartupEffect =
  | 'updater'
  | 'communication'
  | 'cloud'
  | 'media'
  | 'gaming'
  | 'security'
  | 'hardware'
  | 'browser'
  | 'development'
  | 'system'
  | 'generic'

/** Measured from the entry's running processes right now (not a boot trace). */
export type StartupImpact = 'high' | 'medium' | 'low' | 'not-running'

export interface StartupEntry {
  /** Stable id: `<source>:<name>`. The main process re-resolves it on every action. */
  id: string
  name: string
  publisher?: string
  command: string
  /** Executable resolved from the command (env vars expanded, shortcuts followed). */
  exe?: string
  source: StartupSource
  scope: 'user' | 'machine'
  enabled: boolean
  /** critical = locked (OS component) · caution = warn first · safe */
  risk: Risk
  effect: StartupEffect
  /** Safe to disable and typically not needed at sign-in. */
  recommended: boolean
  requiresAdmin: boolean
  running: { pids: number; memBytes: number; cpu: number } | null
  impact: StartupImpact
  /** Disabled by RePID (listed in its change journal, can be restored in one click). */
  changedByRepid: boolean
}

export interface StartupReport {
  entries: StartupEntry[]
  elevated: boolean
  supported: boolean
  scannedAt: number
}

export interface StartupChangeRequest {
  ids: string[]
  enabled: boolean
  /** Required to change entries classified as `caution`. */
  allowCaution: boolean
}

export interface StartupChangeOutcome {
  id: string
  name: string
  status: 'changed' | 'unchanged' | 'not-found' | 'protected' | 'needs-admin' | 'cancelled' | 'failed'
  error?: string
}

// ───────────── Performance mode ─────────────

export type BoostProfileId = 'gaming' | 'work' | 'creative' | 'custom'

export interface BoostRequest {
  profile: BoostProfileId
  /** App that gets above-normal priority (optional). */
  focusGroupId?: string
  /** Apps that run in efficiency mode (lower priority + EcoQoS on Windows 11). */
  ecoGroupIds: string[]
}

export interface BoostApp {
  /** Cluster key: identifies the app across refreshes and new child processes. */
  key: string
  name: string
  product?: string
  role: 'eco' | 'focus'
  /** Groups currently matching the key. */
  groupIds: string[]
  /** Processes currently adjusted. */
  applied: number
  /** Processes the OS refused (protected/anti-cheat, other session). */
  refused: number
  /** Windows 11 EcoQoS applied on top of the priority change. */
  ecoQos: boolean
  cpu: number
  memBytes: number
}

export interface BoostState {
  active: boolean
  profile?: BoostProfileId
  startedAt?: number
  apps: BoostApp[]
  /** Raising priority needs root on macOS/Linux; Windows always allows above-normal. */
  focusSupported: boolean
  /** Restoring priorities on macOS/Linux asked for a password and the user cancelled. */
  restorePending: boolean
}

// ───────────── Smart uninstaller ─────────────

export type InstallSource = 'win32' | 'msi' | 'store' | 'mac-app' | 'flatpak'

/** What kind of software it is: drives protection and the warning text. */
export type AppKind = 'app' | 'runtime' | 'driver' | 'security' | 'system'

export interface InstalledApp {
  /** Opaque id; the main process re-resolves it against a fresh inventory. */
  id: string
  name: string
  publisher?: string
  version?: string
  /** YYYY-MM-DD when the OS records it. */
  installDate?: string
  sizeBytes?: number
  installLocation?: string
  source: InstallSource
  scope: 'user' | 'machine'
  kind: AppKind
  /** critical = locked (OS component, shared runtime, RePID) · caution = warn first · safe */
  risk: Risk
  /** The app ships a silent uninstall command (or is MSI). */
  hasQuiet: boolean
  /** The registered uninstaller no longer exists: only a forced cleanup is possible. */
  uninstallerMissing: boolean
  requiresAdmin: boolean
  /** Running processes of this app (they are closed first when the user agrees). */
  runningPids: number[]
}

export interface UninstallReport {
  apps: InstalledApp[]
  elevated: boolean
  supported: boolean
  scannedAt: number
}

export interface UninstallRequest {
  id: string
  /** standard = the app's own uninstaller window · quiet = silent command when available */
  mode: 'standard' | 'quiet'
  closeRunning: boolean
  /** Required for apps classified as `caution`. */
  allowCaution: boolean
}

export type LeftoverKind = 'folder' | 'file' | 'registry-key' | 'registry-value' | 'shortcut' | 'task'

export interface Leftover {
  /** Session-scoped id; deletion requests carry ids only, never paths. */
  id: string
  kind: LeftoverKind
  /** File path, registry path (with `\\value` for values) or task path, for display. */
  location: string
  sizeBytes: number
  /** high = provably the app's (its install folder, its keys); medium = matched by exact name. */
  confidence: 'high' | 'medium'
  reason:
    | 'install-dir'
    | 'name-match'
    | 'vendor-dir'
    | 'uninstall-entry'
    | 'points-to-app'
    | 'bundle-id'
    /** Orphan scan: belongs to no installed app, service, driver, running process, startup entry or shortcut. */
    | 'orphan'
    /** Orphan scan: shortcut, startup entry or task whose target no longer exists. */
    | 'broken-target'
    /** Orphan scan: "Installed apps" entry whose uninstaller and folder are gone. */
    | 'broken-entry'
  /** Newest modification inside (orphan scan), epoch ms: shows how long it has been unused. */
  lastModified?: number
}

export interface UninstallResult {
  id: string
  status: 'uninstalled' | 'still-installed' | 'uninstaller-failed' | 'not-found' | 'protected' | 'needs-admin' | 'cancelled'
  exitCode?: number
  error?: string
  leftovers: Leftover[]
}

export interface LeftoverCleanRequest {
  appId: string
  ids: string[]
}

export interface LeftoverOutcome {
  id: string
  status: 'removed' | 'gone' | 'needs-admin' | 'failed'
  error?: string
}

export interface LeftoverCleanResult {
  outcomes: LeftoverOutcome[]
  /** Bytes moved to the Recycle Bin / Trash. */
  recycledBytes: number
  /** Registry keys and tasks were exported here before deletion (Windows). */
  backupDir?: string
}

// ───────────── Disk analyzer ─────────────

export interface DiskRoot {
  /** Session id; scans are requested by id, never by path. */
  id: string
  path: string
  label: string
  kind: 'home' | 'drive'
  totalBytes?: number
  freeBytes?: number
}

export interface DiskNode {
  name: string
  sizeBytes: number
  fileCount: number
  /** Largest children only; smaller ones are folded into one "other files" entry. */
  children?: DiskNode[]
  /** Folded remainder (many small files/folders). */
  other?: boolean
  /** Folder RePID will never offer to delete (system, programs, app data). */
  system?: boolean
}

export interface DiskFile {
  /** Session id; deletion and "show in folder" carry ids only. */
  id: string
  path: string
  sizeBytes: number
  modified: number
  /** False inside system/program folders: shown, never deletable. */
  removable: boolean
}

export interface DuplicateGroup {
  id: string
  sizeBytes: number
  /** Content hash prefix (SHA-256) shared by every copy. */
  hash: string
  files: DiskFile[]
  /** Copy RePID suggests keeping (oldest, outside Downloads/temp folders). */
  keepId: string
}

export interface DiskScanResult {
  rootId: string
  root: string
  scannedAt: number
  durationMs: number
  totalBytes: number
  fileCount: number
  tree: DiskNode
  /** Files ≥ 100 MB, biggest first. */
  largeFiles: DiskFile[]
  /** True when the scan stopped at its file limit or was cancelled. */
  truncated: boolean
}

export interface DuplicateScanResult {
  groups: DuplicateGroup[]
  wastedBytes: number
  hashedBytes: number
  truncated: boolean
}

export interface DiskDeleteRequest {
  ids: string[]
}

export interface DiskDeleteResult {
  removed: number
  recycledBytes: number
  failed: Array<{ id: string; error: string }>
  /** Ids refused because they would delete every copy of a duplicate group or changed since the scan. */
  refused: string[]
}

export interface TaskProgress {
  task: 'disk-scan' | 'duplicates' | 'updates'
  done: number
  total?: number
  current?: string
}

// ───────────── Automation ─────────────

export interface AutomationConfig {
  autoBoost: {
    enabled: boolean
    /** Also boost apps detected as games (gaming category). */
    games: boolean
    /** Extra apps chosen by the user, by process name (lower-case). */
    apps: string[]
  }
  scheduledClean: {
    enabled: boolean
    frequency: 'daily' | 'weekly'
    lastRun?: number
  }
  alerts: {
    memoryGrowth: boolean
    diskLow: boolean
    /** Used-space percentage that triggers the low-disk alert. */
    diskThreshold: number
  }
  background: {
    /** Closing the window keeps RePID in the tray so automation keeps working. */
    keepInTray: boolean
    launchAtLogin: boolean
  }
}

export interface AutomationEvent {
  at: number
  kind: 'boost-on' | 'boost-off' | 'clean' | 'memory-growth' | 'disk-low' | 'error'
  /** Values for the localized message (app name, size, drive…). */
  params: Record<string, string>
}

export interface AutomationState {
  config: AutomationConfig
  events: AutomationEvent[]
  /** App currently boosted by automation (not by the user). */
  autoBoosting?: string
  nextCleanAt?: number
  loginItemSupported: boolean
}

// ───────────── App updates ─────────────

export type UpdateSource = 'winget' | 'brew' | 'brew-cask' | 'flatpak'

export interface AppUpdate {
  /** Package id in its manager (winget id, brew name, flatpak ref). */
  id: string
  name: string
  current: string
  available: string
  source: UpdateSource
  /** New major version (11 → 13): may change behavior or data formats, never pre-selected. */
  major?: boolean
}

export interface UpdateReport {
  supported: boolean
  /** Package manager missing (winget not installed, no Homebrew…). */
  managerMissing?: boolean
  updates: AppUpdate[]
  scannedAt: number
}

export interface UpdateOutcome {
  id: string
  status: 'updated' | 'failed' | 'not-found' | 'needs-admin' | 'cancelled'
  error?: string
}

// ───────────── Health ─────────────

export interface DriveHealth {
  name: string
  media: 'SSD' | 'HDD' | 'NVMe' | 'Unknown'
  sizeBytes: number
  status: 'healthy' | 'warning' | 'unhealthy' | 'unknown'
  temperatureC?: number
  /** SSD wear used, 0–100 %. */
  wearPct?: number
  powerOnHours?: number
  readErrors?: number
}

export interface VolumeUsage {
  mount: string
  sizeBytes: number
  usedBytes: number
}

export interface BatteryHealth {
  /** Full-charge capacity versus design capacity, 0–100 %. */
  capacityPct?: number
  designMWh?: number
  fullMWh?: number
  cycles?: number
  percent?: number
  charging?: boolean
}

export interface HealthFinding {
  severity: 'ok' | 'info' | 'warning' | 'critical'
  key: string
  params?: Record<string, string>
}

export interface HealthReport {
  drives: DriveHealth[]
  volumes: VolumeUsage[]
  battery?: BatteryHealth
  cpuTempC?: number
  gpuTempC?: number
  uptimeSec: number
  /** Reliability counters (wear, temperature) need administrator rights on Windows. */
  elevated: boolean
  findings: HealthFinding[]
  scannedAt: number
}

export interface RestorePointResult {
  status: 'created' | 'recent-exists' | 'disabled' | 'needs-admin' | 'unsupported' | 'failed'
  error?: string
}

export type RestoreReason = 'manual' | 'services' | 'uninstall' | 'cleanup'

// ───────────── Network ─────────────

export interface NetworkApp {
  groupId: string
  name: string
  product?: string
  connections: number
  listening: number[]
  /** Distinct remote hosts (IP:port), busiest first, at most 8. */
  remotes: string[]
  risk: Risk
  blocked: boolean
  /** Has an executable path, so a firewall rule can target it. */
  blockable: boolean
}

export interface NetworkReport {
  apps: NetworkApp[]
  /** Programs blocked by RePID that are not running right now. */
  blockedIdle: Array<{ id: string; path: string }>
  rxBytesPerSec: number
  txBytesPerSec: number
  blockSupported: boolean
  elevated: boolean
  scannedAt: number
}

export interface NetworkBlockRequest {
  /** Running app to block (re-resolved in the main process). */
  groupId?: string
  /** Existing RePID rule to remove. */
  ruleId?: string
  block: boolean
}

export interface NetworkBlockResult {
  status: 'blocked' | 'unblocked' | 'needs-admin' | 'protected' | 'not-found' | 'unsupported' | 'failed'
  error?: string
}

// ───────────── Windows services ─────────────

export interface ServiceEntry {
  name: string
  displayName: string
  /** Curated catalog key (what it does / what happens), or a generic third-party note. */
  catalogKey?: string
  vendor?: string
  thirdParty: boolean
  startMode: 'auto' | 'delayed' | 'manual' | 'disabled'
  running: boolean
  risk: 'safe' | 'caution'
  recommended: boolean
  changedByRepid: boolean
  /** What RePID found before changing it (for undo). */
  originalMode?: 'auto' | 'delayed'
}

export interface ServicesReport {
  supported: boolean
  elevated: boolean
  services: ServiceEntry[]
  scannedAt: number
}

export interface ServiceChangeRequest {
  names: string[]
  /** true = put back as RePID found it, false = set to manual. */
  restore: boolean
  allowCaution: boolean
}

export interface ServiceChangeOutcome {
  name: string
  status: 'changed' | 'needs-admin' | 'not-allowed' | 'not-found' | 'failed'
  error?: string
}

export type Edition = 'free' | 'enterprise'

export interface LicenseInfo {
  id: string
  company: string
  email?: string
  /** Computers covered. */
  seats: number
  issuedAt: number
  expiresAt: number
}

export interface EditionState {
  edition: Edition
  /** Locked sections (automation, services, updates, disk, network) until the reason is solved. */
  limited: boolean
  reason?: 'lan-limit' | 'no-license' | 'expired' | 'seats-exceeded'
  /** Signs of a company computer (domain, Azure AD, server OS, MDM): notice only. */
  corporate: boolean
  corporateSignals: string[]
  /** Free copies of RePID seen on this local network in the last 14 days, this one included. */
  lanInstalls: number
  lanLimit: number
  license?: LicenseInfo & { seatsInUse: number; graceUntil?: number; supportCode: string }
}

export interface AppUpdateInfo {
  current: string
  /** Version of the installer on the download page, when it could be read. */
  latest?: string
  available: boolean
  checkedAt: number
  /** Last check failed (offline, rate limit): the answer may be stale or empty. */
  error?: string
}

/** API exposed on `window.repid` by the preload script. */
export interface RepidApi {
  platform: Platform
  version: string
  snapshot(): Promise<SystemSnapshot>
  details(pid: number): Promise<ProcessDetails | null>
  kill(request: KillRequest): Promise<KillResult>
  stopService(pid: number): Promise<ServiceStopResult>
  setSettings(settings: EngineSettings): Promise<void>
  cleanerScan(): Promise<CleanerReport>
  cleanerClean(request: CleanRequest): Promise<CleanResult>
  startupScan(): Promise<StartupReport>
  startupSet(request: StartupChangeRequest): Promise<StartupChangeOutcome[]>
  /** Re-enables every entry RePID disabled. */
  startupRestore(): Promise<StartupChangeOutcome[]>
  boostStatus(): Promise<BoostState>
  boostApply(request: BoostRequest): Promise<BoostState>
  boostStop(): Promise<BoostState>
  uninstallList(): Promise<UninstallReport>
  /** Runs the app's own uninstaller, waits for it, then scans for leftovers. */
  uninstallRun(request: UninstallRequest): Promise<UninstallResult>
  /** Broken/missing uninstaller: skip it and list the app's leftovers (including its registration). */
  uninstallForceScan(id: string): Promise<UninstallResult>
  /** Leftovers of apps that are no longer installed (orphans, broken shortcuts/entries). Session id: "orphans". */
  uninstallScanOrphans(): Promise<UninstallResult>
  uninstallClean(request: LeftoverCleanRequest): Promise<LeftoverCleanResult>
  /** Opens the folder with registry/task backups (fixed location owned by the main process). */
  uninstallOpenBackups(): Promise<void>
  diskRoots(): Promise<DiskRoot[]>
  diskScan(rootId: string): Promise<DiskScanResult>
  /** Finds identical files (same size, then same SHA-256) under the last scanned root. */
  diskDuplicates(): Promise<DuplicateScanResult>
  diskCancel(): Promise<void>
  diskDelete(request: DiskDeleteRequest): Promise<DiskDeleteResult>
  diskReveal(id: string): Promise<void>
  /** Progress of long tasks (disk scan, duplicates, updates). Returns an unsubscribe function. */
  onProgress(listener: (progress: TaskProgress) => void): () => void
  /** A system notification was clicked: the main process asks the UI to open this section. */
  onNavigate(listener: (view: string) => void): () => void
  automationGet(): Promise<AutomationState>
  automationSet(config: AutomationConfig): Promise<AutomationState>
  updatesScan(): Promise<UpdateReport>
  updatesApply(ids: string[]): Promise<UpdateOutcome[]>
  healthScan(): Promise<HealthReport>
  restorePoint(reason: RestoreReason): Promise<RestorePointResult>
  networkScan(): Promise<NetworkReport>
  networkBlock(request: NetworkBlockRequest): Promise<NetworkBlockResult>
  servicesScan(): Promise<ServicesReport>
  servicesSet(request: ServiceChangeRequest): Promise<ServiceChangeOutcome[]>
  /** Compares this build with the installer on the download page (cached 30 min unless forced). */
  checkAppUpdate(force?: boolean): Promise<AppUpdateInfo>
  /** Opens the fixed download page in the browser. */
  openRelease(): Promise<void>
  edition(): Promise<EditionState>
  /** Enterprise: verifies and stores a signed license key. */
  activateLicense(key: string): Promise<{ ok: boolean; error?: 'invalid' | 'expired' | 'free-edition'; state: EditionState }>
  removeLicense(): Promise<EditionState>
  /** Enterprise with a valid license: opens a pre-filled email to Voxel Enterprise (support or beta access). */
  contactEnterprise(kind: 'support' | 'beta'): Promise<boolean>
  /** Opens the PayPal subscription page (fixed URL). */
  openEnterpriseBuy(): Promise<void>
  openRepo(path?: RepoPath): Promise<void>
  /** Opens the project's donation page (fixed URL owned by the main process). */
  openDonate(): Promise<void>
  /** Windows only: restarts RePID through the UAC prompt. */
  relaunchElevated(): Promise<boolean>
  setTitleBarTheme(theme: 'dark' | 'light'): Promise<void>
}

export type RepoPath = '' | 'stargazers' | 'issues' | 'releases' | 'contributing' | 'translate'
