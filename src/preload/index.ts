import { contextBridge, ipcRenderer } from 'electron'
import type { RepidApi, TaskProgress } from '../shared/types'

// Exposes a narrow, typed API. The renderer never gets ipcRenderer itself.
const api: RepidApi = {
  platform: process.platform as RepidApi['platform'],
  version: process.argv.find((a) => a.startsWith('--repid-version='))?.split('=')[1] ?? '0.0.0',
  snapshot: () => ipcRenderer.invoke('repid:snapshot'),
  details: (pid) => ipcRenderer.invoke('repid:details', pid),
  kill: (request) => ipcRenderer.invoke('repid:kill', request),
  stopService: (pid) => ipcRenderer.invoke('repid:stop-service', pid),
  setSettings: (settings) => ipcRenderer.invoke('repid:settings', settings),
  cleanerScan: () => ipcRenderer.invoke('repid:cleaner-scan'),
  cleanerClean: (request) => ipcRenderer.invoke('repid:cleaner-clean', request),
  startupScan: () => ipcRenderer.invoke('repid:startup-scan'),
  startupSet: (request) => ipcRenderer.invoke('repid:startup-set', request),
  startupRestore: () => ipcRenderer.invoke('repid:startup-restore'),
  boostStatus: () => ipcRenderer.invoke('repid:boost-status'),
  boostApply: (request) => ipcRenderer.invoke('repid:boost-apply', request),
  boostStop: () => ipcRenderer.invoke('repid:boost-stop'),
  uninstallList: () => ipcRenderer.invoke('repid:uninstall-list'),
  uninstallRun: (request) => ipcRenderer.invoke('repid:uninstall-run', request),
  uninstallForceScan: (id) => ipcRenderer.invoke('repid:uninstall-force-scan', id),
  uninstallScanOrphans: () => ipcRenderer.invoke('repid:uninstall-orphans'),
  uninstallClean: (request) => ipcRenderer.invoke('repid:uninstall-clean', request),
  uninstallOpenBackups: () => ipcRenderer.invoke('repid:uninstall-open-backups'),
  diskRoots: () => ipcRenderer.invoke('repid:disk-roots'),
  diskScan: (rootId) => ipcRenderer.invoke('repid:disk-scan', rootId),
  diskDuplicates: () => ipcRenderer.invoke('repid:disk-duplicates'),
  diskCancel: () => ipcRenderer.invoke('repid:disk-cancel'),
  diskDelete: (request) => ipcRenderer.invoke('repid:disk-delete', request),
  diskReveal: (id) => ipcRenderer.invoke('repid:disk-reveal', id),
  onProgress: (listener) => {
    const handler = (_e: unknown, progress: TaskProgress) => listener(progress)
    ipcRenderer.on('repid:progress', handler)
    return () => ipcRenderer.removeListener('repid:progress', handler)
  },
  onNavigate: (listener) => {
    const handler = (_e: unknown, view: string) => listener(view)
    ipcRenderer.on('repid:navigate', handler)
    return () => ipcRenderer.removeListener('repid:navigate', handler)
  },
  automationGet: () => ipcRenderer.invoke('repid:automation-get'),
  automationSet: (config) => ipcRenderer.invoke('repid:automation-set', config),
  updatesScan: () => ipcRenderer.invoke('repid:updates-scan'),
  updatesApply: (ids) => ipcRenderer.invoke('repid:updates-apply', ids),
  healthScan: () => ipcRenderer.invoke('repid:health-scan'),
  restorePoint: (reason) => ipcRenderer.invoke('repid:restore-point', reason),
  networkScan: () => ipcRenderer.invoke('repid:network-scan'),
  networkBlock: (request) => ipcRenderer.invoke('repid:network-block', request),
  servicesScan: () => ipcRenderer.invoke('repid:services-scan'),
  servicesSet: (request) => ipcRenderer.invoke('repid:services-set', request),
  openRepo: (path = '') => ipcRenderer.invoke('repid:open-repo', path),
  openDonate: () => ipcRenderer.invoke('repid:open-donate'),
  relaunchElevated: () => ipcRenderer.invoke('repid:relaunch-elevated'),
  setTitleBarTheme: (theme) => ipcRenderer.invoke('repid:titlebar-theme', theme)
}

contextBridge.exposeInMainWorld('repid', api)
