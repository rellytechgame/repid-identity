import { describe, expect, it } from 'vitest'
import type { DiskNode, DuplicateGroup } from '../types'
import { foldTree, isDuplicateCandidate, isToolPath, isUnder, refusedDuplicateIds, squarify, suggestKeep } from './disk'

describe('disk map', () => {
  it('squarified tiles fill the rectangle without overlap', () => {
    const items = [600, 300, 60, 25, 10, 5].map((v, i) => ({ v, i }))
    const tiles = squarify(items, (x) => x.v, { x: 0, y: 0, w: 100, h: 50 })
    expect(tiles).toHaveLength(6)
    const area = tiles.reduce((s, t) => s + t.w * t.h, 0)
    expect(area).toBeCloseTo(5000, 3)
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(-1e-9)
      expect(t.x + t.w).toBeLessThanOrEqual(100 + 1e-9)
      expect(t.y + t.h).toBeLessThanOrEqual(50 + 1e-9)
      expect(t.w * t.h).toBeCloseTo((t.item.v / 1000) * 5000, 3)
    }
    expect(squarify([], () => 1, { x: 0, y: 0, w: 10, h: 10 })).toEqual([])
  })

  it('folds small children into one "other" block', () => {
    const children: DiskNode[] = Array.from({ length: 60 }, (_, i) => ({ name: `d${i}`, sizeBytes: 1000 - i, fileCount: 1 }))
    children.push({ name: 'tiny', sizeBytes: 1, fileCount: 5 })
    const total = children.reduce((s, c) => s + c.sizeBytes, 0)
    const folded = foldTree({ name: 'root', sizeBytes: total, fileCount: 65, children })
    expect(folded.children).toHaveLength(41)
    expect(folded.children!.at(-1)!.other).toBe(true)
    expect(folded.children!.reduce((s, c) => s + c.sizeBytes, 0)).toBe(total)
  })
})

describe('duplicates', () => {
  it('keeps the original, never the "(1)" copy or the one in Downloads', () => {
    const files = [
      { id: 'a', path: 'C:\\Users\\u\\Downloads\\photo.jpg', modified: 1 },
      { id: 'b', path: 'C:\\Users\\u\\Pictures\\photo (1).jpg', modified: 2 },
      { id: 'c', path: 'C:\\Users\\u\\Pictures\\photo.jpg', modified: 3 }
    ]
    expect(suggestKeep(files)).toBe('c')
    expect(suggestKeep([files[0], files[1]])).toBe('b')
  })

  it('refuses any request that would delete every copy', () => {
    const f = (id: string) => ({ id, path: id, sizeBytes: 1, modified: 0, removable: true })
    const groups: DuplicateGroup[] = [
      { id: 'g1', sizeBytes: 1, hash: 'x', files: [f('a'), f('b')], keepId: 'a' },
      { id: 'g2', sizeBytes: 1, hash: 'y', files: [f('c'), f('d'), f('e')], keepId: 'c' }
    ]
    expect(refusedDuplicateIds(groups, new Set(['b', 'd', 'e']))).toEqual([])
    expect(refusedDuplicateIds(groups, new Set(['a', 'b', 'd'])).sort()).toEqual(['a', 'b'])
  })

  it('never offers tool folders or libraries (found on a real machine)', () => {
    for (const p of [
      'C:\\Users\\u\\.gradle\\caches\\x.jar',
      'C:\\Users\\u\\.android\\avd\\a.avd\\sdcard.img',
      'C:\\Users\\u\\.nuget\\packages\\a\\1.0\\a.nupkg',
      'C:\\Users\\u\\go\\pkg\\mod\\x\\static.go',
      'E:\\proj\\node_modules\\big\\index.js',
      'E:\\proj\\.git\\objects\\pack\\p.pack'
    ]) {
      expect(isToolPath(p)).toBe(true)
    }
    expect(isDuplicateCandidate('E:\\Videos\\clip.mp4')).toBe(true)
    expect(isDuplicateCandidate('E:\\Apps\\tool\\lib.dll')).toBe(false)
    expect(isDuplicateCandidate('C:\\Users\\u\\Desktop\\app.exe')).toBe(false)
    expect(isDuplicateCandidate('C:\\Users\\u\\Downloads\\setup (1).exe')).toBe(true)
    expect(isToolPath('E:\\FILES\\Mis Documentos\\React.js Projects\\a.mp4')).toBe(false)
  })

  it('matches folders by whole path segments only', () => {
    expect(isUnder('C:\\Windows\\System32\\x.dll', ['C:\\Windows'], true)).toBe(true)
    expect(isUnder('C:\\WindowsApps2\\x', ['C:\\Windows'], true)).toBe(false)
    expect(isUnder('/home/u/.cache/x', ['/home/u/.cache'], false)).toBe(true)
  })
})
