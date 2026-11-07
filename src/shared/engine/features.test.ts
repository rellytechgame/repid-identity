import { describe, expect, it } from 'vitest'
import type { AppGroup } from '../types'
import { DEFAULT_AUTOMATION, detectGrowth, isGamePath, sanitizeAutomation } from './automation'
import { batteryCapacityPct, healthFindings } from './health'
import { summarizeConnections } from './network'
import { classifyService } from './services'

const GIB = 1024 ** 3
const MIN = 60_000

describe('automation', () => {
  it('detects games in store libraries, never the launchers or their helpers', () => {
    expect(isGamePath('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hades\\Hades.exe')).toBe(true)
    expect(isGamePath('D:\\SteamLibrary\\steamapps\\common\\Cyberpunk 2077\\bin\\x64\\Cyberpunk2077.exe')).toBe(true)
    expect(isGamePath('C:\\Program Files\\Epic Games\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient-Win64-Shipping.exe')).toBe(true)
    expect(isGamePath('C:\\XboxGames\\Forza Horizon 5\\Content\\ForzaHorizon5.exe')).toBe(true)
    expect(isGamePath('C:\\Riot Games\\VALORANT\\live\\VALORANT.exe')).toBe(true)
    expect(isGamePath('C:\\Program Files (x86)\\Steam\\steam.exe')).toBe(false)
    expect(isGamePath('C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe')).toBe(false)
    expect(isGamePath('C:\\Riot Games\\Riot Client\\RiotClientServices.exe')).toBe(false)
    expect(isGamePath('D:\\SteamLibrary\\steamapps\\common\\Game\\UnityCrashHandler64.exe')).toBe(false)
    expect(isGamePath('D:\\SteamLibrary\\steamapps\\common\\Game\\EasyAntiCheat\\EasyAntiCheat.exe')).toBe(false)
  })

  it('flags memory that keeps climbing, not a spike that settles', () => {
    const now = 100 * MIN
    const climbing = [0, 10, 20, 30, 40, 50, 60, 70].map((m, i) => ({ at: now - (70 - m) * MIN, bytes: (1 + i * 0.5) * GIB }))
    expect(detectGrowth(climbing, now)).not.toBeNull()
    const settled = [...climbing.slice(0, -3), ...[1, 2, 3].map((i) => ({ at: now - (3 - i) * MIN, bytes: 1.4 * GIB }))]
    expect(detectGrowth(settled, now)).toBeNull()
    const small = climbing.map((s) => ({ ...s, bytes: s.bytes / 4 }))
    expect(detectGrowth(small, now)).toBeNull()
    expect(detectGrowth(climbing.slice(-2), now)).toBeNull()
  })

  it('sanitizes UI input and never lets the UI set the schedule clock', () => {
    const prev = { ...structuredClone(DEFAULT_AUTOMATION), scheduledClean: { enabled: true, frequency: 'daily' as const, lastRun: 123 } }
    const cfg = sanitizeAutomation(
      {
        autoBoost: { enabled: true, games: false, apps: ['Blender.exe', 'blender', '../../evil', 'a'.repeat(100), 42] },
        scheduledClean: { enabled: true, frequency: 'hourly', lastRun: 0 },
        alerts: { diskThreshold: 5 },
        background: { keepInTray: 'yes' }
      },
      prev
    )
    expect(cfg.autoBoost.apps).toEqual(['blender'])
    expect(cfg.scheduledClean).toEqual({ enabled: true, frequency: 'daily', lastRun: 123 })
    expect(cfg.alerts.diskThreshold).toBe(70)
    expect(cfg.background.keepInTray).toBe(false)
  })
})

describe('health', () => {
  it('reports problems worst first and says so when all is good', () => {
    const base = { drives: [], volumes: [], uptimeSec: 3600 }
    expect(healthFindings(base)).toEqual([{ severity: 'ok', key: 'allGood' }])
    const bad = healthFindings({
      ...base,
      drives: [{ name: 'SSD', media: 'NVMe', sizeBytes: 1, status: 'healthy', wearPct: 93, readErrors: 2 }],
      volumes: [{ mount: 'C:', sizeBytes: 100, usedBytes: 88 }],
      battery: { capacityPct: 72 },
      uptimeSec: 10 * 86400
    })
    expect(bad.map((f) => f.key)).toEqual(['driveErrors', 'driveWorn', 'volumeLow', 'batteryAged', 'restart'])
  })

  it('computes battery capacity only from plausible readings', () => {
    expect(batteryCapacityPct(56000, 43700)).toBe(78)
    expect(batteryCapacityPct(56000, 60000)).toBe(100)
    expect(batteryCapacityPct(0, 100)).toBeUndefined()
  })
})

describe('services (cases from a real machine)', () => {
  const svc = (name: string, displayName: string, company: string, path = 'C:\\x.exe') => classifyService({ name, displayName, company, path })

  it('suggests updaters, telemetry and curated Windows services', () => {
    expect(svc('GoogleUpdaterService157.0.8089.0', 'Google Updater Service', 'Google LLC')).toMatchObject({ catalogKey: 'updater', recommended: true })
    expect(svc('FoxitReaderUpdateService', 'Foxit PDF Reader Update Service', 'Foxit Software Inc.')).toMatchObject({ recommended: true })
    expect(svc('HpTouchpointAnalyticsService', 'HP Insights Analytics', 'HP Inc.')).toMatchObject({ catalogKey: 'telemetryApp', recommended: true })
    expect(svc('DiagTrack', 'Connected User Experiences and Telemetry', 'Microsoft Corporation')).toMatchObject({ catalogKey: 'telemetry', risk: 'safe' })
    expect(svc('WSearch', 'Windows Search', 'Microsoft Corporation')).toMatchObject({ risk: 'caution', recommended: false })
  })

  it('marks remote access, databases and licenses as caution', () => {
    expect(svc('AnyDesk', 'AnyDesk Service', 'AnyDesk Software GmbH')).toMatchObject({ catalogKey: 'remote', risk: 'caution', recommended: false })
    expect(svc('MariaDB', 'MariaDB', '')).toMatchObject({ catalogKey: 'database', risk: 'caution' })
    expect(svc('hasplms', 'Sentinel LDK License Manager', 'THALES')).toMatchObject({ catalogKey: 'license' })
    expect(svc('HPOmenCap', 'HP Omen HSA Service', 'HP Inc.')).toMatchObject({ risk: 'caution', recommended: false })
  })

  it('never offers drivers, audio, GPU, security or uncurated Windows internals', () => {
    expect(svc('NVDisplay.ContainerLocalSystem', 'NVIDIA Display Container LS', '')).toBeNull()
    expect(svc('RtkAudioUniversalService', 'Realtek Audio Universal Service', 'Realtek Semiconductor')).toBeNull()
    expect(svc('ETDService', 'ELAN Service', 'ELAN Microelectronics Corp.')).toBeNull()
    expect(svc('SECOMNService', 'Sound Research SECOMN Service', 'Sound Research, Corp.')).toBeNull()
    expect(svc('WinDefend', 'Microsoft Defender Antivirus Service', 'Microsoft Corporation')).toBeNull()
    expect(svc('Dhcp', 'DHCP Client', 'Microsoft Corporation')).toBeNull()
  })
})

describe('network', () => {
  const group = (id: string, pids: number[]) => ({ id, name: id, pids, identity: { category: 'browser' }, risk: 'safe', path: `C:\\${id}.exe` }) as unknown as AppGroup

  it('counts outside connections per app and ignores loopback traffic', () => {
    const res = summarizeConnections(
      [
        { pid: 1, state: 'ESTABLISHED', localPort: '5000', peerAddress: '142.250.1.1', peerPort: '443', protocol: 'tcp' },
        { pid: 2, state: 'ESTABLISHED', localPort: '5001', peerAddress: '142.250.1.1', peerPort: '443', protocol: 'tcp' },
        { pid: 1, state: 'ESTABLISHED', localPort: '5002', peerAddress: '127.0.0.1', peerPort: '9000', protocol: 'tcp' },
        { pid: 3, state: 'LISTEN', localPort: '27036', peerAddress: '0.0.0.0', peerPort: '0', protocol: 'tcp' },
        { pid: 9, state: 'ESTABLISHED', localPort: '1', peerAddress: '8.8.8.8', peerPort: '53', protocol: 'tcp' }
      ],
      [group('chrome', [1, 2]), group('steam', [3])]
    )
    expect(res.map((r) => [r.group.id, r.connections, r.listening, r.remotes])).toEqual([
      ['chrome', 2, [], ['142.250.1.1:443']],
      ['steam', 0, [27036], []]
    ])
  })
})
