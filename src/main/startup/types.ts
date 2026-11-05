import type { StartupSource } from '../../shared/types'

/** An autostart entry as the OS reports it, before classification. */
export interface RawStartup {
  id: string
  source: StartupSource
  /** Registry value, shortcut file, task path, launchd label or desktop file name. */
  label: string
  command: string
  exe?: string
  /** Display name declared by the entry itself (Store manifest, desktop Name=, login item). */
  declaredName?: string
  enabled: boolean
  /** Enforced by policy (Store task states 3/4): cannot be changed by the user. */
  policyLocked?: boolean
  /** Adapter-private data needed to toggle the entry (never sent to the UI). */
  data?: Record<string, string>
}

export interface ToggleResult {
  ok: boolean
  error?: 'needs-admin' | 'cancelled' | 'failed'
  message?: string
}

export interface JournalEntry {
  id: string
  name: string
  at: number
  data?: Record<string, string>
}

export interface StartupAdapter {
  list(journal: JournalEntry[]): Promise<RawStartup[]>
  setEnabled(entry: RawStartup, enabled: boolean): Promise<ToggleResult>
}
