import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Builds the renderer as a standalone website (demo mode).
 * Browsers cannot inspect or terminate OS processes, so without the Electron
 * preload bridge the UI falls back to simulated data (see renderer/src/api.ts).
 * Output (dist-web/) can be deployed to Vercel as the public web demo (see vercel.json).
 */
export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  base: './',
  resolve: {
    alias: { '@shared': resolve(import.meta.dirname, 'src/shared') }
  },
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist-web'),
    emptyOutDir: true
  }
})
