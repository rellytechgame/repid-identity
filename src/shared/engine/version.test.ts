import { describe, expect, it } from 'vitest'
import { compareVersions, latestFromRelease } from './version'

describe('app update check', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBe(1)
    expect(compareVersions('v1.4.0', '1.4.0')).toBe(0)
    expect(compareVersions('1.4.0', '1.5.0')).toBe(-1)
    expect(compareVersions('2.0.0-beta.1', '1.9.9')).toBe(1)
  })

  it('reads the version from the installer name of the fixed release (real shape)', () => {
    expect(latestFromRelease({ name: 'RePID Installers', body: '# RePID v1.4.0 — Release Notes', assets: [{ name: 'RePID-Identity-1.4.0-win.exe' }] })).toBe('1.4.0')
    expect(latestFromRelease({ assets: [{ name: 'RePID-Identity-1.5.0-win-x64.exe' }, { name: 'RePID-Identity-1.10.2-win-arm64.exe' }, { name: 'latest.yml' }] })).toBe('1.10.2')
  })

  it('falls back to the release notes, and returns null when nothing says a version', () => {
    expect(latestFromRelease({ name: 'RePID Installers', body: 'Notas de la v1.6.0', assets: [{ name: 'setup.exe' }] })).toBe('1.6.0')
    expect(latestFromRelease({ name: 'RePID Installers', body: 'Bugfixes', assets: [] })).toBeNull()
  })
})
