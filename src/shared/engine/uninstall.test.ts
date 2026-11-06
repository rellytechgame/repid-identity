import { describe, expect, it } from 'vitest'
import { classifyApp, isGenericName, matchFolders, normalize, parseUninstallString, productKeys, vendorKeys } from './uninstall'

// Cases taken from a real Windows inventory (dry run, nothing deleted) where a naive matcher went wrong.

describe('uninstaller: product names', () => {
  it('strips trailing version, architecture and locale only', () => {
    expect(productKeys({ name: 'WinRAR 6.00 (64-bit)' }).primary).toContain('winrar')
    expect(productKeys({ name: 'Drift version 0.9.0' }).primary).toEqual(['drift'])
    expect(productKeys({ name: 'Microsoft Visio - es-es' }).primary).toContain('microsoftvisio')
  })

  it('never shrinks a name with a version in the middle (Visual Studio Tools ≠ Visual Studio)', () => {
    const k = productKeys({ name: 'Microsoft Visual Studio 2010 Tools for Office Runtime (x64)', publisher: 'Microsoft Corporation' })
    expect([...k.primary, ...k.vendorScoped]).not.toContain('visualstudio')
    expect([...k.primary, ...k.vendorScoped]).not.toContain('microsoftvisualstudio')
    expect(productKeys({ name: 'Microsoft SQL Server 2025 LocalDB' }).primary).not.toContain('microsoftsqlserver')
  })

  it('keeps vendor-less names scoped to the vendor folder', () => {
    expect(productKeys({ name: 'Mozilla Firefox', publisher: 'Mozilla' })).toEqual({ primary: ['mozillafirefox'], vendorScoped: ['firefox'] })
    expect(productKeys({ name: 'HP Documentation', publisher: 'HP Inc.' }).vendorScoped).toEqual(['documentation'])
  })

  it('uses the install folder only when it is named like the app', () => {
    expect(productKeys({ name: 'Opera GX Stable 138.0', installLocation: 'C:\\Users\\u\\AppData\\Local\\Programs\\Opera GX' }).primary).toContain('operagx')
    expect(productKeys({ name: 'Stroke Glow Shadow version 1.0.2', installLocation: 'C:\\Program Files\\obs-studio' }).primary).toEqual(['strokeglowshadow'])
    expect(productKeys({ name: 'Visual Studio Community 2026 Insiders', installLocation: 'C:\\Program Files\\Microsoft Visual Studio\\18\\Insiders' }).primary).not.toContain('insiders')
  })

  it('drops generic and shared-ecosystem names', () => {
    expect(isGenericName('Common Files')).toBe(true)
    expect(isGenericName('Python')).toBe(true)
    expect(productKeys({ name: 'Git' }).primary).toEqual([])
  })

  it('derives vendor keys without legal suffixes', () => {
    expect(vendorKeys('Opera Software')).toEqual(expect.arrayContaining(['operasoftware', 'opera']))
    expect(vendorKeys('Foxit Software Inc.')).toEqual(expect.arrayContaining(['foxitsoftware', 'foxit']))
    expect(normalize('Notepad++')).toBe('notepad')
  })
})

describe('uninstaller: folder matching', () => {
  const tree: Record<string, string[]> = {
    R: ['Opera Software', 'Unity', 'TeamViewer', 'Adobe', 'Shared Thing'],
    'R\\Opera Software': ['Opera GX Stable', 'Opera Stable'],
    'R\\Adobe': ['Illustrator', 'Photoshop']
  }
  const listing = (d: string) => tree[d] ?? []

  it('matches exact names at top level and scoped names under the vendor', () => {
    const opera = matchFolders('R', listing, productKeys({ name: 'Opera GX Stable', publisher: 'Opera Software' }), vendorKeys('Opera Software'), new Set(), '\\')
    expect(opera.map((c) => c.path)).toEqual(['R\\Opera Software\\Opera GX Stable'])
    const ai = matchFolders('R', listing, productKeys({ name: 'Adobe Illustrator 2022', publisher: 'Adobe Inc.' }), vendorKeys('Adobe Inc.'), new Set(), '\\')
    expect(ai.map((c) => c.path)).toEqual(['R\\Adobe\\Illustrator'])
  })

  it('never matches short names at top level (Unity → LocalLow\\Unity is shared by every Unity game)', () => {
    expect(matchFolders('R', listing, productKeys({ name: 'Unity 6000.0.11f1' }), [], new Set(), '\\')).toEqual([])
  })

  it('skips names claimed by another installed app', () => {
    expect(matchFolders('R', listing, productKeys({ name: 'TeamViewer' }), [], new Set(['teamviewer']), '\\')).toEqual([])
  })
})

describe('uninstaller: commands and protection', () => {
  it('rebuilds MSI uninstalls from the product code', () => {
    expect(parseUninstallString('MsiExec.exe /I{1199FAD5-9546-44F3-81CF-FFDB8040B7BF}')).toEqual({ kind: 'msi', productCode: '{1199FAD5-9546-44F3-81CF-FFDB8040B7BF}' })
    expect(parseUninstallString('"C:\\Program Files\\App\\unins000.exe" /SILENT')).toEqual({ kind: 'exe', exe: 'C:\\Program Files\\App\\unins000.exe', args: '/SILENT' })
    expect(parseUninstallString('C:\\Program Files (x86)\\App\\uninstall.exe')?.kind).toBe('exe')
    expect(parseUninstallString('')).toBeNull()
  })

  it('locks shared runtimes and warns for drivers and security', () => {
    expect(classifyApp('Microsoft Visual C++ 2015-2022 Redistributable (x64)').risk).toBe('critical')
    expect(classifyApp('Microsoft .NET Runtime - 8.0.11 (x64)').risk).toBe('critical')
    expect(classifyApp('Microsoft Edge WebView2 Runtime').risk).toBe('critical')
    expect(classifyApp('NVIDIA Controlador de gráficos 592.82', 'NVIDIA Corporation')).toMatchObject({ kind: 'driver', risk: 'caution' })
    expect(classifyApp('Malwarebytes version 5.1').risk).toBe('caution')
    expect(classifyApp('Opera GX Stable', 'Opera Software')).toEqual({ kind: 'app', risk: 'safe' })
  })
})
