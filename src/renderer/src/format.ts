import type { TFunction } from 'i18next'
import type { Identity } from '@shared/types'

export function formatBytes(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  const digits = value >= 100 || i === 0 ? 0 : 1
  return `${value.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${units[i]}`
}

export function formatPercent(value: number, locale: string): string {
  return `${value.toLocaleString(locale, { maximumFractionDigits: value < 10 ? 1 : 0 })}%`
}

/** Human explanation of a process: catalog description followed by the heuristic detail. */
export function describeIdentity(identity: Identity, t: TFunction): string {
  const parts: string[] = []
  if (identity.catalogId) parts.push(t(`catalog.${identity.catalogId}`))
  if (identity.heuristic) parts.push(t(`heuristics.${identity.heuristic.key}`, identity.heuristic.params ?? {}))
  if (identity.publisher) parts.push(t('heuristics.publisher', { company: identity.publisher }))
  return parts.join(' ')
}

/** Stable hue per app name for avatar tiles. */
export function hueOf(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}
