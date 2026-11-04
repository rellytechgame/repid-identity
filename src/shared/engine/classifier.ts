import type { Identity, ServiceRef } from '../types'
import { lookupCatalog } from './catalog'
import { normalizeName } from './protection'

interface ClassifyInput {
  name: string
  path: string
  command: string
  services?: ServiceRef[]
}

const RUNTIME_IDS = new Set(['node', 'python', 'java', 'dotnet'])

/**
 * Key used to cluster a process with same-named ancestors. Interpreters are
 * keyed by the script they run: `node vite` started from `node npm` is a
 * different program, not another instance of its parent.
 */
export function clusterKey(name: string, command: string): string {
  const n = normalizeName(name)
  const entry = lookupCatalog(n)
  return entry && RUNTIME_IDS.has(entry.id) ? `${n}|${extractScript(command) ?? ''}` : n
}

/**
 * For interpreters the binary says little ("node", "python"); the script they
 * run is what the user recognises. Returns the most meaningful argument.
 */
export function extractScript(command: string): string | undefined {
  const tokens = command.match(/"[^"]+"|'[^']+'|\S+/g)?.map((t) => t.replace(/^["']|["']$/g, '')) ?? []
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '-m' || t === '-jar') return tokens[i + 1] ? basename(tokens[i + 1]) : undefined
    if (t.startsWith('-')) continue
    // Prefer the innermost package name for node_modules entry points: .../node_modules/vite/bin/vite.js → vite
    const resolved = t.split(/[\\/]/).reduce<string[]>((acc, seg) => (seg === '..' ? acc.slice(0, -1) : seg === '.' ? acc : [...acc, seg]), []).join('/')
    const pkgs = [...resolved.matchAll(/node_modules[\\/](@[^\\/]+[\\/][^\\/]+|[^\\/]+)/g)].map((m) => m[1]).filter((p) => !p.startsWith('.'))
    return pkgs.length ? pkgs[pkgs.length - 1].replace(/\\/g, '/') : basename(t)
  }
  return undefined
}

export function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

/** Folders that say nothing about the product (version dirs, bin, vendor umbrellas). */
const GENERIC_DIR = /^(bin|app|application|resources|current|lib|x64|x86|program|common files|temp|app-[\d.]+|v?\d[\d.]*)$/i
const VENDOR_DIR = /^(microsoft|google|nvidia corporation|amd|adobe|intel|jetbrains|mozilla|apple|programs)$/i

/** Infers a product name from well-known install locations. */
export function productFromPath(path: string): string | undefined {
  const mac = path.match(/\/([^/]+)\.app\//)
  if (mac) return mac[1]
  // MSIX/Store apps: ...\WindowsApps\<Publisher>.<Name>_<version>_<arch>__<hash>\...
  const msix = path.match(/\\WindowsApps\\[^\\]*?\.([^\\._]+)_/i)
  if (msix) return msix[1]
  const win = path.match(/\\(?:Program Files(?: \(x86\))?|AppData\\Local|AppData\\Roaming)\\(.+)$/i)
  if (win) {
    // [Vendor, Product, ..., file.exe] → prefer the product folder under a vendor umbrella.
    const dirs = win[1].split('\\').slice(0, -1).filter((d) => !GENERIC_DIR.test(d))
    const product = dirs.find((d) => !VENDOR_DIR.test(d))
    if (product && !/^windowsapps$/i.test(product)) return product
  }
  const opt = path.match(/^\/opt\/([^/]+)/)
  if (opt) return opt[1]
  return undefined
}

function isSystemPath(path: string): boolean {
  return (
    /^[a-z]:\\windows\\/i.test(path) ||
    /^\/(System|usr\/libexec|usr\/sbin|sbin|lib\/systemd|usr\/lib\/systemd)\//.test(path)
  )
}

/**
 * Explains what a process is and does, from strongest to weakest evidence:
 * known catalog entry → script run by an interpreter → hosted OS service →
 * Chromium/Electron child role → updater/helper naming → install location.
 */
export function classify(input: ClassifyInput): Identity {
  const n = normalizeName(input.name)
  const entry = lookupCatalog(n)
  const script = extractScript(input.command)

  if (entry && RUNTIME_IDS.has(entry.id) && script) {
    return {
      category: 'runtime',
      catalogId: entry.id,
      product: entry.product,
      heuristic: { key: 'runtimeScript', params: { runtime: entry.product, script } }
    }
  }

  if (entry) {
    const role = input.command.match(/--type=([a-z-]+)/)?.[1]
    return {
      category: entry.category,
      catalogId: entry.id,
      product: entry.product,
      heuristic: role ? { key: 'chromiumRole', params: { role, product: entry.product } } : undefined
    }
  }

  if (input.services?.length) {
    return {
      category: 'service',
      heuristic: { key: 'serviceHost', params: { service: input.services.map((s) => s.name).join(', ') } }
    }
  }

  const product = productFromPath(input.path)
  const role = input.command.match(/--type=([a-z-]+)/)?.[1]
  if (role) {
    return { category: 'background', product, heuristic: { key: 'chromiumRole', params: { role, product: product ?? input.name } } }
  }
  if (/update|updater|upgrade/.test(n)) {
    return { category: 'updater', product, heuristic: { key: 'updater', params: { product: product ?? input.name } } }
  }
  if (/helper|crashpad|crash_?handler|agent|tray|daemon|broker/.test(n)) {
    return { category: 'background', product, heuristic: { key: 'helper', params: { product: product ?? input.name } } }
  }
  if (isSystemPath(input.path)) {
    return { category: 'system', heuristic: { key: 'systemComponent', params: { dir: dirname(input.path) } } }
  }
  if (product) {
    return { category: 'application', product, heuristic: { key: 'appFromPath', params: { product } } }
  }
  return { category: 'unknown', heuristic: { key: 'unknown' } }
}

function dirname(p: string): string {
  const parts = p.split(/[\\/]/)
  parts.pop()
  return parts.join(p.includes('\\') ? '\\' : '/') || p
}
