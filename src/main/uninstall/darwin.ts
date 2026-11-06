import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MIN_TOP_LEVEL, classifyApp, normalize, productKeys } from '../../shared/engine/uninstall'
import { run } from '../engine/exec'
import { sizeOf } from './fsutil'
import type { AppRecord, LeftoverRecord, PlatformUninstaller } from './types'

/**
 * macOS: an app is its `.app` bundle. Uninstalling moves the bundle to the
 * Trash (done by the manager); leftovers are the entries under ~/Library that
 * carry the bundle id (`com.vendor.app`, `com.vendor.app.plist`,
 * `<team>.com.vendor.app`) or, with lower confidence, the app's exact name.
 */
const LIBRARY_DIRS = ['Application Support', 'Caches', 'Preferences', 'Logs', 'Saved Application State', 'Containers', 'Group Containers', 'HTTPStorages', 'WebKit', 'Cookies', 'LaunchAgents', 'Application Scripts']

interface InfoPlist {
  CFBundleIdentifier?: string
  CFBundleName?: string
  CFBundleDisplayName?: string
  CFBundleShortVersionString?: string
}

/** Does a ~/Library entry belong to this bundle id? */
export function matchesBundle(entry: string, bundleId: string): boolean {
  const e = entry.toLowerCase()
  const b = bundleId.toLowerCase()
  return e === b || e.startsWith(b + '.') || e.endsWith('.' + b) || e === `${b}.plist` || e === `${b}.savedstate`
}

let seq = 0
const nextId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`

export const darwinUninstaller: PlatformUninstaller = {
  async inventory() {
    const records: AppRecord[] = []
    for (const [dir, scope] of [['/Applications', 'machine'], [join(homedir(), 'Applications'), 'user']] as const) {
      const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.app'))
      for (const n of names) {
        const path = join(dir, n)
        const res = await run('plutil', ['-convert', 'json', '-o', '-', join(path, 'Contents', 'Info.plist')], { timeoutMs: 5000 })
        let info: InfoPlist = {}
        try {
          info = JSON.parse(res.stdout || '{}') as InfoPlist
        } catch {
          // unreadable plist: keep the bundle name
        }
        const name = info.CFBundleDisplayName || info.CFBundleName || n.replace(/\.app$/, '')
        const bundleId = info.CFBundleIdentifier ?? ''
        const { kind, risk } = classifyApp(name)
        records.push({
          app: {
            id: `mac:${path}`,
            name,
            version: info.CFBundleShortVersionString,
            installLocation: path,
            source: 'mac-app',
            scope,
            kind,
            // Apple's own apps are part of the system experience; RePID itself is never removed.
            risk: /^com\.apple\./.test(bundleId) || /repid/i.test(bundleId) ? 'critical' : risk,
            hasQuiet: true,
            uninstallerMissing: false,
            requiresAdmin: false,
            runningPids: []
          },
          products: productKeys({ name }),
          vendors: [],
          data: { bundleId, path }
        })
      }
    }
    return records
  },

  // The bundle itself is moved to the Trash by the manager (shared trash path); nothing to run here.
  async run() {
    return { status: 'done' }
  },

  async leftovers(record, others) {
    const out: LeftoverRecord[] = []
    const bundleId = record.data.bundleId
    const claimed = new Set(others.flatMap((o) => o.products.primary))
    const want = new Set(record.products.primary.filter((p) => p.length >= MIN_TOP_LEVEL && !claimed.has(p)))
    const library = join(homedir(), 'Library')
    for (const sub of LIBRARY_DIRS) {
      const dir = join(library, sub)
      for (const entry of await readdir(dir).catch(() => [] as string[])) {
        const byBundle = !!bundleId && matchesBundle(entry, bundleId)
        const byName = !byBundle && want.has(normalize(entry.replace(/\.(plist|savedState)$/i, '')))
        if (!byBundle && !byName) continue
        const path = join(dir, entry)
        out.push({ id: nextId(), kind: 'folder', location: path, sizeBytes: await sizeOf(path), confidence: byBundle ? 'high' : 'medium', reason: byBundle ? 'bundle-id' : 'name-match', target: { type: 'path', path } })
      }
    }
    return out
  }
}
