import { lstat, readdir, rmdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { PathSpec } from './targets'

export interface Tally {
  bytes: number
  count: number
  /** Entries that could not be read or removed (in use, permission denied). */
  skipped: number
  /** At least one EPERM/EACCES was hit. */
  denied: boolean
}

const MAX_DEPTH = 48
const CONCURRENCY = 32

export const emptyTally = (): Tally => ({ bytes: 0, count: 0, skipped: 0, denied: false })

function merge(into: Tally, t: Tally): void {
  into.bytes += t.bytes
  into.count += t.count
  into.skipped += t.skipped
  into.denied ||= t.denied
}

function isDenied(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code
  return code === 'EPERM' || code === 'EACCES'
}

/** True when `child` is strictly inside `root` (case-insensitive on Windows). */
export function isInside(child: string, root: string): boolean {
  const p = /^[a-z]:[\\/]/i.test(root) || root.includes('\\') ? path.win32 : path.posix
  const a = p.resolve(child)
  const b = p.resolve(root)
  const rel = p === path.win32 ? p.relative(b.toLowerCase(), a.toLowerCase()) : p.relative(b, a)
  return rel !== '' && !rel.startsWith('..') && !p.isAbsolute(rel)
}

async function mapLimited<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += CONCURRENCY) await Promise.all(items.slice(i, i + CONCURRENCY).map(fn))
}

/**
 * Measures or deletes one entry. Symbolic links and junctions are never
 * followed: only the link itself is removed, so a link pointing at
 * Documents can never make the cleaner descend into it.
 */
async function walk(entry: string, root: string, remove: boolean, depth: number): Promise<Tally> {
  const t = emptyTally()
  if (!isInside(entry, root)) return t
  let st
  try {
    st = await lstat(entry)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      t.skipped++
      t.denied = isDenied(err)
    }
    return t
  }

  if (st.isDirectory() && !st.isSymbolicLink() && depth < MAX_DEPTH) {
    let names: string[] = []
    try {
      names = await readdir(entry)
    } catch (err) {
      t.skipped++
      t.denied = isDenied(err)
      return t
    }
    await mapLimited(names, async (n) => merge(t, await walk(path.join(entry, n), root, remove, depth + 1)))
    if (remove) {
      try {
        await rmdir(entry)
      } catch {
        // still has locked children — already counted as skipped
      }
    }
    return t
  }

  if (!remove) {
    t.bytes += st.isSymbolicLink() ? 0 : st.size
    t.count++
    return t
  }
  try {
    try {
      await unlink(entry)
    } catch (err) {
      // Directory junctions/symlinks on Windows are removed with rmdir; the target is untouched.
      if (!st.isSymbolicLink()) throw err
      await rmdir(entry)
    }
    t.bytes += st.isSymbolicLink() ? 0 : st.size
    t.count++
  } catch (err) {
    // EBUSY: file open by a running program (common in %TEMP%) — skip it, never force.
    t.skipped++
    t.denied ||= isDenied(err)
  }
  return t
}

async function entriesOf(spec: PathSpec): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(spec.dir)
  } catch {
    return []
  }
  if (spec.mode === 'contents') {
    const exclude = new Set((spec.exclude ?? []).map((e) => e.toLowerCase()))
    names = names.filter((n) => !exclude.has(n.toLowerCase()))
  } else if (spec.mode === 'files') {
    const wanted = new Set(spec.names)
    names = names.filter((n) => wanted.has(n))
  } else {
    names = names.filter((n) => spec.pattern.test(n))
  }
  return names.map((n) => path.join(spec.dir, n))
}

/** Measures (remove = false) or deletes (remove = true) everything a spec covers. */
export async function processSpec(spec: PathSpec, remove: boolean): Promise<Tally> {
  const total = emptyTally()
  try {
    await readdir(spec.dir)
  } catch (err) {
    if (isDenied(err)) {
      total.denied = true
      total.skipped++
    }
    return total
  }
  const entries = await entriesOf(spec)
  await mapLimited(entries, async (e) => merge(total, await walk(e, spec.dir, remove, 0)))
  return total
}

export async function dirExists(dir: string): Promise<boolean> {
  try {
    return (await lstat(dir)).isDirectory()
  } catch {
    return false
  }
}

export async function listDirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
}
