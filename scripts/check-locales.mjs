// Verifies every locale has the same keys as the English reference and that
// every catalog entry has a description. Run with: npm run i18n:check
import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(root, 'src/renderer/src/locales')
const PLURAL = /_(zero|one|two|few|many|other)$/

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]))

// Plural suffixes legitimately differ per language (e.g. Arabic has six forms): compare base keys.
const baseKeys = (keys) => new Set(keys.map((k) => k.replace(PLURAL, '')))

const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
const locales = Object.fromEntries(
  await Promise.all(files.map(async (f) => [f.replace('.json', ''), JSON.parse(await readFile(resolve(dir, f), 'utf8'))]))
)

const reference = baseKeys(flatten(locales.en))
const catalogSrc = await readFile(resolve(root, 'src/shared/engine/catalog.ts'), 'utf8')
const catalogIds = [...catalogSrc.matchAll(/\{ id: '([\w-]+)'/g)].map((m) => m[1])

let failed = false
for (const id of catalogIds) {
  if (!reference.has(`catalog.${id}`)) {
    console.error(`✗ en: missing catalog.${id}`)
    failed = true
  }
}

for (const [code, data] of Object.entries(locales)) {
  if (!data._meta?.name) {
    console.error(`✗ ${code}: missing _meta.name`)
    failed = true
  }
  const keys = baseKeys(flatten(data))
  const missing = [...reference].filter((k) => !keys.has(k))
  const extra = [...keys].filter((k) => !reference.has(k))
  if (missing.length) console.warn(`⚠ ${code}: ${missing.length} missing (falls back to English):\n   ${missing.join('\n   ')}`)
  if (extra.length) console.warn(`⚠ ${code}: ${extra.length} unknown keys:\n   ${extra.join('\n   ')}`)
  if (!missing.length && !extra.length) console.log(`✓ ${code} (${data._meta?.name}) complete`)
}

process.exit(failed ? 1 : 0)
