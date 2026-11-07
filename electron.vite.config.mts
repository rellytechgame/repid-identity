import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// `REPID_EDITION=enterprise` builds RePID Enterprise (license required); anything else builds the free edition.
const EDITION = JSON.stringify(process.env.REPID_EDITION === 'enterprise' ? 'enterprise' : 'free')

export default defineConfig({
  main: { define: { __REPID_EDITION__: EDITION } },
  preload: {},
  renderer: {
    resolve: {
      alias: { '@shared': resolve(import.meta.dirname, 'src/shared') }
    },
    plugins: [react()]
  }
})
