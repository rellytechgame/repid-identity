// Issues a signed RePID Enterprise license key. Maintainer only: needs the private key,
// which lives OUTSIDE this repository (default: ~/.repid-license/private-key.pem).
//
//   npm run license -- --company "Acme S.A." --email it@acme.com --seats 10 --months 12
//   npm run license -- --verify "REPID1-…"     (checks the key pasted in a support email)
//
// The key is printed: send it to the buyer, who pastes it in RePID Enterprise → About.
import { createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
  options: {
    company: { type: 'string' },
    email: { type: 'string', default: '' },
    seats: { type: 'string', default: '1' },
    months: { type: 'string', default: '12' },
    verify: { type: 'string' },
    key: { type: 'string', default: join(homedir(), '.repid-license', 'private-key.pem') }
  }
})

if (values.verify) {
  // Needs only the public key embedded in the app: support can run it on any machine.
  const src = readFileSync(join(repo, 'src/shared/constants.ts'), 'utf8')
  const pub = createPublicKey({ key: Buffer.from(src.match(/LICENSE_PUBLIC_KEY = '([^']+)'/)[1], 'base64'), format: 'der', type: 'spki' })
  const m = values.verify.replace(/\s+/g, '').match(/^REPID1-([\w-]+)\.([\w-]+)$/)
  if (!m || !verify(null, Buffer.from(m[1]), pub, Buffer.from(m[2], 'base64url'))) {
    console.error('\n✗ NOT a genuine RePID Enterprise license (forged or altered).\n')
    process.exit(2)
  }
  const p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'))
  const expired = p.expiresAt < Date.now()
  console.log(`\n✓ Genuine license${expired ? ' — EXPIRED' : ''}`)
  console.log(`  Company: ${p.company}${p.email ? ` <${p.email}>` : ''}`)
  console.log(`  Computers: ${p.seats} · Expires: ${new Date(p.expiresAt).toISOString().slice(0, 10)}`)
  console.log(`  Support code (must match the email subject): RPE-${p.id.toUpperCase()}-${m[2].slice(0, 8)}\n`)
  process.exit(expired ? 3 : 0)
}

const company = (values.company ?? '').trim()
const seats = Number.parseInt(values.seats, 10)
const months = Number.parseInt(values.months, 10)
if (!company || company.length > 120 || !Number.isSafeInteger(seats) || seats < 1 || !Number.isSafeInteger(months) || months < 1 || months > 60) {
  console.error('Usage: npm run license -- --company "Name" [--email x@y.com] [--seats N] [--months 12]')
  process.exit(1)
}
const keyPath = resolve(values.key)
const insideRepo = (rel) => rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
if (insideRepo(relative(repo, keyPath))) {
  console.error('Refusing to use a private key stored inside the repository.')
  process.exit(1)
}

const privateKey = createPrivateKey(readFileSync(keyPath))
const constants = readFileSync(join(repo, 'src/shared/constants.ts'), 'utf8')
const embedded = constants.match(/LICENSE_PUBLIC_KEY = '([^']+)'/)?.[1]
if (createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64') !== embedded) {
  console.error('This private key does not match LICENSE_PUBLIC_KEY in src/shared/constants.ts.')
  process.exit(1)
}

const issuedAt = Date.now()
const expires = new Date(issuedAt)
expires.setMonth(expires.getMonth() + months)
const payload = { id: randomBytes(6).toString('hex'), company, email: values.email || undefined, seats, issuedAt, expiresAt: expires.getTime() }
const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
const signature = sign(null, Buffer.from(encoded, 'utf8'), privateKey).toString('base64url')

console.log(`\nRePID Enterprise license for ${company} — ${seats} computer(s), valid until ${expires.toISOString().slice(0, 10)} (id ${payload.id})\n`)
console.log(`REPID1-${encoded}.${signature}\n`)
