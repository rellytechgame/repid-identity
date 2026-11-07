/**
 * Windows services RePID may switch from Automatic to Manual. Manual is the
 * gentlest change: the service no longer starts with Windows, but anything
 * that needs it can still start it (Windows does so on demand). RePID never
 * disables or stops a service.
 */

export interface ServiceFacts {
  name: string
  displayName: string
  company: string
  path: string
}

export interface ServiceVerdict {
  catalogKey: string
  risk: 'safe' | 'caution'
  recommended: boolean
  thirdParty: boolean
}

/** Built-in services with a known, harmless effect when set to Manual (key → catalog text). */
const MICROSOFT: Record<string, { key: string; risk: 'safe' | 'caution'; recommended: boolean }> = {
  diagtrack: { key: 'telemetry', risk: 'safe', recommended: true },
  mapsbroker: { key: 'maps', risk: 'safe', recommended: true },
  retaildemo: { key: 'retailDemo', risk: 'safe', recommended: true },
  wmpnetworksvc: { key: 'mediaSharing', risk: 'safe', recommended: true },
  fax: { key: 'fax', risk: 'safe', recommended: true },
  trkwks: { key: 'linkTracking', risk: 'safe', recommended: true },
  wsearch: { key: 'search', risk: 'caution', recommended: false },
  sysmain: { key: 'sysmain', risk: 'caution', recommended: false },
  spooler: { key: 'printing', risk: 'caution', recommended: false }
}

/** Hardware, drivers and security: never offered (audio, touchpad, hotkeys, GPU or protection would break). */
const NEVER_VENDOR = /(nvidia|realtek|elan|synaptics|intel|advanced micro devices|\bamd\b|sound research|dolby|conexant|waves|qualcomm|broadcom|mediatek|logitech|razer|corsair|asus|msi|dell|lenovo|acer|bitdefender|kaspersky|eset|norton|mcafee|avast|avg|malwarebytes|sophos|trend micro|crowdstrike|sentinelone|vmware|oracle vm|virtualbox|docker|hyper-v|wsl)/i
const NEVER_NAME = /(audio|sound|touchpad|keyboard|hotkey|display\.container|graphics|bluetooth|wifi|wlan|ethernet|lan driver|thunderbolt|fingerprint|biometric|camera|firewall|antivirus|defender|vpn|backup)/i

const UPDATER = /(update|updater|actualiza)/i
const TELEMETRY = /(analytics|telemetry|insights|push service|crash ?(defender|report)|diagnostics hsa|app helper hsa|system info hsa|network hsa)/i
const REMOTE = /(anydesk|teamviewer|chromoting|remote desktop|escritorio remoto|rustdesk|splashtop|parsec|logmein)/i
const DATABASE = /(mariadb|mysql|postgres|mongodb|redis|sql server|sqlserver|mssql|elasticsearch|oracle)/i
const LICENSE = /(license|licencia|sentinel|hasp|flexnet|codemeter|arvato|psi_svc)/i

/**
 * Decides whether an auto-start service is shown and how. Returns null for
 * anything RePID must not touch (Windows internals not in the curated list,
 * drivers, hardware utilities, security software).
 */
export function classifyService(f: ServiceFacts): ServiceVerdict | null {
  const id = f.name.toLowerCase()
  const microsoft = /microsoft/i.test(f.company) || (!f.company && /\\windows\\system32\\svchost\.exe/i.test(f.path))
  if (microsoft) {
    const known = MICROSOFT[id]
    return known ? { catalogKey: known.key, risk: known.risk, recommended: known.recommended, thirdParty: false } : null
  }
  const text = `${f.name} ${f.displayName}`
  if (NEVER_VENDOR.test(f.company) || NEVER_VENDOR.test(text) || NEVER_NAME.test(text)) return null
  if (/windows\\system32\\drivers\\/i.test(f.path)) return null
  if (UPDATER.test(text) && !/windows update|wuauserv/i.test(text)) return { catalogKey: 'updater', risk: 'safe', recommended: true, thirdParty: true }
  if (TELEMETRY.test(text)) return { catalogKey: 'telemetryApp', risk: 'safe', recommended: true, thirdParty: true }
  if (REMOTE.test(text)) return { catalogKey: 'remote', risk: 'caution', recommended: false, thirdParty: true }
  if (DATABASE.test(text)) return { catalogKey: 'database', risk: 'caution', recommended: false, thirdParty: true }
  if (LICENSE.test(text)) return { catalogKey: 'license', risk: 'caution', recommended: false, thirdParty: true }
  return { catalogKey: 'thirdParty', risk: 'caution', recommended: false, thirdParty: true }
}

export const SERVICE_NAME = /^[A-Za-z0-9_.\- ]{1,128}$/
