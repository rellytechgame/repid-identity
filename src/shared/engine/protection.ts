import type { Platform, Risk } from '../types'

/**
 * Safety net. Ending any of these brings the session down (BSOD, logout,
 * kernel panic, frozen display) or is refused by the OS anyway, so the engine
 * never touches them regardless of what the UI sends.
 */
const CRITICAL: Record<Exclude<Platform, 'web'>, string[]> = {
  win32: [
    'system', 'system idle process', 'idle', 'registry', 'secure system', 'memory compression',
    'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'lsaiso', 'svchost',
    'fontdrvhost', 'dwm', 'msmpeng', 'mpdefendercoreservice', 'nissrv', 'securityhealthservice',
    'wudfhost', 'conhost', 'trustedinstaller', 'logonui', 'userinit', 'sgrmbroker'
  ],
  darwin: [
    'kernel_task', 'launchd', 'windowserver', 'loginwindow', 'logd', 'configd', 'opendirectoryd',
    'securityd', 'trustd', 'syspolicyd', 'kextd', 'kernelmanagerd', 'notifyd', 'distnoted',
    'mds', 'powerd', 'usermanagerd', 'watchdogd', 'runningboardd', 'diskarbitrationd'
  ],
  linux: [
    'systemd', 'init', 'kthreadd', 'xorg', 'xwayland', 'gnome-shell', 'kwin_x11', 'kwin_wayland',
    'plasmashell', 'dbus-daemon', 'dbus-broker', 'systemd-journald', 'systemd-logind', 'systemd-udevd',
    'gdm', 'gdm3', 'sddm', 'lightdm', 'login', 'agetty', 'polkitd', 'mutter', 'weston', 'sway', 'hyprland'
  ]
}

/** Prefix patterns for kernel threads and per-CPU workers on Linux. */
const CRITICAL_PREFIXES: Record<Exclude<Platform, 'web'>, string[]> = {
  win32: [],
  darwin: ['com.apple.security', 'com.apple.kernel'],
  linux: ['kworker', 'ksoftirqd', 'migration/', 'rcu_', 'kswapd', 'watchdog/', 'irq/', 'cpuhp/']
}

/** Allowed, but the user must acknowledge a warning (desktop shell, audio, etc. restart or glitch). */
const CAUTION: Record<Exclude<Platform, 'web'>, string[]> = {
  win32: [
    'explorer', 'sihost', 'ctfmon', 'runtimebroker', 'audiodg', 'spoolsv', 'searchindexer',
    'shellexperiencehost', 'startmenuexperiencehost', 'textinputhost', 'taskhostw', 'wmiprvse',
    'vmmem', 'vmmemwsl', 'vmcompute', 'wslservice', 'tiworker', 'msiexec', 'dllhost', 'smartscreen'
  ],
  darwin: ['finder', 'dock', 'systemuiserver', 'coreaudiod', 'controlcenter', 'mds_stores', 'mdworker', 'bluetoothd', 'spotlight'],
  linux: ['pipewire', 'pipewire-pulse', 'wireplumber', 'pulseaudio', 'networkmanager', 'sshd', 'nautilus', 'snapd', 'packagekitd', 'cupsd', 'bluetoothd']
}

/** Lowercase and strip Windows executable extensions so "Chrome.exe" == "chrome". */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\.(exe|com|bin)$/, '')
}

export interface ProtectionContext {
  platform: Platform
  /** Pids that belong to RePID itself (never kill ourselves mid-operation). */
  selfPids: ReadonlySet<number>
  /** User-defined names, already normalized. */
  userProtected: ReadonlySet<string>
}

export function riskOf(pid: number, name: string, ctx: ProtectionContext): Risk {
  // pid 0/1 (idle/init/launchd) and 4 (Windows System) are always kernel-owned.
  if (pid <= 1 || (ctx.platform === 'win32' && pid === 4)) return 'critical'
  if (ctx.selfPids.has(pid)) return 'critical'

  const n = normalizeName(name)
  if (ctx.userProtected.has(n)) return 'critical'
  if (ctx.platform === 'web') return 'safe'

  if (CRITICAL[ctx.platform].includes(n)) return 'critical'
  if (CRITICAL_PREFIXES[ctx.platform].some((p) => n.startsWith(p))) return 'critical'
  if (CAUTION[ctx.platform].includes(n)) return 'caution'
  return 'safe'
}

const RISK_ORDER: Record<Risk, number> = { safe: 0, caution: 1, critical: 2 }

export function maxRisk(a: Risk, b: Risk): Risk {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b
}
