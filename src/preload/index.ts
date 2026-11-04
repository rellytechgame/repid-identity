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
  openRepo: (path = '') => ipcRenderer.invoke('repid:open-repo', path),
  openDonate: () => ipcRenderer.invoke('repid:open-donate'),
  relaunchElevated: () => ipcRenderer.invoke('repid:relaunch-elevated'),
  setTitleBarTheme: (theme) => ipcRenderer.invoke('repid:titlebar-theme', theme)
}

contextBridge.exposeInMainWorld('repid', api)
