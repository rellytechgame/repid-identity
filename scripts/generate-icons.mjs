// Renders brand assets from the SVG master: app icon (electron-builder),
// renderer favicon and the GitHub social preview card.
// Usage: npm run icons
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mark = await readFile(resolve(root, 'assets/brand/repid-mark.svg'))

await mkdir(resolve(root, 'build'), { recursive: true })
await sharp(mark, { density: 1200 }).resize(1024, 1024).png().toFile(resolve(root, 'build/icon.png'))
await sharp(mark, { density: 600 }).resize(256, 256).png().toFile(resolve(root, 'src/renderer/public/icon.png'))

const markB64 = mark.toString('base64')
const social = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
  <defs>
    <radialGradient id="bg" cx="0.8" cy="0.1" r="1.1">
      <stop offset="0" stop-color="#1e1b4b"/><stop offset="0.6" stop-color="#0b0f19"/><stop offset="1" stop-color="#05070d"/>
    </radialGradient>
    <linearGradient id="t" x1="0" x2="1"><stop offset="0" stop-color="#22D3EE"/><stop offset="1" stop-color="#8B5CF6"/></linearGradient>
  </defs>
  <rect width="1280" height="640" fill="url(#bg)"/>
  <image href="data:image/svg+xml;base64,${markB64}" x="96" y="200" width="240" height="240"/>
  <text x="380" y="300" font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif" font-size="104" font-weight="800" fill="#fff">RePID <tspan fill="url(#t)" font-weight="300">Identity</tspan></text>
  <text x="384" y="370" font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif" font-size="30" fill="#94a3b8">Identify what every process does. End hogs from the root.</text>
  <text x="384" y="440" font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif" font-size="26" fill="#64748b">Windows · macOS · Linux  —  Open source (MIT)  —  by Voxel Enterprise</text>
</svg>`
await writeFile(resolve(root, 'assets/brand/social-preview.svg'), social)
await sharp(Buffer.from(social)).png().toFile(resolve(root, 'assets/brand/social-preview.png'))

console.log('Icons generated: build/icon.png, src/renderer/public/icon.png, assets/brand/social-preview.png')
