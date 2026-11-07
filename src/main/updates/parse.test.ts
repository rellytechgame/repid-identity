import { describe, expect, it } from 'vitest'
import { PACKAGE_ID, isMajorJump, parseBrewOutdated, parseFlatpakUpdates, parseWingetUpgrade } from './parse'

// Shape of real `winget upgrade` output (spinner frames, CRLF, summary line, localized header).
const WINGET = [
  '\r   - \r   \\ \r                                                                                                                        \r',
  'Nombre                                                      Id                                        Versión         Disponible      Origen\r',
  '---------------------------------------------------------------------------------------------------------------------------------------------\r',
  'Git                                                         Git.Git                                   2.49.0          2.56.0.4        winget\r',
  'Microsoft Build of OpenJDK  21.0.7+6 (x64)                  Microsoft.OpenJDK.21                      21.0.7.6        21.0.13.21      winget\r',
  'MariaDB 11.3 (x64)                                          MariaDB.Server                            11.3.2.0        13.0.2.0        winget\r',
  'Truncated app                                               Some.Very.Long.Package.Ident…             1.0             2.0             winget\r',
  'VLC media player                                            XPDM1ZW6815MQM                            3.0.20          3.0.23          msstore\r',
  '4 actualizaciones disponibles.\r'
].join('\n')

describe('updates', () => {
  it('parses winget tables by column position, whatever the header language', () => {
    const list = parseWingetUpgrade(WINGET)
    expect(list.map((u) => [u.id, u.name, u.current, u.available])).toEqual([
      ['Git.Git', 'Git', '2.49.0', '2.56.0.4'],
      ['Microsoft.OpenJDK.21', 'Microsoft Build of OpenJDK  21.0.7+6 (x64)', '21.0.7.6', '21.0.13.21'],
      ['MariaDB.Server', 'MariaDB 11.3 (x64)', '11.3.2.0', '13.0.2.0'],
      ['XPDM1ZW6815MQM', 'VLC media player', '3.0.20', '3.0.23']
    ])
    expect(list.find((u) => u.id === 'MariaDB.Server')?.major).toBe(true)
    expect(list.find((u) => u.id === 'Git.Git')?.major).toBeUndefined()
    expect(parseWingetUpgrade('No installed package found matching input criteria.')).toEqual([])
  })

  it('flags major version jumps', () => {
    expect(isMajorJump('py310_23.5.2-0', 'py314_26.9.4-0')).toBe(true)
    expect(isMajorJump('ad 9.0.12', '9.8.3')).toBe(false)
    expect(isMajorJump('6000.0.11f1', '6000.6.8f1')).toBe(false)
  })

  it('accepts only plain package ids', () => {
    for (const ok of ['Git.Git', 'Microsoft.VisualStudio.2019.BuildTools', 'org.mozilla.firefox', 'XPDM1ZW6815MQM', 'node@20']) expect(PACKAGE_ID.test(ok)).toBe(true)
    for (const bad of ['', '-rf', 'a b', 'x;rm', '"q"', '$(id)']) expect(PACKAGE_ID.test(bad)).toBe(false)
  })

  it('parses Homebrew and Flatpak listings', () => {
    const brew = parseBrewOutdated(JSON.stringify({ formulae: [{ name: 'git', installed_versions: ['2.40.0'], current_version: '2.43.0' }, { name: 'pinned', pinned: true }], casks: [{ name: 'firefox', installed_versions: '120.0', current_version: '121.0' }] }))
    expect(brew.map((u) => [u.id, u.source, u.current, u.available])).toEqual([
      ['firefox', 'brew-cask', '120.0', '121.0'],
      ['git', 'brew', '2.40.0', '2.43.0']
    ])
    expect(parseBrewOutdated('not json')).toEqual([])
    const fp = parseFlatpakUpdates('org.mozilla.firefox\tFirefox\t121.0\n\n', new Map([['org.mozilla.firefox', '120.0']]))
    expect(fp).toEqual([{ id: 'org.mozilla.firefox', name: 'Firefox', current: '120.0', available: '121.0', source: 'flatpak' }])
  })
})
