// Builds RePID Enterprise installers: same app, compiled with REPID_EDITION=enterprise and
// named RePID-Identity-Enterprise-<version>-… so they never get mixed up with the free ones.
//
//   npm run dist:enterprise -- --win      (or --mac, --linux)
import { spawnSync } from 'node:child_process'

const platformArgs = process.argv.slice(2)
const env = { ...process.env, REPID_EDITION: 'enterprise' }
const run = (cmd, args) => {
  const res = spawnSync(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' })
  if (res.status !== 0) process.exit(res.status ?? 1)
}

run('npx', ['electron-vite', 'build'])
run('npx', [
  'electron-builder',
  ...platformArgs,
  '-c.win.artifactName=RePID-Identity-Enterprise-${version}-${os}-${arch}.${ext}',
  '-c.mac.artifactName=RePID-Identity-Enterprise-${version}-mac-${arch}.${ext}',
  '-c.linux.artifactName=RePID-Identity-Enterprise-${version}-linux-${arch}.${ext}'
])
