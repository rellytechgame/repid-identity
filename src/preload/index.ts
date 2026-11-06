import { contextBridge, ipcRenderer } from 'electron'
import type { RepidApi } from '../shared/types'

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
  uninstallClean: (request) => ipcRenderer.invoke('repid:uninstall-clean', request),
  uninstallOpenBackups: () => ipcRenderer.invoke('repid:uninstall-open-backups'),
  openRepo: (path = '') => ipcRenderer.invoke('repid:open-repo', path),
  openDonate: () => ipcRenderer.invoke('repid:open-donate'),
  relaunchElevated: () => ipcRenderer.invoke('repid:relaunch-elevated'),
  setTitleBarTheme: (theme) => ipcRenderer.invoke('repid:titlebar-theme', theme)
}

contextBridge.exposeInMainWorld('repid', api)
