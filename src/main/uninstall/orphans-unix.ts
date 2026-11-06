import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isOwnedName, isProtectedDirName, orphanVerdict, ownedNameSet } from '../../shared/engine/uninstall'
import { matchesBundle } from './darwin'
import { inspectFolder, isDirectory } from './fsutil'
import type { AppRecord, LeftoverRecord } from './types'

let seq = 0
const nextId = () => `u${Date.now().toString(36)}${(seq++).toString(36)}`
const BUNDLE_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+){2,}/i

/**
 * macOS: ~/Library entries named after a bundle id that no installed app
 * has (and not Apple's), plus Application Support folders no installed app
 * name claims. All are left for review (medium); recently used ones skipped.
 */
export async function darwinOrphans(records: AppRecord[]): Promise<LeftoverRecord[]> {
  const out: LeftoverRecord[] = []
  const bundles = records.map((r) => r.data.bundleId).filter(Boolean)
  const owned = ownedNameSet(records.map((r) => ({ name: r.app.name, products: r.products })))
  const library = join(homedir(), 'Library')
  for (const sub of ['Application Support', 'Caches', 'Containers', 'Group Containers', 'Saved Application State', 'Preferences', 'Logs', 'HTTPStorages', 'WebKit']) {
    for (const entry of await readdir(join(library, sub)).catch(() => [] as string[])) {
      if (/^(com\.apple\.|group\.com\.apple\.|\.)/i.test(entry) || isProtectedDirName(entry)) continue
      const byBundle = BUNDLE_LIKE.test(entry)
      if (byBundle ? bundles.some((b) => matchesBundle(entry, b)) : sub !== 'Application Support' || isOwnedName(entry, owned)) continue
      if (byBundle && isOwnedName(entry.split('.').slice(1, 3).join(''), owned)) continue
      const path = join(library, sub, entry)
      const facts = await inspectFolder(path)
      const verdict = orphanVerdict({ ...facts, gameSaves: false })
      if (verdict === 'skip') continue
      out.push({ id: nextId(), kind: 'folder', location: path, sizeBytes: facts.bytes, confidence: 'medium', reason: 'orphan', lastModified: facts.newest || undefined, target: { type: 'path', path } })
    }
  }
  return out
}

/** Linux: sandboxes in ~/.var/app of Flatpak apps that are no longer installed (unambiguous: the folder is named by the app id). */
export async function linuxOrphans(records: AppRecord[]): Promise<LeftoverRecord[]> {
  const out: LeftoverRecord[] = []
  const installed = new Set(records.map((r) => r.data.appId))
  const base = join(homedir(), '.var', 'app')
  for (const id of await readdir(base).catch(() => [] as string[])) {
    const path = join(base, id)
    if (installed.has(id) || !BUNDLE_LIKE.test(id) || !(await isDirectory(path))) continue
    const facts = await inspectFolder(path)
    out.push({ id: nextId(), kind: 'folder', location: path, sizeBytes: facts.bytes, confidence: 'high', reason: 'orphan', lastModified: facts.newest || undefined, target: { type: 'path', path } })
  }
  return out
}
