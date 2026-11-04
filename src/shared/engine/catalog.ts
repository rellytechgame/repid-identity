import type { Category } from '../types'

/**
 * Known applications and OS components. Every `id` needs a description under
 * `catalog.<id>` in each locale file (scripts/check-locales.mjs enforces it).
 * `names` are compared against the normalized process name (lowercase, no .exe);
 * `prefixes` catch helper variants such as "Google Chrome Helper (Renderer)".
 */
export interface CatalogEntry {
  id: string
  category: Category
  product: string
  names?: string[]
  prefixes?: string[]
}

export const CATALOG: CatalogEntry[] = [
  // Browsers
  { id: 'chrome', category: 'browser', product: 'Google Chrome', names: ['chrome'], prefixes: ['google chrome'] },
  { id: 'edge', category: 'browser', product: 'Microsoft Edge', names: ['msedge'], prefixes: ['microsoft edge'] },
  { id: 'webview2', category: 'runtime', product: 'Microsoft Edge WebView2', names: ['msedgewebview2'] },
  { id: 'firefox', category: 'browser', product: 'Mozilla Firefox', names: ['firefox', 'firefox-bin', 'firefox-esr'] },
  { id: 'brave', category: 'browser', product: 'Brave', names: ['brave'], prefixes: ['brave browser'] },
  { id: 'opera', category: 'browser', product: 'Opera', names: ['opera', 'opera_gx'] },
  { id: 'safari', category: 'browser', product: 'Safari', names: ['safari'], prefixes: ['com.apple.webkit'] },
  { id: 'vivaldi', category: 'browser', product: 'Vivaldi', names: ['vivaldi', 'vivaldi-bin'] },
  // Development
  { id: 'vscode', category: 'development', product: 'Visual Studio Code', names: ['code', 'code - insiders', 'code-oss'], prefixes: ['code helper'] },
  { id: 'cursor', category: 'development', product: 'Cursor', names: ['cursor'], prefixes: ['cursor helper'] },
  { id: 'visualstudio', category: 'development', product: 'Visual Studio', names: ['devenv', 'servicehub.host.netfx.x86', 'msbuild'] },
  { id: 'jetbrains', category: 'development', product: 'JetBrains IDE', names: ['idea64', 'idea', 'pycharm64', 'pycharm', 'webstorm64', 'webstorm', 'rider64', 'goland64', 'clion64', 'phpstorm64', 'studio64'] },
  { id: 'docker', category: 'virtualization', product: 'Docker', names: ['docker desktop', 'com.docker.backend', 'com.docker.build', 'dockerd', 'containerd', 'com.docker.vmnetd'] },
  { id: 'vmmem', category: 'virtualization', product: 'WSL / Hyper-V', names: ['vmmem', 'vmmemwsl'] },
  { id: 'wsl', category: 'virtualization', product: 'Windows Subsystem for Linux', names: ['wsl', 'wslhost', 'wslservice', 'wslrelay'] },
  { id: 'git', category: 'development', product: 'Git', names: ['git', 'git-remote-https'] },
  { id: 'database', category: 'development', product: 'Database server', names: ['postgres', 'mysqld', 'mongod', 'redis-server', 'mariadbd', 'sqlservr'] },
  { id: 'ollama', category: 'development', product: 'Ollama', names: ['ollama', 'ollama_llama_server', 'ollama app'] },
  // Runtimes (script detection happens in the classifier)
  { id: 'node', category: 'runtime', product: 'Node.js', names: ['node', 'nodejs', 'bun', 'deno'] },
  { id: 'python', category: 'runtime', product: 'Python', names: ['python', 'python3', 'pythonw', 'py'] },
  { id: 'java', category: 'runtime', product: 'Java', names: ['java', 'javaw'] },
  { id: 'dotnet', category: 'runtime', product: '.NET', names: ['dotnet'] },
  // Communication
  { id: 'slack', category: 'communication', product: 'Slack', names: ['slack'], prefixes: ['slack helper'] },
  { id: 'discord', category: 'communication', product: 'Discord', names: ['discord', 'discordptb', 'discordcanary'], prefixes: ['discord helper'] },
  { id: 'teams', category: 'communication', product: 'Microsoft Teams', names: ['teams', 'ms-teams', 'msteams'], prefixes: ['microsoft teams'] },
  { id: 'zoom', category: 'communication', product: 'Zoom', names: ['zoom', 'zoom.us', 'cpthost', 'zoomwebviewhost'] },
  { id: 'whatsapp', category: 'communication', product: 'WhatsApp', names: ['whatsapp', 'whatsapp.root'] },
  { id: 'telegram', category: 'communication', product: 'Telegram', names: ['telegram'] },
  { id: 'outlook', category: 'communication', product: 'Microsoft Outlook', names: ['outlook', 'olk', 'microsoft outlook'] },
  // Media & gaming
  { id: 'spotify', category: 'media', product: 'Spotify', names: ['spotify'], prefixes: ['spotify helper'] },
  { id: 'vlc', category: 'media', product: 'VLC', names: ['vlc'] },
  { id: 'obs', category: 'media', product: 'OBS Studio', names: ['obs64', 'obs', 'obs-ffmpeg-mux'] },
  { id: 'steam', category: 'gaming', product: 'Steam', names: ['steam', 'steamwebhelper', 'steamservice', 'steam_osx'] },
  { id: 'epic', category: 'gaming', product: 'Epic Games Launcher', names: ['epicgameslauncher', 'epicwebhelper'] },
  { id: 'battlenet', category: 'gaming', product: 'Battle.net', names: ['battle.net', 'blizzard battle.net'] },
  { id: 'riot', category: 'gaming', product: 'Riot Client', names: ['riotclientservices', 'riotclientux', 'riotclientuxrender', 'vgc', 'vgtray'] },
  // Graphics & creative
  { id: 'nvidia', category: 'graphics', product: 'NVIDIA', names: ['nvcontainer', 'nvidia share', 'nvdisplay.container', 'nvidia web helper', 'nvidia app', 'nvsphelper64'] },
  { id: 'amd', category: 'graphics', product: 'AMD Software', names: ['radeonsoftware', 'amdrsserv', 'atieclxx', 'amdow'] },
  { id: 'adobecc', category: 'graphics', product: 'Adobe Creative Cloud', names: ['creative cloud', 'adobeipcbroker', 'ccxprocess', 'cclibrary', 'coresync', 'adobe desktop service', 'adobeupdateservice'] },
  { id: 'photoshop', category: 'graphics', product: 'Adobe Photoshop', names: ['photoshop', 'adobe photoshop'] },
  { id: 'blender', category: 'graphics', product: 'Blender', names: ['blender'] },
  { id: 'figma', category: 'graphics', product: 'Figma', names: ['figma', 'figma_agent', 'figma agent'], prefixes: ['figma helper'] },
  // Office & productivity
  { id: 'word', category: 'office', product: 'Microsoft Word', names: ['winword', 'microsoft word'] },
  { id: 'excel', category: 'office', product: 'Microsoft Excel', names: ['excel', 'microsoft excel'] },
  { id: 'powerpoint', category: 'office', product: 'Microsoft PowerPoint', names: ['powerpnt', 'microsoft powerpoint'] },
  { id: 'libreoffice', category: 'office', product: 'LibreOffice', names: ['soffice', 'soffice.bin'] },
  { id: 'notion', category: 'office', product: 'Notion', names: ['notion'], prefixes: ['notion helper'] },
  // Cloud sync
  { id: 'onedrive', category: 'cloud', product: 'Microsoft OneDrive', names: ['onedrive', 'filecoauth'] },
  { id: 'dropbox', category: 'cloud', product: 'Dropbox', names: ['dropbox'] },
  { id: 'gdrive', category: 'cloud', product: 'Google Drive', names: ['googledrivefs', 'google drive'] },
  { id: 'icloud', category: 'cloud', product: 'iCloud', names: ['bird', 'cloudd', 'icloud', 'icloudservices', 'icloudckks'] },
  // Operating system components
  { id: 'svchost', category: 'system', product: 'Service Host', names: ['svchost'] },
  { id: 'explorer', category: 'system', product: 'Windows Explorer', names: ['explorer'] },
  { id: 'dwm', category: 'system', product: 'Desktop Window Manager', names: ['dwm'] },
  { id: 'searchindexer', category: 'system', product: 'Search indexer', names: ['searchindexer', 'searchprotocolhost', 'searchfilterhost', 'searchhost', 'mds_stores', 'mdworker', 'mdworker_shared', 'tracker-miner-fs', 'tracker-miner-fs-3', 'baloo_file'] },
  { id: 'defender', category: 'security', product: 'Microsoft Defender', names: ['msmpeng', 'nissrv', 'mpdefendercoreservice', 'securityhealthservice', 'mssense'] },
  { id: 'wmiprvse', category: 'system', product: 'WMI Provider Host', names: ['wmiprvse'] },
  { id: 'tiworker', category: 'updater', product: 'Windows Update', names: ['tiworker', 'trustedinstaller', 'wuauclt', 'usoclient', 'mousocoreworker', 'musnotification'] },
  { id: 'runtimebroker', category: 'system', product: 'Runtime Broker', names: ['runtimebroker'] },
  { id: 'antimalwarehost', category: 'security', product: 'Security software', names: ['avp', 'avgsvc', 'avastsvc', 'mbamservice', 'bdservicehost', 'ekrn', 'mcshield'] },
  { id: 'kernel', category: 'system', product: 'OS kernel', names: ['system', 'kernel_task', 'kthreadd', 'registry', 'memory compression', 'secure system'] },
  { id: 'windowserver', category: 'system', product: 'WindowServer', names: ['windowserver'] },
  { id: 'launchd', category: 'system', product: 'launchd', names: ['launchd'] },
  { id: 'systemd', category: 'system', product: 'systemd', names: ['systemd', 'init'] },
  { id: 'displayserver', category: 'system', product: 'Display server', names: ['xorg', 'xwayland', 'gnome-shell', 'kwin_x11', 'kwin_wayland', 'plasmashell', 'mutter'] },
  { id: 'audio', category: 'system', product: 'Audio stack', names: ['audiodg', 'coreaudiod', 'pipewire', 'pipewire-pulse', 'pulseaudio', 'wireplumber'] },
  { id: 'repid', category: 'system', product: 'RePID Identity', names: ['repid identity', 'repid-identity'] }
]

const byName = new Map<string, CatalogEntry>()
for (const entry of CATALOG) for (const n of entry.names ?? []) byName.set(n, entry)

export function lookupCatalog(normalizedName: string): CatalogEntry | undefined {
  const exact = byName.get(normalizedName)
  if (exact) return exact
  return CATALOG.find((e) => e.prefixes?.some((p) => normalizedName.startsWith(p)))
}
