import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appCacheSpecs } from './index'
import { systemTargets, type CleanerEnv } from './targets'

describe('app caches (real file system)', () => {
  let root: string
  let env: CleanerEnv

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'repid-appcache-'))
    const appData = path.join(root, 'Roaming')
    env = { platform: 'win32', home: root, appData, localAppData: path.join(root, 'Local'), temp: path.join(root, 'Temp'), systemRoot: 'C:\\Windows', programData: 'C:\\ProgramData' }
    // Electron app: markers next to its caches.
    await mkdir(path.join(appData, 'discord', 'Cache', 'Cache_Data'), { recursive: true })
    await mkdir(path.join(appData, 'discord', 'GPUCache'), { recursive: true })
    await mkdir(path.join(appData, 'discord', 'Local Storage'), { recursive: true })
    await writeFile(path.join(appData, 'discord', 'Local State'), '{}')
    // Not Chromium: a "Cache" folder that may hold real data (offline maps, saves) must be ignored.
    await mkdir(path.join(appData, 'MapsApp', 'Cache'), { recursive: true })
    // Browsers have their own targets (cache vs. history): never scanned here.
    await mkdir(path.join(appData, 'Opera Software', 'Opera GX Stable', 'Cache'), { recursive: true })
    await writeFile(path.join(appData, 'Opera Software', 'Opera GX Stable', 'Local State'), '{}')
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  it('finds Chromium/Electron caches only where Chromium markers exist', async () => {
    const dirs = (await appCacheSpecs(env)).map((s) => path.relative(env.appData, s.dir))
    expect(dirs.sort()).toEqual([path.join('discord', 'Cache'), path.join('discord', 'GPUCache')])
  })

  it('defines crash dumps and Windows.old (measure-only, removed by Windows itself)', () => {
    const defs = systemTargets(env)
    expect(defs.find((d) => d.id === 'crash-dumps')).toMatchObject({ requiresAdmin: true, risk: 'safe' })
    expect(defs.find((d) => d.id === 'windows-old')).toMatchObject({ requiresAdmin: true, risk: 'caution', measureOnly: true, defaultSelected: false, actions: ['windows-setup-cleanup'] })
  })
})
