import type { RepidApi } from '@shared/types'
import { createDemoApi } from './demo'

declare global {
  interface Window {
    repid?: RepidApi
  }
}

/** Real engine inside Electron; simulated data in a plain browser (web demo). */
export const isDemo = !window.repid
export const api: RepidApi = window.repid ?? createDemoApi()
