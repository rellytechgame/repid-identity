import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

/**
 * Languages are discovered from ./locales/*.json at build time: adding a
 * language is dropping a new file there (see docs/ADDING_A_LANGUAGE.md).
 */
interface LocaleFile {
  _meta: { name: string; dir?: 'ltr' | 'rtl' }
  [key: string]: unknown
}

const modules = import.meta.glob<LocaleFile>('./locales/*.json', { eager: true, import: 'default' })

export interface Language {
  code: string
  name: string
  dir: 'ltr' | 'rtl'
}

export const LANGUAGES: Language[] = Object.entries(modules)
  .map(([path, data]) => ({
    code: path.match(/([\w-]+)\.json$/)![1],
    name: data._meta.name,
    dir: data._meta.dir ?? 'ltr'
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

/** Primary language of the project; used when the system language is not available. */
export const DEFAULT_LANGUAGE = 'es'

export function resolveLanguage(preferred?: string): string {
  const codes = LANGUAGES.map((l) => l.code)
  const candidates = [preferred, ...navigator.languages].filter(Boolean) as string[]
  for (const c of candidates) {
    if (codes.includes(c)) return c
    const base = c.split('-')[0]
    if (codes.includes(base)) return base
  }
  return DEFAULT_LANGUAGE
}

export function applyDocumentLanguage(code: string): void {
  document.documentElement.lang = code
  document.documentElement.dir = LANGUAGES.find((l) => l.code === code)?.dir ?? 'ltr'
}

void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(
    Object.entries(modules).map(([path, data]) => [path.match(/([\w-]+)\.json$/)![1], { translation: data }])
  ),
  lng: DEFAULT_LANGUAGE,
  // English is the reference file every key exists in; partial translations fall back to it.
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export default i18n
