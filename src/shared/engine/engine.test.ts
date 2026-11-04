import { describe, expect, it } from 'vitest'
import type { ProcessInfo } from '../types'
import { classify, extractScript, productFromPath } from './classifier'
import { buildGroups, descendantsOf, impactScore } from './grouping'
import { normalizeName, riskOf, type ProtectionContext } from './protection'
import { suggestTargets } from './smart'

const GB = 1024 ** 3

function proc(pid: number, ppid: number, name: string, extra: Partial<ProcessInfo> = {}): ProcessInfo {
  return { pid, ppid, name, path: '', command: name, user: 'me', cpu: 0, memBytes: 0, started: '', ...extra }
}

const win: ProtectionContext = { platform: 'win32', selfPids: new Set([999]), userProtected: new Set() }

describe('protection', () => {
  it('normalizes executable names', () => {
    expect(normalizeName('  Chrome.EXE ')).toBe('chrome')
  })

  it('never allows kernel, session-critical or self processes', () => {
    expect(riskOf(4, 'System', win)).toBe('critical')
    expect(riskOf(1, 'anything', win)).toBe('critical')
    expect(riskOf(600, 'lsass.exe', win)).toBe('critical')
    expect(riskOf(999, 'RePID Identity.exe', win)).toBe('critical')
    expect(riskOf(700, 'kworker/0:1', { ...win, platform: 'linux' })).toBe('critical')
  })

  it('flags desktop components as caution and honours user protection', () => {
    expect(riskOf(800, 'explorer.exe', win)).toBe('caution')
    expect(riskOf(900, 'chrome.exe', win)).toBe('safe')
    expect(riskOf(900, 'obs64.exe', { ...win, userProtected: new Set(['obs64']) })).toBe('critical')
  })
})

describe('classifier', () => {
  it('extracts the script an interpreter runs', () => {
    expect(extractScript('node C:\\dev\\app\\node_modules\\vite\\bin\\vite.js --port 5173')).toBe('vite')
    expect(extractScript('python -u train_model.py --epochs 4')).toBe('train_model.py')
    expect(extractScript('python -m http.server')).toBe('http.server')
    expect(extractScript('java -Xmx2g -jar /opt/minecraft/server.jar')).toBe('server.jar')
  })

  it('infers products from install paths', () => {
    expect(productFromPath('C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe')).toBe('Docker')
    expect(productFromPath('/Applications/Slack.app/Contents/MacOS/Slack')).toBe('Slack')
    expect(productFromPath('C:\\Program Files\\Microsoft\\x.exe')).toBeUndefined()
    expect(productFromPath('C:\\Program Files\\NVIDIA Corporation\\NVIDIA Broadcast\\NVIDIA Broadcast.exe')).toBe('NVIDIA Broadcast')
    expect(productFromPath('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')).toBe('Chrome')
    expect(productFromPath('C:\\Users\\me\\AppData\\Local\\Discord\\app-1.0.9\\Discord.exe')).toBe('Discord')
    expect(productFromPath('C:\\Users\\me\\AppData\\Local\\Programs\\Opera GX\\opera.exe')).toBe('Opera GX')
    expect(productFromPath('C:\\Program Files\\WindowsApps\\AD2F1837.OMENCommandCenter_1101.2609.11.0_x64__v10z\\App\\x.exe')).toBe('OMENCommandCenter')
  })

  it('identifies catalog apps, runtimes and unknown helpers', () => {
    expect(classify({ name: 'Google Chrome Helper (Renderer)', path: '', command: '--type=renderer' })).toMatchObject({
      catalogId: 'chrome',
      category: 'browser',
      heuristic: { key: 'chromiumRole' }
    })
    expect(classify({ name: 'node.exe', path: '', command: 'node server.js' }).heuristic).toEqual({
      key: 'runtimeScript',
      params: { runtime: 'Node.js', script: 'server.js' }
    })
    expect(classify({ name: 'FooUpdater.exe', path: 'C:\\Program Files\\Foo\\FooUpdater.exe', command: '' })).toMatchObject({
      category: 'updater',
      product: 'Foo'
    })
    expect(classify({ name: 'mystery', path: '', command: '' }).heuristic?.key).toBe('unknown')
  })
})

describe('grouping', () => {
  const procs = [
    proc(10, 1, 'explorer.exe', { memBytes: 0.2 * GB }),
    proc(20, 10, 'chrome.exe', { cpu: 5, memBytes: 0.5 * GB }),
    proc(21, 20, 'chrome.exe', { cpu: 10, memBytes: 0.5 * GB }),
    proc(22, 20, 'chrome.exe', { cpu: 10, memBytes: 1 * GB }),
    proc(23, 22, 'crashpad_handler.exe', { memBytes: 0.01 * GB }),
    proc(30, 10, 'notepad.exe')
  ]

  it('collects descendants top-down without the roots', () => {
    expect(descendantsOf([20], procs).map((p) => p.pid)).toEqual([21, 22, 23])
  })

  it('survives ppid cycles from stale data', () => {
    const cyclic = [proc(5, 6, 'a'), proc(6, 5, 'b')]
    expect(descendantsOf([5], cyclic).map((p) => p.pid)).toEqual([6])
    expect(buildGroups(cyclic, { ...win, totalMem: GB, services: new Map() })).toHaveLength(2)
  })

  it('clusters same-named processes into one app and lists foreign children', () => {
    const groups = buildGroups(procs, { ...win, totalMem: 16 * GB, services: new Map() })
    const chrome = groups.find((g) => g.name === 'chrome')!
    expect(chrome.pids.sort()).toEqual([20, 21, 22])
    expect(chrome.descendantPids).toEqual([23])
    expect(chrome.cpu).toBe(25)
    expect(chrome.memBytes).toBe(2 * GB)
    expect(groups[0].name).toBe('chrome')
    expect(groups.find((g) => g.name === 'explorer')!.risk).toBe('caution')
  })

  it('keeps different scripts of the same interpreter apart', () => {
    const groups = buildGroups(
      [proc(60, 1, 'node.exe', { command: 'node npm-cli.js run dev' }), proc(61, 60, 'node.exe', { command: 'node node_modules/.bin/../vite/bin/vite.js' })],
      { ...win, totalMem: GB, services: new Map() }
    )
    expect(groups).toHaveLength(2)
    expect(groups.find((g) => g.rootPid === 61)!.identity.heuristic?.params?.script).toBe('vite')
  })

  it('scores impact on a 0–100 scale', () => {
    expect(impactScore(0, 0, GB, 0)).toBe(0)
    expect(impactScore(100, GB, GB, 100)).toBe(100)
  })

  it('smart free only suggests safe, non-system apps above threshold', () => {
    const groups = buildGroups(
      [...procs, proc(40, 1, 'svchost.exe', { cpu: 90 }), proc(50, 10, 'Discord.exe', { cpu: 1 })],
      { ...win, totalMem: 16 * GB, services: new Map() }
    )
    const picks = suggestTargets(groups, { threshold: 30 }).map((g) => g.name)
    expect(picks).toEqual(['chrome'])
  })
})
