import type { DiskFile, DiskNode, DuplicateGroup } from '../types'

/** Children kept per folder in the map; the rest is folded into one "other" block. */
export const MAX_CHILDREN = 40
/** A child smaller than this share of its parent is folded too (keeps the tree small). */
export const MIN_SHARE = 0.002
export const LARGE_FILE_BYTES = 100 * 1024 * 1024
export const DUPLICATE_MIN_BYTES = 1024 * 1024

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Tile<T> extends Rect {
  item: T
}

/**
 * Squarified treemap (Bruls, Huizing, van Wijk 2000): lays items out in rows
 * along the shorter side so every tile stays close to a square and is easy to
 * click. Items must be sorted by size, biggest first; zero sizes are skipped.
 */
export function squarify<T>(items: T[], size: (item: T) => number, rect: Rect): Tile<T>[] {
  const list = items.filter((i) => size(i) > 0)
  const total = list.reduce((s, i) => s + size(i), 0)
  if (!list.length || total <= 0 || rect.w <= 0 || rect.h <= 0) return []
  const scale = (rect.w * rect.h) / total
  const out: Tile<T>[] = []
  let free = { ...rect }
  let row: T[] = []

  const worst = (r: T[], side: number): number => {
    const areas = r.map((i) => size(i) * scale)
    const sum = areas.reduce((a, b) => a + b, 0)
    const max = Math.max(...areas)
    const min = Math.min(...areas)
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min))
  }

  const layoutRow = (r: T[]) => {
    const sum = r.reduce((s, i) => s + size(i) * scale, 0)
    if (free.w >= free.h) {
      const w = free.h > 0 ? sum / free.h : 0
      let y = free.y
      for (const i of r) {
        const h = w > 0 ? (size(i) * scale) / w : 0
        out.push({ item: i, x: free.x, y, w, h })
        y += h
      }
      free = { x: free.x + w, y: free.y, w: free.w - w, h: free.h }
    } else {
      const h = free.w > 0 ? sum / free.w : 0
      let x = free.x
      for (const i of r) {
        const w = h > 0 ? (size(i) * scale) / h : 0
        out.push({ item: i, x, y: free.y, w, h })
        x += w
      }
      free = { x: free.x, y: free.y + h, w: free.w, h: free.h - h }
    }
  }

  for (const item of list) {
    const side = Math.min(free.w, free.h)
    if (!row.length || worst([...row, item], side) <= worst(row, side)) {
      row.push(item)
    } else {
      layoutRow(row)
      row = [item]
    }
  }
  if (row.length) layoutRow(row)
  return out
}

/**
 * Keeps the biggest children of a folder and folds the rest into a single
 * "other" node, recursively. Bounds the tree sent to the UI to a few
 * thousand nodes whatever the disk size.
 */
export function foldTree(node: DiskNode, rootBytes: number = node.sizeBytes): DiskNode {
  if (!node.children?.length) return node
  const sorted = [...node.children].sort((a, b) => b.sizeBytes - a.sizeBytes)
  const keep: DiskNode[] = []
  let otherBytes = 0
  let otherFiles = 0
  for (const child of sorted) {
    if (keep.length < MAX_CHILDREN && child.sizeBytes >= rootBytes * MIN_SHARE && child.sizeBytes > 0) keep.push(foldTree(child, rootBytes))
    else {
      otherBytes += child.sizeBytes
      otherFiles += child.fileCount
    }
  }
  if (otherBytes > 0) keep.push({ name: '', sizeBytes: otherBytes, fileCount: otherFiles, other: true })
  return { ...node, children: keep.length ? keep : undefined }
}

const LOW_VALUE_DIR = /[\\/](downloads|descargas|temp|tmp|\.trash|recycle)[\\/]/i
const COPY_NAME = /(\(\d+\)|[-_ ]copy\b|[-_ ]copia\b|[-_ ]copie\b| - copy| - copia)(\.[^.\\/]*)?$/i

/**
 * Which copy of a duplicate set to keep: never a "file (1).ext" / "- copia"
 * name or one in Downloads/temp when another exists; then the oldest (the
 * original); then the shortest path.
 */
export function suggestKeep(files: Array<Pick<DiskFile, 'id' | 'path' | 'modified'>>): string {
  const score = (f: Pick<DiskFile, 'path'>) => (LOW_VALUE_DIR.test(f.path) ? 2 : 0) + (COPY_NAME.test(f.path) ? 1 : 0)
  return [...files].sort((a, b) => score(a) - score(b) || a.modified - b.modified || a.path.length - b.path.length || a.path.localeCompare(b.path))[0].id
}

/**
 * Deletion guard for duplicates: a request may never remove every copy of a
 * set. Returns the ids that must be refused (all requested ids of any set
 * that would end up empty).
 */
export function refusedDuplicateIds(groups: DuplicateGroup[], ids: ReadonlySet<string>): string[] {
  const refused: string[] = []
  for (const g of groups) {
    const chosen = g.files.filter((f) => ids.has(f.id))
    if (chosen.length && chosen.length >= g.files.length) refused.push(...chosen.map((f) => f.id))
  }
  return refused
}

/** Case-insensitive on Windows/macOS; `roots` are absolute paths of folders that are never offered. */
export function isUnder(path: string, roots: string[], caseInsensitive: boolean): boolean {
  const norm = (p: string) => {
    const s = p.replace(/[\\/]+$/, '')
    return caseInsensitive ? s.toLowerCase() : s
  }
  const target = norm(path)
  return roots.some((r) => {
    const root = norm(r)
    if (!root) return false
    return target === root || target.startsWith(root + '\\') || target.startsWith(root + '/')
  })
}

const TOOL_DIRS = new Set(['node_modules', '__pycache__', 'site-packages', 'dist-packages', 'venv', 'env', 'vendor', 'bower_components', 'pods', 'deriveddata', 'target', 'obj', 'bin', 'go', 'anaconda3', 'miniconda3', 'scoop', 'flutter', '$recycle.bin', 'system volume information'])
const LIBRARY_EXT = /\.(dll|sys|so|dylib|jar|node|pyd|pyc|class|ocx|drv|mui|efi)$/i
const DOWNLOADS = /[\\/](downloads|descargas)[\\/]/i

/**
 * Folders that belong to tools, not to the user's documents: hidden/dot
 * folders (.gradle, .android, .git, .vscode…), dependency trees
 * (node_modules, venv, vendor) and build outputs. Their "duplicates" are
 * deliberate copies; deleting one breaks a project or a toolchain.
 */
export function isToolPath(path: string): boolean {
  const parts = path.split(/[\\/]+/).slice(1)
  return parts.some((p) => (p.startsWith('.') && p.length > 1) || TOOL_DIRS.has(p.toLowerCase()))
}

/**
 * Libraries are never offered as duplicates (every app ships its own copy).
 * Programs are offered only in Downloads, where repeated installers pile up.
 */
export function isDuplicateCandidate(path: string): boolean {
  if (LIBRARY_EXT.test(path)) return false
  if (/\.exe$/i.test(path) && !DOWNLOADS.test(path)) return false
  return !isToolPath(path)
}
