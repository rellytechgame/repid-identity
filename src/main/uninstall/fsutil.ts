import { lstat, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Child folder names (no links/junctions), empty on any error. */
export async function childDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory() && !e.isSymbolicLink()).map((e) => e.name)
  } catch {
    return []
  }
}

export async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return true
  } catch {
    return false
  }
}

/** Total size without following links; stops counting after `limit` entries to stay fast on huge trees. */
export async function sizeOf(p: string, limit = 150000): Promise<number> {
  let bytes = 0
  let seen = 0
  const walk = async (q: string): Promise<void> => {
    if (seen++ > limit) return
    let s
    try {
      s = await lstat(q)
    } catch {
      return
    }
    if (s.isSymbolicLink()) return
    if (s.isFile()) {
      bytes += s.size
      return
    }
    if (!s.isDirectory()) return
    let names: string[] = []
    try {
      names = await readdir(q)
    } catch {
      return
    }
    for (const n of names) await walk(join(q, n))
  }
  await walk(p)
  return bytes
}

export interface FolderFacts {
  bytes: number
  /** Newest mtime of any entry (folders included), epoch ms; 0 when unreadable. */
  newest: number
  hasExecutables: boolean
}

const EXECUTABLE = /\.(exe|dll|sys|msi|com|scr|ocx|node|app|dylib|so)$/i

/** One walk for size, last use and whether programs live inside. Links are not followed. */
export async function inspectFolder(p: string, limit = 150000): Promise<FolderFacts> {
  const facts: FolderFacts = { bytes: 0, newest: 0, hasExecutables: false }
  let seen = 0
  const walk = async (q: string): Promise<void> => {
    if (seen++ > limit) return
    let s
    try {
      s = await lstat(q)
    } catch {
      return
    }
    if (s.isSymbolicLink()) return
    if (s.mtimeMs > facts.newest) facts.newest = s.mtimeMs
    if (s.isFile()) {
      facts.bytes += s.size
      if (EXECUTABLE.test(q)) facts.hasExecutables = true
      return
    }
    if (!s.isDirectory()) return
    let names: string[] = []
    try {
      names = await readdir(q)
    } catch {
      return
    }
    for (const n of names) await walk(join(q, n))
  }
  await walk(p)
  return facts
}

export async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}
