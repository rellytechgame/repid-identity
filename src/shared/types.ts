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
  openRepo(path?: RepoPath): Promise<void>
  /** Opens the project's donation page (fixed URL owned by the main process). */
  openDonate(): Promise<void>
  /** Windows only: restarts RePID through the UAC prompt. */
  relaunchElevated(): Promise<boolean>
  setTitleBarTheme(theme: 'dark' | 'light'): Promise<void>
}

export type RepoPath = '' | 'stargazers' | 'issues' | 'releases' | 'contributing' | 'translate'
