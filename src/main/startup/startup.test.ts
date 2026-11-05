import { describe, expect, it } from 'vitest'
import { parseStartupRequest } from '.'
import { parseDisabled } from './darwin'
import { desktopEnabled, parseDesktopEntry, stripFieldCodes, withDesktopKey } from './linux'
import { approvedValue, storeName } from './windows'

describe('windows startup', () => {
  it('writes the same StartupApproved values as Task Manager', () => {
    expect(approvedValue(true)).toBe('020000000000000000000000')
    const off = approvedValue(false, Date.UTC(2026, 0, 1))
    expect(off).toHaveLength(24)
    expect(off.slice(0, 8)).toBe('03000000')
    // Reference from .NET: [DateTime]::new(2026,1,1,0,0,0,'Utc').ToFileTimeUtc() as little-endian bytes.
    expect(off.slice(8)).toBe('00008192b17adc01')
  })

  it('derives readable Store app names', () => {
    expect(storeName('5319275A.WhatsAppDesktop_cv1g1gvanyjgm')).toBe('WhatsAppDesktop')
    expect(storeName('Claude_pzs8sxrjxfjjc')).toBe('Claude')
  })
})

describe('linux autostart', () => {
  const sys = '[Desktop Entry]\nType=Application\nName=Slack\nExec=/usr/bin/slack %U\n\n[Desktop Action New]\nName=New\n'

  it('parses only the main group and strips field codes', () => {
    expect(parseDesktopEntry(sys)).toMatchObject({ Name: 'Slack', Exec: '/usr/bin/slack %U' })
    expect(stripFieldCodes('/usr/bin/slack %U')).toBe('/usr/bin/slack')
  })

  it('disables reversibly with Hidden=true inside [Desktop Entry]', () => {
    const off = withDesktopKey(sys, 'Hidden', 'true')
    expect(desktopEnabled(parseDesktopEntry(off))).toBe(false)
    expect(off.indexOf('Hidden=true')).toBeLessThan(off.indexOf('[Desktop Action New]'))
    const on = withDesktopKey(off, 'Hidden', 'false')
    expect(desktopEnabled(parseDesktopEntry(on))).toBe(true)
    expect(on.match(/Hidden=/g)).toHaveLength(1)
  })

  it('respects GNOME autostart flag', () => {
    expect(desktopEnabled({ 'X-GNOME-Autostart-enabled': 'false' })).toBe(false)
  })
})

describe('macOS launchd overrides', () => {
  it('reads both modern and legacy print-disabled formats', () => {
    const m = parseDisabled('disabled services = {\n\t"com.foo.agent" => disabled\n\t"com.bar" => enabled\n\t"com.old" => true\n}')
    expect(m.get('com.foo.agent')).toBe(true)
    expect(m.get('com.bar')).toBe(false)
    expect(m.get('com.old')).toBe(true)
  })
})

describe('startup requests', () => {
  it('accepts ids only and rejects malformed payloads', () => {
    expect(parseStartupRequest({ ids: ['hkcu-run:Steam', 'hkcu-run:Steam'], enabled: false })).toEqual({ ids: ['hkcu-run:Steam'], enabled: false, allowCaution: false })
    expect(() => parseStartupRequest({ ids: [], enabled: false })).toThrow()
    expect(() => parseStartupRequest({ ids: ['x\u0000y'], enabled: true })).toThrow()
    expect(() => parseStartupRequest({ ids: ['ok:id'], enabled: 'yes' })).toThrow()
    expect(() => parseStartupRequest({ ids: Array.from({ length: 201 }, (_, i) => `a:${i}`), enabled: true })).toThrow()
  })
})
