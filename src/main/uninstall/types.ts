import type { ProductKeys } from '../../shared/engine/uninstall'
import type { InstalledApp, Leftover } from '../../shared/types'

/** Inventory entry plus the data needed to act on it (never sent to the UI). */
export interface AppRecord {
  app: InstalledApp
  /** Product names used to find leftovers (see shared/engine/uninstall.ts). */
  products: ProductKeys
  vendors: string[]
  data: Record<string, string>
}

/** A leftover plus how to remove it. `target` is re-validated before deletion. */
export interface LeftoverRecord extends Leftover {
  target: { type: 'path'; path: string } | { type: 'reg-key'; key: string } | { type: 'reg-value'; key: string; value: string } | { type: 'task'; name: string }
}

export interface RunOutcome {
  status: 'done' | 'failed' | 'cancelled' | 'needs-admin' | 'missing'
  exitCode?: number
  error?: string
}

export interface PlatformUninstaller {
  inventory(): Promise<AppRecord[]>
  run(record: AppRecord, mode: 'standard' | 'quiet'): Promise<RunOutcome>
  leftovers(record: AppRecord, others: AppRecord[]): Promise<LeftoverRecord[]>
  /** Removes registry/task leftovers (paths go to the trash in the manager). */
  removeNonFile?(leftover: LeftoverRecord, backupDir: string): Promise<{ ok: boolean; needsAdmin?: boolean; error?: string }>
}
