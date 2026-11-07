/** Quick actions RePID understands from OS launchers (jump list, dock, .desktop) and context menu. */
export type QuickAction =
  | { kind: 'open'; view?: string }
  | { kind: 'smart-free' }
  | { kind: 'toggle-widget' }
  | { kind: 'disk-scan'; path: string }

const VIEWS = new Set([
  'dashboard',
  'processes',
  'network',
  'health',
  'boost',
  'automation',
  'startup',
  'services',
  'cleaner',
  'disk',
  'uninstall',
  'updates',
  'settings',
  'about'
])

/**
 * Parses the launch/second-instance argv for a RePID quick action. Only a
 * fixed set of flags is recognized; anything else (including arbitrary paths)
 * is ignored, so a crafted shortcut cannot drive the app into an unexpected
 * state. Returns null when there is no action.
 */
export function parseQuickAction(argv: readonly string[]): QuickAction | null {
  for (const arg of argv) {
    if (arg === '--smart-free') return { kind: 'smart-free' }
    if (arg === '--toggle-widget') return { kind: 'toggle-widget' }
    const open = arg.match(/^--open=([a-z]+)$/)
    if (open && VIEWS.has(open[1])) return { kind: 'open', view: open[1] }
    const scan = arg.match(/^--disk-scan=(.+)$/)
    if (scan && /^[a-zA-Z]:[\\/]|^\//.test(scan[1])) return { kind: 'disk-scan', path: scan[1] }
  }
  return null
}
