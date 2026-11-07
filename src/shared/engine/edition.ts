import type { Edition, EditionState, LicenseInfo } from '../types'

/** Free copies allowed on one local network; one more than this switches every free copy there to limited mode. */
export const LAN_FREE_LIMIT = 5
/** A copy seen on the network counts for this long after its last announcement. */
export const LAN_WINDOW_MS = 14 * 24 * 3600 * 1000
/** An expired license keeps working this long, so a renewal a few days late breaks nothing. */
export const LICENSE_GRACE_MS = 14 * 24 * 3600 * 1000

/** Sections locked in limited mode (the main process refuses their actions too). Monitoring, cleanup and core tools stay free. */
export const GATED_VIEWS = ['automation', 'services', 'updates', 'disk', 'network'] as const

export interface LanPeer {
  edition: Edition
  /** License id announced by enterprise copies ('' when unlicensed). */
  license: string
  seen: number
}

/**
 * Support code printed in every support email subject: license id plus the
 * first 8 characters of the license's Ed25519 signature. Only a genuine key
 * yields it, and Voxel Enterprise recomputes it from the key in the email
 * body (`npm run license -- --verify`), so it cannot be invented.
 */
export function supportCode(licenseId: string, signature: string): string {
  return `RPE-${licenseId.toUpperCase()}-${signature.slice(0, 8)}`
}

/** Recognizable subject: "[RePID Enterprise][Soporte] RPE-… · Acme S.A. · v1.5.0". */
export function supportSubject(kind: 'support' | 'beta', language: string, code: string, company: string, version: string): string {
  const es = language.toLowerCase().startsWith('es')
  const tag = kind === 'beta' ? 'Beta' : es ? 'Soporte' : 'Support'
  return `[RePID Enterprise][${tag}] ${code} · ${company} · v${version}`
}

export interface EditionInput {
  edition: Edition
  selfId: string
  peers: Record<string, LanPeer>
  license: LicenseInfo | null
  /** Support code of the license (see supportCode). */
  supportCode?: string
  corporateSignals: string[]
  now: number
}

/**
 * Decides the edition state from what this copy knows locally: the license
 * it holds and the other RePID copies that announced themselves on the same
 * local network. No server is involved.
 *
 * - Free: more than LAN_FREE_LIMIT free copies on the network → limited.
 *   Company computers (domain, Azure AD, server, MDM) get a notice only.
 * - Enterprise: needs a valid license; limited without one, after the grace
 *   period of an expired one, or when more copies than seats use it on the
 *   same network.
 */
export function editionState(input: EditionInput): EditionState {
  const recent = Object.entries(input.peers).filter(([id, p]) => id !== input.selfId && input.now - p.seen <= LAN_WINDOW_MS)
  const freeCopies = recent.filter(([, p]) => p.edition === 'free').length + (input.edition === 'free' ? 1 : 0)
  const base = {
    edition: input.edition,
    corporate: input.corporateSignals.length > 0,
    corporateSignals: input.corporateSignals,
    lanInstalls: freeCopies,
    lanLimit: LAN_FREE_LIMIT
  }
  if (input.edition === 'free') {
    return freeCopies > LAN_FREE_LIMIT ? { ...base, limited: true, reason: 'lan-limit' } : { ...base, limited: false }
  }
  const lic = input.license
  if (!lic) return { ...base, limited: true, reason: 'no-license' }
  const seatsInUse = 1 + recent.filter(([, p]) => p.edition === 'enterprise' && p.license === lic.id).length
  const expired = input.now > lic.expiresAt
  const license = { ...lic, seatsInUse, graceUntil: expired ? lic.expiresAt + LICENSE_GRACE_MS : undefined, supportCode: input.supportCode ?? '' }
  if (expired && input.now > lic.expiresAt + LICENSE_GRACE_MS) return { ...base, limited: true, reason: 'expired', license }
  if (seatsInUse > lic.seats) return { ...base, limited: true, reason: 'seats-exceeded', license }
  return { ...base, limited: false, reason: expired ? 'expired' : undefined, license }
}

export const LICENSE_PREFIX = 'REPID1-'

/** Splits "REPID1-<payload>.<signature>" (base64url). Signature checking happens in the main process. */
export function splitLicenseKey(key: string): { payload: string; signature: string } | null {
  const clean = key.replace(/\s+/g, '')
  if (!clean.startsWith(LICENSE_PREFIX)) return null
  const [payload, signature, extra] = clean.slice(LICENSE_PREFIX.length).split('.')
  if (!payload || !signature || extra !== undefined || !/^[\w-]+$/.test(payload) || !/^[\w-]+$/.test(signature)) return null
  return { payload, signature }
}

/** Validates the signed JSON payload's shape; anything unexpected is rejected. */
export function parseLicensePayload(json: string): LicenseInfo | null {
  try {
    const p = JSON.parse(json) as Record<string, unknown>
    const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max
    const int = (v: unknown) => Number.isSafeInteger(v) && (v as number) > 0
    if (!str(p.id, 64) || !str(p.company, 120) || !int(p.seats) || !int(p.issuedAt) || !int(p.expiresAt)) return null
    if ((p.seats as number) > 100000 || (p.expiresAt as number) <= (p.issuedAt as number)) return null
    return {
      id: p.id as string,
      company: p.company as string,
      email: str(p.email, 200) ? (p.email as string) : undefined,
      seats: p.seats as number,
      issuedAt: p.issuedAt as number,
      expiresAt: p.expiresAt as number
    }
  } catch {
    return null
  }
}

/** A LAN announcement from another copy. Only an anonymous random id, the edition and a license id: nothing personal. */
export function parseBeacon(text: string): { id: string; peer: Omit<LanPeer, 'seen'> } | null {
  try {
    const m = JSON.parse(text) as Record<string, unknown>
    if (m.p !== 'repid' || m.v !== 1) return null
    if (typeof m.id !== 'string' || !/^[0-9a-f]{32}$/.test(m.id)) return null
    if (m.e !== 'free' && m.e !== 'enterprise') return null
    const license = typeof m.l === 'string' && m.l.length <= 64 ? m.l : ''
    return { id: m.id, peer: { edition: m.e, license } }
  } catch {
    return null
  }
}
