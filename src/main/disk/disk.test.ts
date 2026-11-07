import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiskAnalyzer } from './index'

const MB = 1024 * 1024

describe('disk analyzer (real file system)', () => {
  let root: string
  let trashed: string[]

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'repid-disk-'))
    trashed = []
    const blob = randomBytes(2 * MB)
    const other = Buffer.concat([blob.subarray(0, MB), randomBytes(MB)]) // same size and same first bytes, different content
    await mkdir(path.join(root, 'Pictures'), { recursive: true })
    await mkdir(path.join(root, 'Downloads'), { recursive: true })
    await mkdir(path.join(root, 'proj', 'node_modules', 'pkg'), { recursive: true })
    await mkdir(path.join(root, 'app'), { recursive: true })
    await writeFile(path.join(root, 'Pictures', 'photo.raw'), blob)
    await writeFile(path.join(root, 'Downloads', 'photo (1).raw'), blob)
    await writeFile(path.join(root, 'Pictures', 'different.raw'), other)
    await writeFile(path.join(root, 'proj', 'node_modules', 'pkg', 'photo.raw'), blob)
    await writeFile(path.join(root, 'app', 'lib.dll'), blob)
    await writeFile(path.join(root, 'app', 'lib-copy.dll'), blob)
    vi.spyOn(os, 'homedir').mockReturnValue(root)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  const analyzer = () => {
    const d = new DiskAnalyzer({
      trash: async (p) => {
        trashed.push(p)
        await rm(p)
      },
      reveal: () => undefined,
      emit: () => undefined
    })
    // The temp folder lives under AppData (Windows) or /var (macOS), which are protected in real use.
    ;(d as unknown as { protectedRoots: string[] }).protectedRoots = []
    return d
  }

  it('maps the folder and finds only real duplicates outside tool folders and libraries', async () => {
    const d = analyzer()
    const scan = await d.scan('home')
    expect(scan.fileCount).toBe(6)
    expect(scan.totalBytes).toBe(12 * MB)
    expect(scan.tree.children?.find((c) => c.name === 'proj')?.system).toBeUndefined()
    const dups = await d.duplicates()
    expect(dups.groups).toHaveLength(1)
    const names = dups.groups[0].files.map((f) => path.relative(root, f.path)).sort()
    expect(names).toEqual([path.join('Downloads', 'photo (1).raw'), path.join('Pictures', 'photo.raw')])
    const keep = dups.groups[0].files.find((f) => f.id === dups.groups[0].keepId)!
    expect(path.basename(keep.path)).toBe('photo.raw')
    expect(dups.wastedBytes).toBe(2 * MB)
  })

  it('never deletes the last copy and refuses files changed since the scan', async () => {
    const d = analyzer()
    await d.scan('home')
    const { groups } = await d.duplicates()
    const [a, b] = groups[0].files

    const all = await d.delete({ ids: [a.id, b.id] })
    expect(all.removed).toBe(0)
    expect(all.refused.sort()).toEqual([a.id, b.id].sort())
    expect(trashed).toEqual([])

    const copy = groups[0].files.find((f) => f.id !== groups[0].keepId)!
    await writeFile(copy.path, randomBytes(2 * MB + 1))
    const changed = await d.delete({ ids: [copy.id] })
    expect(changed).toMatchObject({ removed: 0, refused: [copy.id] })
    expect(existsSync(copy.path)).toBe(true)
  })

  it('moves the extra copy to the trash and keeps the original', async () => {
    const d = analyzer()
    await d.scan('home')
    const { groups } = await d.duplicates()
    const copy = groups[0].files.find((f) => f.id !== groups[0].keepId)!
    const res = await d.delete({ ids: [copy.id] })
    expect(res).toMatchObject({ removed: 1, recycledBytes: 2 * MB, refused: [], failed: [] })
    expect(trashed).toEqual([copy.path])
    expect(existsSync(path.join(root, 'Pictures', 'photo.raw'))).toBe(true)
  })

  it('rejects malformed requests', async () => {
    const d = analyzer()
    await expect(d.delete({ ids: ['C:\\Windows\\notepad.exe'] })).rejects.toThrow()
    await expect(d.delete(null)).rejects.toThrow()
    await expect(d.scan('C:\\')).rejects.toThrow()
  })
})
