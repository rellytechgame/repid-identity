import { createPublicKey, verify } from 'node:crypto'
import type { LicenseInfo } from '../../shared/types'
import { LICENSE_PUBLIC_KEY } from '../../shared/constants'
import { parseLicensePayload, splitLicenseKey } from '../../shared/engine/edition'

const publicKey = createPublicKey({ key: Buffer.from(LICENSE_PUBLIC_KEY, 'base64'), format: 'der', type: 'spki' })

/**
 * Returns the license only if its Ed25519 signature was made with the
 * maintainer's private key. Editing any field (company, seats, expiry)
 * invalidates the signature, so keys cannot be forged or stretched.
 */
export function verifyLicense(key: string, pub = publicKey): LicenseInfo | null {
  const parts = splitLicenseKey(key)
  if (!parts) return null
  try {
    const ok = verify(null, Buffer.from(parts.payload, 'utf8'), pub, Buffer.from(parts.signature, 'base64url'))
    if (!ok) return null
    return parseLicensePayload(Buffer.from(parts.payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}
