import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Edition, EditionState, LicenseInfo } from '../../shared/types'
import { SUPPORT_EMAIL } from '../../shared/constants'
import { editionState, splitLicenseKey, supportCode, supportSubject, type LanPeer } from '../../shared/engine/edition'
import { powershell } from '../engine/exec'
import { corporateSignals } from './corporate'
import { LAN_PORT, LanBeacon, prunePeers } from './lan'
import { verifyLicense } from './license'

interface Stored {
  installId: string
  /** Latest time ever observed (local clock or GitHub's): turning the clock back cannot un-expire a license. */
  lastSeen?: number
  peers: Record<string, LanPeer>
  license?: string
}

/** Lets the UDP announcements through Windows Firewall (RePID runs elevated there). Same-subnet only. */
const FIREWALL_RULE = `
if (-not (Get-NetFirewallRule -Name 'RePID-LAN' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -Name 'RePID-LAN' -DisplayName 'RePID Identity (local network)' -Group 'RePID Identity' -Direction Inbound -Protocol UDP -LocalPort ${LAN_PORT} -RemoteAddress LocalSubnet -Program $env:REPID_EXE -Action Allow -Profile Any | Out-Null
}
`

/**
 * Edition, license and the free-copies-per-network rule. All local: the
 * license is verified with the embedded public key and the copy count comes
 * from LAN announcements, so there is no server or database.
 */
export class EditionManager {
  private data: Stored = { installId: randomBytes(16).toString('hex'), peers: {} }
  private license: LicenseInfo | null = null
  private signals: string[] = []
  private beacon: LanBeacon | null = null
  private saveTimer: NodeJS.Timeout | null = null

  constructor(
    readonly edition: Edition,
    private readonly storePath: string,
    private readonly exePath: string
  ) {}

  async start(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.storePath, 'utf8')) as Partial<Stored>
      if (typeof raw.installId === 'string' && /^[0-9a-f]{32}$/.test(raw.installId)) this.data.installId = raw.installId
      if (raw.peers && typeof raw.peers === 'object') this.data.peers = prunePeers(raw.peers, Date.now())
      if (typeof raw.license === 'string') this.data.license = raw.license
      if (Number.isSafeInteger(raw.lastSeen)) this.data.lastSeen = raw.lastSeen
    } catch {
      await this.save()
    }
    if (this.data.license) this.license = verifyLicense(this.data.license)
    void corporateSignals().then((s) => (this.signals = s))
    if (process.platform === 'win32') void powershell(FIREWALL_RULE, { REPID_EXE: this.exePath }, 30000)
    this.beacon = new LanBeacon(
      this.data.installId,
      () => ({ edition: this.edition, license: this.edition === 'enterprise' ? (this.license?.id ?? '') : '' }),
      (id, peer) => {
        this.data.peers[id] = peer
        this.scheduleSave()
      }
    )
    this.beacon.start()
  }

  stop(): void {
    this.beacon?.stop()
  }

  /** Clock used for license expiry: never earlier than any time seen before. */
  private now(): number {
    const now = Date.now()
    if (now > (this.data.lastSeen ?? 0)) {
      this.data.lastSeen = now
      this.scheduleSave()
    }
    return Math.max(now, this.data.lastSeen ?? 0)
  }

  /** Trusted time from GitHub's servers (the update check's Date header). */
  observeTime(serverTime: number): void {
    if (Number.isSafeInteger(serverTime) && serverTime > (this.data.lastSeen ?? 0) && serverTime < Date.now() + 400 * 864e5) {
      this.data.lastSeen = serverTime
      this.scheduleSave()
    }
  }

  state(): EditionState {
    return editionState({
      edition: this.edition,
      selfId: this.data.installId,
      peers: this.data.peers,
      license: this.edition === 'enterprise' ? this.license : null,
      supportCode: this.code(),
      corporateSignals: this.signals,
      now: this.now()
    })
  }

  get limited(): boolean {
    return this.state().limited
  }

  /** Refuses an action of a locked section (the UI hides them too; this is the enforcement). */
  assertAllowed(): void {
    if (this.limited) throw new Error('RePID: this feature needs RePID Enterprise on this network')
  }

  async activate(raw: unknown): Promise<{ ok: boolean; error?: 'invalid' | 'expired' | 'free-edition'; state: EditionState }> {
    if (this.edition !== 'enterprise') return { ok: false, error: 'free-edition', state: this.state() }
    const key = typeof raw === 'string' && raw.length <= 4096 ? raw.trim() : ''
    const lic = verifyLicense(key)
    if (!lic) return { ok: false, error: 'invalid', state: this.state() }
    if (lic.expiresAt < this.now()) return { ok: false, error: 'expired', state: this.state() }
    this.license = lic
    this.data.license = key
    await this.save()
    return { ok: true, state: this.state() }
  }

  private code(): string | undefined {
    const sig = this.data.license ? splitLicenseKey(this.data.license)?.signature : undefined
    return this.license && sig ? supportCode(this.license.id, sig) : undefined
  }

  /**
   * mailto: link to Voxel Enterprise with a recognizable subject and the full
   * signed key in the body, so support can verify it without any database.
   * Only for Enterprise with a genuine license (expired ones included: renewals need support too).
   */
  contactUrl(kind: unknown, language: string, version: string): string | null {
    if ((kind !== 'support' && kind !== 'beta') || this.edition !== 'enterprise' || !this.license || !this.data.license) return null
    const es = language.toLowerCase().startsWith('es')
    const code = this.code() ?? ''
    const subject = supportSubject(kind, language, code, this.license.company, version)
    const intro =
      kind === 'beta'
        ? es
          ? 'Hola Voxel Enterprise, solicito acceso anticipado a las versiones Beta de RePID.'
          : 'Hello Voxel Enterprise, I would like early access to RePID Beta versions.'
        : es
          ? 'Hola Voxel Enterprise, necesito ayuda con RePID Enterprise.\n\nDescribe aquí el problema:\n\n\n'
          : 'Hello Voxel Enterprise, I need help with RePID Enterprise.\n\nDescribe the problem here:\n\n\n'
    const body = [
      intro,
      '',
      '— ' + (es ? 'Datos de la licencia (no los borres)' : 'License details (please keep)') + ' —',
      `${es ? 'Código de soporte' : 'Support code'}: ${code}`,
      `${es ? 'Empresa' : 'Company'}: ${this.license.company}`,
      `${es ? 'Equipos' : 'Computers'}: ${this.license.seats}`,
      `${es ? 'Vence' : 'Expires'}: ${new Date(this.license.expiresAt).toISOString().slice(0, 10)}`,
      `RePID: v${version} · ${process.platform} ${process.arch}`,
      `${es ? 'Clave' : 'Key'}: ${this.data.license}`
    ].join('\n')
    const to = es ? SUPPORT_EMAIL.es : SUPPORT_EMAIL.en
    return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  async removeLicense(): Promise<EditionState> {
    this.license = null
    delete this.data.license
    await this.save()
    return this.state()
  }

  private scheduleSave(): void {
    this.saveTimer ??= setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, 5000)
  }

  private async save(): Promise<void> {
    this.data.peers = prunePeers(this.data.peers, Date.now())
    await mkdir(dirname(this.storePath), { recursive: true })
    const tmp = `${this.storePath}.tmp`
    await writeFile(tmp, JSON.stringify(this.data), 'utf8')
    await rename(tmp, this.storePath)
  }
}

export function editionStorePath(userData: string): string {
  return join(userData, 'edition.json')
}
