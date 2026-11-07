import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, open, opendir } from 'node:fs/promises'
import os from 'node:os'
import { basename, join } from 'node:path'
import si from 'systeminformation'
import type {
  DiskDeleteResult,
  DiskFile,
  DiskNode,
  DiskRoot,
  DiskScanResult,
  DuplicateGroup,
  DuplicateScanResult,
  TaskProgress
} from '../../shared/types'
import { DUPLICATE_MIN_BYTES, LARGE_FILE_BYTES, foldTree, isDuplicateCandidate, isToolPath, isUnder, refusedDuplicateIds, suggestKeep } from '../../shared/engine/disk'

const MAX_FILES = 4_000_000
const MAX_LARGE = 300
const MAX_IDS = 5000
const CONCURRENCY = 24
/** Hashing stops here (the scan says so) to keep the duplicate search within minutes. */
const MAX_HASH_BYTES = 40 * 1024 ** 3
const PARTIAL_BYTES = 64 * 1024
const IS_WIN = process.platform === 'win32'
const CASE_INSENSITIVE = IS_WIN || process.platform === 'darwin'

export interface DiskDeps {
  trash: (path: string) => Promise<void>
  reveal: (path: string) => void
  emit: (progress: TaskProgress) => void
}

interface MutableNode {
  name: string
  sizeBytes: number
  fileCount: number
  children: MutableNode[]
  system: boolean
}

interface Candidate {
  path: string
  size: number
  modified: number
}

/**
 * Folders shown in the map but never offered for deletion: the OS, installed
 * programs and app data (the cleaner and the uninstaller handle those with
 * their own safety rules).
 */
export function systemRoots(): string[] {
  const home = os.homedir()
  const env = (n: string) => process.env[n] ?? ''
  if (IS_WIN) {
    const drive = (env('SystemDrive') || 'C:') + '\\'
    return [
      env('SystemRoot') || 'C:\\Windows',
      env('ProgramFiles'),
      env('ProgramFiles(x86)'),
      env('ProgramData'),
      env('APPDATA'),
      env('LOCALAPPDATA'),
      join(home, 'AppData'),
      join(drive, '$Recycle.Bin'),
      join(drive, 'System Volume Information'),
      join(drive, 'Recovery'),
      join(drive, '$WinREAgent'),
      join(drive, 'Windows.old'),
      join(drive, 'pagefile.sys'),
      join(drive, 'hiberfil.sys'),
      join(drive, 'swapfile.sys'),
      join(drive, 'DumpStack.log.tmp')
    ].filter(Boolean)
  }
  const common = ['/System', '/Library', '/Applications', '/usr', '/bin', '/sbin', '/etc', '/var', '/private', '/opt', '/boot', '/lib', '/lib64', '/snap', '/dev', '/proc', '/sys', '/run']
  return [...common, join(home, 'Library'), join(home, 'Applications'), join(home, '.local'), join(home, '.config'), join(home, '.cache')]
}

/** Program and system folders at the top of ANY drive (D:\Program Files, E:\Windows.old…). */
const WIN_DRIVE_SYSTEM = /^[a-z]:\\(program files( \(x86\))?|programdata|windows(\.old)?|\$recycle\.bin|system volume information|recovery|\$windows\.~bt|\$windows\.~ws|msocache|intel|amd|nvidia)(\\|$)/i

/** Never descended into: virtual or recursive file systems. */
const SKIP_DIRS = new Set(['/proc', '/sys', '/dev', '/run', '/System/Volumes'])

let seq = 0
const nextId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`

export class DiskAnalyzer {
  private rootsById = new Map<string, DiskRoot>()
  private files = new Map<string, DiskFile>()
  private candidates: Candidate[] = []
  private groups: DuplicateGroup[] = []
  private lastRoot: string | null = null
  private cancelled = false
  private busy = false
  private readonly protectedRoots = systemRoots()

  constructor(private readonly deps: DiskDeps) {}

  async roots(): Promise<DiskRoot[]> {
    const home = os.homedir()
    const list: DiskRoot[] = [{ id: 'home', path: home, label: basename(home) || home, kind: 'home' }]
    const sizes = await si.fsSize().catch(() => [])
    for (const fs of sizes) {
      const mount = fs.mount
      if (!mount || fs.size <= 0) continue
      if (IS_WIN ? !/^[A-Z]:\\?$/i.test(mount) : !(mount === '/' || mount.startsWith('/Volumes/') || mount.startsWith('/media/') || mount.startsWith('/mnt/'))) continue
      if (!IS_WIN && /tmpfs|devtmpfs|overlay|squashfs/i.test(fs.type)) continue
      const path = IS_WIN ? mount.slice(0, 2) + '\\' : mount
      if (list.some((r) => r.path === path)) continue
      list.push({ id: `drive:${list.length}`, path, label: path, kind: 'drive', totalBytes: fs.size, freeBytes: fs.available })
    }
    this.rootsById = new Map(list.map((r) => [r.id, r]))
    return list
  }

  cancel(): void {
    this.cancelled = true
  }

  private removable(path: string): boolean {
    if (IS_WIN && WIN_DRIVE_SYSTEM.test(path)) return false
    return !isUnder(path, this.protectedRoots, CASE_INSENSITIVE) && !isToolPath(path)
  }

  async scan(rootId: unknown): Promise<DiskScanResult> {
    if (typeof rootId !== 'string') throw new Error('Invalid root')
    if (!this.rootsById.size) await this.roots()
    const root = this.rootsById.get(rootId)
    if (!root) throw new Error('Unknown root')
    if (this.busy) throw new Error('A scan is already running')
    this.busy = true
    this.cancelled = false
    const started = Date.now()
    try {
      const tree: MutableNode = { name: root.path, sizeBytes: 0, fileCount: 0, children: [], system: !this.removable(root.path) }
      const large: Candidate[] = []
      const candidates: Candidate[] = []
      let fileCount = 0
      let truncated = false
      let lastEmit = 0

      // Bounded pool of directory reads; every finished folder tops the pool back up. Symlinks and junctions are never followed.
      const queue: Array<{ path: string; node: MutableNode; chain: MutableNode[] }> = [{ path: root.path, node: tree, chain: [] }]
      const readDir = async ({ path, node, chain }: (typeof queue)[number]) => {
        let dir
        try {
          dir = await opendir(path, { bufferSize: 256 })
        } catch {
          return
        }
        try {
          for await (const entry of dir) {
            const full = join(path, entry.name)
            if (entry.isSymbolicLink()) continue
            if (entry.isDirectory()) {
              if (SKIP_DIRS.has(full)) continue
              const child: MutableNode = { name: entry.name, sizeBytes: 0, fileCount: 0, children: [], system: node.system || !this.removable(full) }
              node.children.push(child)
              queue.push({ path: full, node: child, chain: [...chain, node] })
            } else if (entry.isFile()) {
              let st
              try {
                st = await lstat(full)
              } catch {
                continue
              }
              const size = st.size
              fileCount++
              node.sizeBytes += size
              node.fileCount++
              for (const n of chain) {
                n.sizeBytes += size
                n.fileCount++
              }
              if (size >= LARGE_FILE_BYTES) large.push({ path: full, size, modified: st.mtimeMs })
              if (size >= DUPLICATE_MIN_BYTES && !node.system && isDuplicateCandidate(full)) candidates.push({ path: full, size, modified: st.mtimeMs })
            }
          }
        } catch {
          // folder vanished or became unreadable mid-listing: keep what was counted
        }
        if (Date.now() - lastEmit > 400) {
          lastEmit = Date.now()
          this.deps.emit({ task: 'disk-scan', done: fileCount, current: path })
        }
      }
      await new Promise<void>((resolve) => {
        let active = 0
        const pump = () => {
          if ((this.cancelled || fileCount >= MAX_FILES) && queue.length) {
            truncated = true
            queue.length = 0
          }
          while (active < CONCURRENCY && queue.length) {
            active++
            void readDir(queue.pop()!).finally(() => {
              active--
              pump()
            })
          }
          if (active === 0 && !queue.length) resolve()
        }
        pump()
      })
      if (this.cancelled) truncated = true

      this.files.clear()
      this.groups = []
      this.candidates = candidates
      this.lastRoot = root.path
      const largeFiles = large
        .sort((a, b) => b.size - a.size)
        .slice(0, MAX_LARGE)
        .map((c) => this.register(c))
      this.deps.emit({ task: 'disk-scan', done: fileCount })
      return {
        rootId: root.id,
        root: root.path,
        scannedAt: Date.now(),
        durationMs: Date.now() - started,
        totalBytes: tree.sizeBytes,
        fileCount,
        tree: foldTree(toNode(tree)),
        largeFiles,
        truncated
      }
    } finally {
      this.busy = false
    }
  }

  private register(c: Candidate): DiskFile {
    const file: DiskFile = { id: nextId('f'), path: c.path, sizeBytes: c.size, modified: c.modified, removable: this.removable(c.path) }
    this.files.set(file.id, file)
    return file
  }

  /** Same size → same first/last 64 KB → same full SHA-256. Only removable files are compared. */
  async duplicates(): Promise<DuplicateScanResult> {
    if (!this.lastRoot) throw new Error('Scan a folder first')
    if (this.busy) throw new Error('A scan is already running')
    this.busy = true
    this.cancelled = false
    try {
      const bySize = new Map<number, Candidate[]>()
      for (const c of this.candidates) bySize.set(c.size, [...(bySize.get(c.size) ?? []), c])
      let sets: Hashed[][] = [...bySize.values()].filter((l) => l.length > 1)
      const total = sets.reduce((s, l) => s + l.length, 0)
      let done = 0
      let hashedBytes = 0
      let truncated = false

      type Hashed = Candidate & { hash?: string }
      const refine = async (list: Hashed[][], hash: (c: Candidate) => Promise<string | null>, countBytes: (c: Candidate) => number) => {
        const next: Hashed[][] = []
        for (const set of list) {
          if (this.cancelled || hashedBytes > MAX_HASH_BYTES) {
            truncated = true
            break
          }
          const byHash = new Map<string, Hashed[]>()
          for (const c of set) {
            const h = await hash(c)
            hashedBytes += countBytes(c)
            if (h) byHash.set(h, [...(byHash.get(h) ?? []), c])
          }
          for (const [h, l] of byHash) if (l.length > 1) next.push(l.map((c) => ({ ...c, hash: h })))
          done += set.length
          this.deps.emit({ task: 'duplicates', done, total: total * 2 })
        }
        return next
      }

      sets = await refine(sets, partialHash, (c) => Math.min(c.size, PARTIAL_BYTES * 2))
      done = total
      // Largest sets first, so a hashing limit still finds the biggest savings.
      sets.sort((a, b) => b[0].size * (b.length - 1) - a[0].size * (a.length - 1))
      const full = await refine(sets, fullHash, (c) => c.size)

      this.groups = full.map((set) => {
        const files = set.map((c) => this.register(c))
        return { id: nextId('g'), sizeBytes: set[0].size, hash: (set[0].hash ?? '').slice(0, 16), files, keepId: suggestKeep(files) }
      })
      this.groups.sort((a, b) => b.sizeBytes * (b.files.length - 1) - a.sizeBytes * (a.files.length - 1))
      this.deps.emit({ task: 'duplicates', done: total * 2, total: total * 2 })
      return {
        groups: this.groups,
        wastedBytes: this.groups.reduce((s, g) => s + g.sizeBytes * (g.files.length - 1), 0),
        hashedBytes,
        truncated
      }
    } finally {
      this.busy = false
    }
  }

  /**
   * Moves files to the Recycle Bin/Trash. Ids only; each file must still be
   * removable, unchanged since the scan (size and date), and no duplicate set
   * may lose its last copy.
   */
  async delete(raw: unknown): Promise<DiskDeleteResult> {
    const ids = (raw as { ids?: unknown } | null)?.ids
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_IDS || !ids.every((i) => typeof i === 'string' && /^[fg][a-z0-9]{1,24}$/.test(i))) {
      throw new Error('Invalid delete request')
    }
    const wanted = new Set(ids as string[])
    const refused = new Set(refusedDuplicateIds(this.groups, wanted))
    const result: DiskDeleteResult = { removed: 0, recycledBytes: 0, failed: [], refused: [] }

    for (const id of wanted) {
      const file = this.files.get(id)
      if (!file || refused.has(id) || !file.removable || !this.removable(file.path)) {
        result.refused.push(id)
        continue
      }
      const group = this.groups.find((g) => g.files.some((f) => f.id === id))
      if (group && !(await this.keepsACopy(group, wanted))) {
        result.refused.push(id)
        continue
      }
      try {
        const st = await lstat(file.path)
        if (!st.isFile() || st.size !== file.sizeBytes || Math.abs(st.mtimeMs - file.modified) > 2000) {
          result.refused.push(id)
          continue
        }
        await this.deps.trash(file.path)
        this.files.delete(id)
        result.removed++
        result.recycledBytes += file.sizeBytes
      } catch (err) {
        result.failed.push({ id, error: err instanceof Error ? err.message : String(err) })
      }
    }
    for (const g of this.groups) g.files = g.files.filter((f) => this.files.has(f.id))
    this.groups = this.groups.filter((g) => g.files.length > 1)
    return result
  }

  /** At least one copy outside the request must still exist on disk unchanged. */
  private async keepsACopy(group: DuplicateGroup, wanted: Set<string>): Promise<boolean> {
    for (const f of group.files) {
      if (wanted.has(f.id)) continue
      try {
        const st = await lstat(f.path)
        if (st.isFile() && st.size === f.sizeBytes) return true
      } catch {
        // missing copy: try the next one
      }
    }
    return false
  }

  reveal(id: unknown): void {
    const file = typeof id === 'string' ? this.files.get(id) : undefined
    if (!file) throw new Error('Unknown file')
    this.deps.reveal(file.path)
  }
}

function toNode(n: MutableNode): DiskNode {
  return {
    name: n.name,
    sizeBytes: n.sizeBytes,
    fileCount: n.fileCount,
    system: n.system || undefined,
    children: n.children.length ? n.children.map(toNode) : undefined
  }
}

async function partialHash(c: Candidate): Promise<string | null> {
  try {
    const fh = await open(c.path, 'r')
    try {
      const h = createHash('sha256')
      const head = Buffer.alloc(Math.min(PARTIAL_BYTES, c.size))
      await fh.read(head, 0, head.length, 0)
      h.update(head)
      if (c.size > PARTIAL_BYTES) {
        const tail = Buffer.alloc(Math.min(PARTIAL_BYTES, c.size - PARTIAL_BYTES))
        await fh.read(tail, 0, tail.length, c.size - tail.length)
        h.update(tail)
      }
      return h.digest('hex')
    } finally {
      await fh.close()
    }
  } catch {
    return null
  }
}

function fullHash(c: Candidate): Promise<string | null> {
  return new Promise((resolve) => {
    const h = createHash('sha256')
    const stream = createReadStream(c.path, { highWaterMark: 1024 * 1024 })
    stream.on('data', (chunk) => h.update(chunk))
    stream.on('error', () => resolve(null))
    stream.on('end', () => resolve(h.digest('hex')))
  })
}
