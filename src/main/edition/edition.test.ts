import { generateKeyPairSync, sign } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { describe, expect, it } from 'vitest'
import { LAN_WINDOW_MS, editionState, parseBeacon, type LanPeer } from '../../shared/engine/edition'
import { latestFromRelease } from '../../shared/engine/version'
import { LanBeacon } from './lan'
import { verifyLicense } from './license'

const DAY = 864e5
const now = Date.UTC(2026, 10, 7)
const id = (n: number) => n.toString(16).padStart(32, '0')
const peers = (n: number, edition: 'free' | 'enterprise' = 'free', license = '', seen = now): Record<string, LanPeer> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [id(i + 100), { edition, license, seen }]))

function makeKey(payload: object, privateKey = generateKeyPairSync('ed25519').privateKey) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `REPID1-${encoded}.${sign(null, Buffer.from(encoded), privateKey).toString('base64url')}`
}

describe('free edition: copies per network', () => {
  const base = { edition: 'free' as const, selfId: id(1), license: null, corporateSignals: [], now }

  it('allows up to 5 free copies on one network and limits the 6th and beyond', () => {
    expect(editionState({ ...base, peers: peers(4) })).toMatchObject({ limited: false, lanInstalls: 5 })
    expect(editionState({ ...base, peers: peers(5) })).toMatchObject({ limited: true, reason: 'lan-limit', lanInstalls: 6 })
  })

  it('forgets copies not heard from in 14 days and ignores licensed Enterprise copies', () => {
    expect(editionState({ ...base, peers: peers(8, 'free', '', now - LAN_WINDOW_MS - DAY) }).limited).toBe(false)
    expect(editionState({ ...base, peers: { ...peers(3), ...Object.fromEntries(Object.entries(peers(9, 'enterprise', 'abc')).map(([k, v]) => [k + 'e', v])) } }).limited).toBe(false)
  })

  it('company computers only get a notice (B1)', () => {
    expect(editionState({ ...base, peers: {}, corporateSignals: ['domain'] })).toMatchObject({ limited: false, corporate: true })
  })
})

describe('enterprise edition: license', () => {
  const lic = { id: 'lic1', company: 'Acme', seats: 3, issuedAt: now - 10 * DAY, expiresAt: now + 300 * DAY }
  const base = { edition: 'enterprise' as const, selfId: id(1), corporateSignals: [], now, peers: {} }

  it('needs a license, then counts seats on the network', () => {
    expect(editionState({ ...base, license: null })).toMatchObject({ limited: true, reason: 'no-license' })
    expect(editionState({ ...base, license: lic, peers: peers(2, 'enterprise', 'lic1') })).toMatchObject({ limited: false, license: { seatsInUse: 3 } })
    expect(editionState({ ...base, license: lic, peers: peers(3, 'enterprise', 'lic1') })).toMatchObject({ limited: true, reason: 'seats-exceeded' })
    expect(editionState({ ...base, license: lic, peers: peers(9, 'enterprise', 'other') }).limited).toBe(false)
  })

  it('keeps working 14 days after expiry, then limits', () => {
    expect(editionState({ ...base, license: { ...lic, expiresAt: now - 3 * DAY } })).toMatchObject({ limited: false, reason: 'expired' })
    expect(editionState({ ...base, license: { ...lic, expiresAt: now - 20 * DAY } })).toMatchObject({ limited: true, reason: 'expired' })
  })
})

describe('license signatures', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const payload = { id: 'a1b2c3', company: 'Acme S.A.', seats: 10, issuedAt: now, expiresAt: now + 365 * DAY }

  it('accepts a key signed with the private key', () => {
    expect(verifyLicense(makeKey(payload, privateKey), publicKey)).toMatchObject({ company: 'Acme S.A.', seats: 10 })
    expect(verifyLicense(`  ${makeKey(payload, privateKey)}\n`, publicKey)).not.toBeNull()
  })

  it('rejects forged keys and any edited field', () => {
    expect(verifyLicense(makeKey(payload), publicKey)).toBeNull()
    const [head, sig] = makeKey(payload, privateKey).split('.')
    const stretched = Buffer.from(JSON.stringify({ ...payload, seats: 500 })).toString('base64url')
    expect(verifyLicense(`REPID1-${stretched}.${sig}`, publicKey)).toBeNull()
    expect(verifyLicense(`${head}.${sig.slice(0, -2)}AA`, publicKey)).toBeNull()
    expect(verifyLicense('nonsense', publicKey)).toBeNull()
  })

  it('the real embedded key rejects keys from any other private key', () => {
    expect(verifyLicense(makeKey(payload))).toBeNull()
  })
})

describe('network announcements', () => {
  it('parses only well-formed RePID messages', () => {
    expect(parseBeacon(JSON.stringify({ p: 'repid', v: 1, id: id(7), e: 'free', l: '' }))).toEqual({ id: id(7), peer: { edition: 'free', license: '' } })
    expect(parseBeacon(JSON.stringify({ p: 'repid', v: 1, id: 'short', e: 'free' }))).toBeNull()
    expect(parseBeacon(JSON.stringify({ p: 'other', v: 1, id: id(7), e: 'free' }))).toBeNull()
    expect(parseBeacon('not json')).toBeNull()
  })

  it('receives real UDP announcements from other copies', async () => {
    const seen: string[] = []
    const PORT = 48000 + Math.floor(Math.random() * 1000)
    const beacon = new LanBeacon(id(1), () => ({ edition: 'free', license: '' }), (peerId) => seen.push(peerId), PORT)
    beacon.start()
    await new Promise((r) => setTimeout(r, 300))
    const sender = createSocket({ type: 'udp4', reuseAddr: true })
    for (const n of [2, 3]) sender.send(Buffer.from(JSON.stringify({ p: 'repid', v: 1, id: id(n), e: 'free', l: '' })), PORT, '127.0.0.1')
    sender.send(Buffer.from(JSON.stringify({ p: 'repid', v: 1, id: id(1), e: 'free', l: '' })), PORT, '127.0.0.1')
    await new Promise((r) => setTimeout(r, 400))
    sender.close()
    beacon.stop()
    expect([...new Set(seen)].sort()).toEqual([id(2), id(3)])
  })
})

describe('update check per edition', () => {
  const release = { assets: [{ name: 'RePID-Identity-1.6.0-win-x64.exe' }, { name: 'RePID-Identity-Enterprise-1.5.0-win-x64.exe' }] }
  it('each edition follows its own installer', () => {
    expect(latestFromRelease(release)).toBe('1.6.0')
    expect(latestFromRelease(release, 'enterprise')).toBe('1.5.0')
  })
})
