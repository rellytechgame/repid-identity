import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isInside, processSpec } from './fsops'
import { parseCleanRequest } from './index'
import { chromiumBrowsers, chromiumTargets, isSafeCleanRoot, systemTargets, type CleanerEnv } from './targets'

const winEnv: CleanerEnv = {
  platform: 'win32',
  home: 'C:\\Users\\ana',
  appData: 'C:\\Users\\ana\\AppData\\Roaming',
  localAppData: 'C:\\Users\\ana\\AppData\\Local',
  temp: 'C:\\Users\\ana\\AppData\\Local\\Temp',
  systemRoot: 'C:\\Windows',
  programData: 'C:\\ProgramData'
}
const linuxEnv: CleanerEnv = { ...winEnv, platform: 'linux', home: '/home/ana', temp: '/tmp' }

describe('clean root guard', () => {
  it('accepts specific cache folders', () => {
    expect(isSafeCleanRoot('C:\\Users\\ana\\AppData\\Local\\Temp', winEnv)).toBe(true)
    expect(isSafeCleanRoot('C:\\Windows\\Temp', winEnv)).toBe(true)
    expect(isSafeCleanRoot('/home/ana/.cache', linuxEnv)).toBe(true)
  })

  it('refuses drive roots, home and OS folders even if %TEMP% is misconfigured', () => {
    expect(isSafeCleanRoot('C:\\', winEnv)).toBe(false)
    expect(isSafeCleanRoot('C:\\Temp', winEnv)).toBe(false)
    expect(isSafeCleanRoot('C:\\Users\\ana', winEnv)).toBe(false)
    expect(isSafeCleanRoot('C:\\Users', winEnv)).toBe(false)
    expect(isSafeCleanRoot('C:\\Windows', winEnv)).toBe(false)
    expect(isSafeCleanRoot('C:\\Users\\ana\\AppData\\Local', winEnv)).toBe(false)
    expect(isSafeCleanRoot('/', linuxEnv)).toBe(false)
    expect(isSafeCleanRoot('/home/ana', linuxEnv)).toBe(false)
  })

  it('confines paths to their root', () => {
    expect(isInside('C:\\a\\b\\c.txt', 'C:\\a\\b')).toBe(true)
    expect(isInside('C:\\A\\B\\c.txt', 'c:\\a\\b')).toBe(true)
    expect(isInside('C:\\a\\b', 'C:\\a\\b')).toBe(false)
    expect(isInside('C:\\a\\b\\..\\x', 'C:\\a\\b')).toBe(false)
    expect(isInside('/home/ana/.cache/x', '/home/ana/.cache')).toBe(true)
    expect(isInside('/home/ana/.cachex', '/home/ana/.cache')).toBe(false)
  })
})

describe('target definitions', () => {
  it('never include passwords, bookmarks, autofill or preferences', () => {
    const chrome = chromiumBrowsers(winEnv)[0]
    const defs = chromiumTargets(chrome, [path.win32.join(chrome.userData, 'Default')], 'win32')
    const names = defs.flatMap((d) => d.specs.flatMap((s) => (s.mode === 'files' ? s.names : [])))
    for (const forbidden of ['Login Data', 'Bookmarks', 'Web Data', 'Preferences', 'Secure Preferences']) {
      expect(names).not.toContain(forbidden)
    }
    expect(defs.map((d) => d.risk)).toEqual(['safe', 'sensitive', 'sensitive'])
  })

  it('marks irreversible items as sensitive and off by default', () => {
    const recycle = systemTargets(winEnv).find((d) => d.kind === 'recycle-bin')!
    expect(recycle.risk).toBe('sensitive')
    expect(recycle.defaultSelected).toBe(false)
  })

  it('keeps privileged shell lines free of runtime values', () => {
    for (const d of systemTargets(linuxEnv)) for (const line of d.privileged ?? []) expect(line).not.toMatch(/\$\{|ana/)
  })
})

describe('clean request validation', () => {
  it('accepts ids only', () => {
    expect(parseCleanRequest({ ids: ['user-temp', 'browser:chrome:cache'], closeBlocking: true })).toEqual({
      ids: ['user-temp', 'browser:chrome:cache'],
      closeBlocking: true,
      acknowledgedSensitive: false
    })
  })

  it('rejects paths and malformed payloads', () => {
    expect(() => parseCleanRequest({ ids: ['C:\\Windows'] })).toThrow()
    expect(() => parseCleanRequest({ ids: ['../etc'] })).toThrow()
    expect(() => parseCleanRequest({ ids: [] })).toThrow()
    expect(() => parseCleanRequest(null)).toThrow()
  })
})

describe('file operations (real file system)', () => {
  let base: string
  beforeEach(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), 'repid-clean-'))
  })
  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('measures and deletes contents but keeps the folder and excluded entries', async () => {
    const cache = path.join(base, 'cache')
    await mkdir(path.join(cache, 'nested', 'deep'), { recursive: true })
    await mkdir(path.join(cache, 'google'))
    await writeFile(path.join(cache, 'a.tmp'), 'x'.repeat(100))
    await writeFile(path.join(cache, 'nested', 'deep', 'b.tmp'), 'x'.repeat(50))
    await writeFile(path.join(cache, 'google', 'keep.bin'), 'x')

    const spec = { mode: 'contents' as const, dir: cache, exclude: ['google'] }
    expect((await processSpec(spec, false)).bytes).toBe(150)
    const removed = await processSpec(spec, true)
    expect(removed.bytes).toBe(150)
    expect(removed.count).toBe(2)
    expect(await readdir(cache)).toEqual(['google'])
  })

  it('removes only the named files', async () => {
    await writeFile(path.join(base, 'History'), 'h')
    await writeFile(path.join(base, 'Bookmarks'), 'b')
    await processSpec({ mode: 'files', dir: base, names: ['History'] }, true)
    expect(await readdir(base)).toEqual(['Bookmarks'])
  })

  it('never follows a link out of the cleaned folder', async () => {
    const cache = path.join(base, 'cache')
    const documents = path.join(base, 'documents')
    await mkdir(cache)
    await mkdir(documents)
    await writeFile(path.join(documents, 'thesis.docx'), 'precious')
    try {
      await symlink(documents, path.join(cache, 'link-to-docs'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch {
      return // symlinks unavailable on this file system; nothing to verify
    }
    await processSpec({ mode: 'contents', dir: cache }, true)
    expect(await readdir(documents)).toEqual(['thesis.docx'])
    expect(await readdir(cache)).toEqual([])
  })
})
