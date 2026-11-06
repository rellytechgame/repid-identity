import { describe, expect, it } from 'vitest'
import { parseCleanRequest, parseUninstallRequest } from '.'
import { matchesBundle } from './darwin'
import { parseFlatpakList } from './linux'
import { isOfferablePath } from './windows'

describe('uninstall requests', () => {
  it('accepts an id and a mode only', () => {
    expect(parseUninstallRequest({ id: 'reg:HKCU:App', mode: 'standard', closeRunning: true })).toEqual({ id: 'reg:HKCU:App', mode: 'standard', closeRunning: true, allowCaution: false })
    expect(() => parseUninstallRequest({ id: 'reg:HKCU:App', mode: 'rm -rf' })).toThrow()
    expect(() => parseUninstallRequest({ id: 'x\u0000', mode: 'quiet' })).toThrow()
  })

  it('selects leftovers by session ids, never by path', () => {
    expect(parseCleanRequest({ appId: 'reg:HKCU:App', ids: ['l1a2b3', 'l1a2b3'] }).ids).toEqual(['l1a2b3'])
    expect(() => parseCleanRequest({ appId: 'reg:HKCU:App', ids: ['C:\\Windows'] })).toThrow()
    expect(() => parseCleanRequest({ appId: 'reg:HKCU:App', ids: ['../../etc'] })).toThrow()
    expect(() => parseCleanRequest({ appId: 'reg:HKCU:App', ids: [] })).toThrow()
  })
})

describe('windows: offerable paths', () => {
  const roots = ['C:\\Users\\u', 'C:\\Users\\u\\AppData\\Roaming', 'C:\\Users\\u\\AppData\\Local', 'C:\\ProgramData', 'C:\\Program Files', 'C:\\Program Files (x86)']
  it('refuses roots, shallow paths and Windows', () => {
    for (const r of roots) expect(isOfferablePath(r, roots)).toBe(false)
    expect(isOfferablePath('C:\\Tools', roots)).toBe(false)
    expect(isOfferablePath('C:\\Windows\\System32\\drivers', roots)).toBe(false)
    expect(isOfferablePath('C:\\Program Files\\', roots)).toBe(false)
  })
  it('allows an app folder under a root', () => {
    expect(isOfferablePath('C:\\Program Files\\WinRAR', roots)).toBe(true)
    expect(isOfferablePath('C:\\Users\\u\\AppData\\Roaming\\Opera Software\\Opera GX Stable', roots)).toBe(true)
  })
})

describe('macOS bundle matching', () => {
  it('matches the bundle id and its derived names only', () => {
    expect(matchesBundle('com.spotify.client', 'com.spotify.client')).toBe(true)
    expect(matchesBundle('com.spotify.client.plist', 'com.spotify.client')).toBe(true)
    expect(matchesBundle('com.spotify.client.savedState', 'com.spotify.client')).toBe(true)
    expect(matchesBundle('UBF8T346G9.com.microsoft.teams', 'com.microsoft.teams')).toBe(true)
    expect(matchesBundle('com.spotify.clientx', 'com.spotify.client')).toBe(false)
    expect(matchesBundle('com.spotify', 'com.spotify.client')).toBe(false)
  })
})

describe('linux flatpak list', () => {
  it('parses tab-separated columns and rejects malformed ids', () => {
    const out = 'org.mozilla.firefox\tFirefox\t131.0\tsystem\ncom.spotify.Client\tSpotify\t1.2\tuser\nbad id\tX\t1\tuser\n'
    expect(parseFlatpakList(out)).toEqual([
      { id: 'org.mozilla.firefox', name: 'Firefox', version: '131.0', installation: 'system' },
      { id: 'com.spotify.Client', name: 'Spotify', version: '1.2', installation: 'user' }
    ])
  })
})
