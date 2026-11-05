import { describe, expect, it } from 'vitest'
import type { AppGroup, ProcessInfo } from '../types'
import { boostKey, isEcoEligible, planBoost } from './boost'
import { buildGroups } from './grouping'
import { assessStartup, matchRunning, measureImpact, parseCommand } from './startup'

const MB = 1024 ** 2
const ctx = { platform: 'win32' as const, selfPids: new Set<number>(), userProtected: new Set<string>(), totalMem: 16 * 1024 * MB, services: new Map() }

function proc(pid: number, ppid: number, name: string, extra: Partial<ProcessInfo> = {}): ProcessInfo {
  return { pid, ppid, name, path: '', command: name, user: 'me', cpu: 0, memBytes: 0, started: '', ...extra }
}

describe('startup: parseCommand', () => {
  it('handles quoted, unquoted-with-spaces and bare commands', () => {
    expect(parseCommand('"C:\\Program Files\\App\\app.exe" --min')).toEqual({ exe: 'C:\\Program Files\\App\\app.exe', args: '--min', launches: undefined })
    expect(parseCommand('C:\\Program Files (x86)\\Foxit Software\\Foxit PDF Reader\\reader_sl.exe DefaultReader').exe).toBe(
      'C:\\Program Files (x86)\\Foxit Software\\Foxit PDF Reader\\reader_sl.exe'
    )
    expect(parseCommand('discord --start-minimized')).toMatchObject({ exe: 'discord', args: '--start-minimized' })
    expect(parseCommand('env GDK_BACKEND=x11 /usr/bin/slack -u').exe).toBe('/usr/bin/slack')
  })

  it('sees through Squirrel launchers', () => {
    expect(parseCommand('C:\\Users\\u\\AppData\\Local\\Discord\\Update.exe --processStart Discord.exe').launches).toBe('Discord.exe')
  })
})

describe('startup: assessStartup', () => {
  const win = (label: string, command: string, extra: Partial<Parameters<typeof assessStartup>[0]> = {}) => {
    const p = parseCommand(command)
    return assessStartup({ platform: 'win32', label, command, exe: p.exe, launches: p.launches, ...extra })
  }

  it('locks Windows components but not driver utilities in DriverStore', () => {
    expect(win('SecurityHealth', 'C:\\WINDOWS\\system32\\SecurityHealthSystray.exe')).toMatchObject({ risk: 'critical', recommended: false })
    expect(win('RtkAudUService', '"C:\\WINDOWS\\System32\\DriverStore\\FileRepository\\realtek\\RtkAudUService64.exe" -background')).toMatchObject({
      risk: 'caution',
      effect: 'hardware'
    })
  })

  it('warns before cloud sync and security tools', () => {
    expect(win('OneDrive', '"C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe" /background')).toMatchObject({ risk: 'caution', effect: 'cloud' })
    expect(win('Bitwarden', '"C:\\Program Files\\Bitwarden\\Bitwarden.exe"')).toMatchObject({ risk: 'caution', effect: 'security' })
  })

  it('suggests updaters, browsers and chat apps', () => {
    expect(win('SunJavaUpdateSched', '"C:\\Program Files (x86)\\Common Files\\Java\\Java Update\\jusched.exe"')).toMatchObject({ effect: 'updater', recommended: true })
    expect(win('MicrosoftEdgeAutoLaunch_09B28E8583AF1CA564B413E5B3F7AE0C', '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --no-startup-window')).toMatchObject({
      name: 'Microsoft Edge',
      effect: 'browser',
      recommended: true
    })
    expect(win('Discord', 'C:\\Users\\u\\AppData\\Local\\Discord\\Update.exe --processStart Discord.exe')).toMatchObject({ name: 'Discord', effect: 'communication', recommended: true })
  })

  it('prefers the declared name and never suggests unknown apps', () => {
    const r = win('Instagram.lnk', '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge_proxy.exe" --app-id=x', { declaredName: 'Instagram', description: 'Microsoft Edge' })
    expect(r.name).toBe('Instagram')
    expect(win('Lightshot', 'C:\\Program Files (x86)\\Skillbrains\\lightshot\\Lightshot.exe')).toMatchObject({ risk: 'safe', recommended: false })
  })

  it('honours user-protected names and Linux desktop plumbing', () => {
    expect(win('Steam', '"C:\\Steam\\steam.exe"', { userProtected: new Set(['steam']) }).risk).toBe('critical')
    expect(assessStartup({ platform: 'linux', label: 'org.gnome.SettingsDaemon.Power.desktop', command: '/usr/libexec/gsd-power' }).risk).toBe('critical')
    expect(assessStartup({ platform: 'darwin', label: 'com.apple.something', command: '/usr/libexec/x' }).risk).toBe('critical')
  })
})

describe('startup: running impact', () => {
  const groups = buildGroups(
    [
      proc(10, 1, 'Discord.exe', { path: 'C:\\Users\\u\\AppData\\Local\\Discord\\app-1.0.9\\Discord.exe', memBytes: 420 * MB, cpu: 1 }),
      proc(20, 1, 'jusched.exe', { path: 'C:\\Program Files (x86)\\Common Files\\Java\\Java Update\\jusched.exe', memBytes: 5 * MB }),
      proc(30, 1, 'Update.exe', { path: 'C:\\Other\\Update.exe', memBytes: 50 * MB })
    ],
    ctx
  )

  it('matches by exact path and through Squirrel launchers, not by a generic name elsewhere', () => {
    expect(matchRunning('C:\\Program Files (x86)\\Common Files\\Java\\Java Update\\jusched.exe', undefined, groups).map((g) => g.rootPid)).toEqual([20])
    expect(matchRunning('C:\\Users\\u\\AppData\\Local\\Discord\\Update.exe', 'Discord.exe', groups).map((g) => g.rootPid)).toEqual([10])
    expect(matchRunning('C:\\Somewhere\\Update.exe', undefined, groups)).toEqual([])
  })

  it('grades impact from live usage', () => {
    expect(measureImpact(groups.filter((g) => g.rootPid === 10)).impact).toBe('high')
    expect(measureImpact(groups.filter((g) => g.rootPid === 20)).impact).toBe('low')
    expect(measureImpact([])).toEqual({ running: null, impact: 'not-running' })
  })
})

describe('performance mode planning', () => {
  const groups = buildGroups(
    [
      proc(100, 1, 'chrome.exe', { cpu: 6, memBytes: 900 * MB }),
      proc(101, 100, 'chrome.exe', { cpu: 2, memBytes: 300 * MB, command: 'chrome.exe --type=renderer' }),
      proc(200, 1, 'Discord.exe', { cpu: 1.5, memBytes: 350 * MB }),
      proc(300, 1, 'MyGame.exe', { cpu: 40, memBytes: 3000 * MB }),
      proc(400, 1, 'OneDrive.exe', { cpu: 0.8, memBytes: 160 * MB }),
      proc(500, 1, 'explorer.exe', { cpu: 2, memBytes: 200 * MB }),
      proc(600, 1, 'MsMpEng.exe', { cpu: 3, memBytes: 300 * MB }),
      proc(700, 1, 'idle.exe', { cpu: 0, memBytes: 2 * MB }),
      proc(800, 1, 'python.exe', { cpu: 30, memBytes: 1400 * MB, command: 'python.exe train_model.py' })
    ],
    ctx
  )
  const byRoot = (pid: number) => groups.find((g) => g.rootPid === pid) as AppGroup

  it('never touches caution/critical apps, services or security software', () => {
    expect(isEcoEligible(byRoot(500))).toBe(false)
    expect(isEcoEligible(byRoot(600))).toBe(false)
    expect(isEcoEligible({ ...byRoot(100), services: [{ name: 'svc', manager: 'windows-scm' }] })).toBe(false)
  })

  it('gaming: pre-selects browser and sync, keeps voice chat and the game itself untouched', () => {
    const plan = planBoost(groups, 'gaming', byRoot(300).id)
    const pick = (pid: number) => plan.candidates.find((c) => c.group.rootPid === pid)
    expect(pick(100)?.recommended).toBe(true)
    expect(pick(400)?.recommended).toBe(true)
    expect(pick(200)?.recommended).toBe(false)
    expect(pick(300)).toBeUndefined()
    expect(pick(700)).toBeUndefined()
    // A running script is deliberate work: listed, never pre-selected.
    expect(pick(800)?.recommended).toBe(false)
    expect(plan.focusOptions.some((g) => g.rootPid === 300)).toBe(true)
    expect(plan.protectedCount).toBeGreaterThanOrEqual(2)
  })

  it('custom profile pre-selects nothing', () => {
    expect(planBoost(groups, 'custom').candidates.every((c) => !c.recommended)).toBe(true)
  })

  it('keys apps by executable so new child processes are covered', () => {
    expect(boostKey(byRoot(100))).toBe('chrome')
  })
})
