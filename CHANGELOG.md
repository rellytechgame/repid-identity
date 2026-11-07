# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.6.0] — 2026-11-07

### Added
- **Per-app disk activity**: real read/write rate (bytes per second) for each application, so you can finally see *which* app is pushing the disk to 100%. New sortable **Disk** column in Processes, read/write in the detail panel, and a one-click "busiest disk app" insight on the dashboard that opens that app. Read-only; no admin required.
- Source is language-independent: Windows uses `Win32_PerfFormattedData_PerfProc_Process` (property names are not localized), Linux reads `/proc/<pid>/io` differenced between samples; macOS shows no data (same as per-process GPU).

## [1.5.0] — 2026-11-06

### Added
- **Disk analyzer**: clickable treemap of your home folder or any drive, the biggest files (with a "not touched for a year" filter) and duplicates confirmed by SHA-256 content hash. Deletions go to the Recycle Bin, always keep one copy per duplicate set and are refused if the file changed since the scan.
- **Automatic mode**: performance mode turns on by itself for games (Steam, Epic, GOG, Xbox, EA, Ubisoft, Riot, Battle.net libraries) and apps you choose, and off when they close; daily/weekly cleanup of safe items only; system notifications for apps whose memory keeps growing and for nearly full drives; optional tray icon and start minimized at sign-in.
- **App updates** through winget, Homebrew or Flatpak, with major-version jumps flagged and never pre-selected.
- **Health**: drive status (wear, temperature, errors and hours when elevated), battery capacity vs. design, temperatures, free space and uptime, with plain-language findings.
- **Restore points** on Windows: on demand, and automatically before changing services, uninstalling an app or removing `Windows.old` (can be turned off in Settings).
- **Network by app**: open connections and remote servers per app, download/upload speed, and per-program internet blocking with Windows Firewall rules that can be removed at any time.
- **Windows services**: curated list of auto-start services that can start on demand instead; switched to *Manual* (never disabled), journaled, verified and restorable exactly (including delayed start).
- Sidebar grouped into Monitor, Speed up, Free up space and RePID.
- **Dual license**: this and later versions are free for noncommercial use (PolyForm Noncommercial 1.0.0) and require a paid commercial license for company use. Authorship recorded as RellyDev — Voxel Enterprise in LICENSE, NOTICE, the app and signed releases. Previously published MIT versions stay MIT.
- **RePID Enterprise** ($20 per computer per year, PayPal subscription): separate `RePID-Identity-Enterprise-…` installers, Ed25519-signed license keys verified offline, seat count per network, expiry with a 14-day grace period that a clock set back cannot extend, support code and pre-filled emails to Voxel Enterprise (support and Beta access), `npm run license` to issue and verify keys.
- Free edition: notice on company computers; with more than 5 free copies on one local network, Automatic, Services, Updates, Disk and Network are locked until RePID Enterprise is installed. Copies find each other with a local-network UDP announcement (nothing leaves the LAN).
- **New version notice**: at start-up and every 6 hours RePID reads the installer version on the download page; when it is newer, a banner with an *Update* button opens that page. Can be hidden per version or turned off in Settings.

### Security
- Disk: ids only from the last scan; Windows, `Program Files` on any drive, `ProgramData`, AppData, the Recycle Bin, dot-folders, `node_modules`/`venv`/`vendor`/build outputs are never offered; libraries are never offered as duplicates. Rules come from a real dry run where a naive scan flagged Gradle caches and Android emulator images.
- Updates: package ids are pattern-validated, must appear in the latest scan and are passed as separate arguments with `--exact`.
- Firewall and services: program paths come from the engine's own process list; rule ids and service names are pattern-validated; values reach PowerShell through environment variables; drivers, audio, network, security and uncurated Windows internals are never offered.

## [1.4.0] — 2026-11-06

### Added
- **Leftovers of already-uninstalled apps**: folders in AppData, LocalLow, ProgramData and Program Files that no installed app, process, service, driver, working startup entry or shortcut claims and that have been idle for 60+ days; broken shortcuts, Run entries and logon tasks; “Installed apps” entries whose uninstaller and folder are gone; matching HKCU\Software keys. Safe items pre-selected, the rest for review, with *select all / safe only / none*.
- Cleanup: **app caches** of Electron/Chromium apps (verified by Chromium's own markers), **crash memory dumps**, and **previous Windows installation & update leftovers** through Windows' Disk Cleanup handlers (`cleanmgr /sagerun`).

### Fixed
- A broken startup entry no longer counts as evidence that a folder is in use.

## [1.3.0] — 2026-11-06

### Added
- **Smart uninstaller**: lists classic (registry), MSI and Microsoft Store apps on Windows, `.app` bundles on macOS and Flatpak apps on Linux, with size, publisher, install date and whether the app is open. Runs the app's own uninstaller, waits for self-relaunching uninstallers, verifies the app is gone and then finds leftovers: install folder, AppData/LocalLow/ProgramData/Program Files/Start Menu folders, registry keys, Run entries, logon tasks and shortcuts (macOS `~/Library` by bundle id; Linux `~/.var/app`).
- Guided four-step wizard; each leftover shows why it was matched. Files go to the Recycle Bin/Trash; registry keys and tasks are exported before deletion, with an *Open backups* button.
- Forced cleanup for apps whose uninstaller no longer exists.

### Security
- Leftovers are matched by exact name, scoped to the vendor's folder for short or vendor-less names, and never include folders or names belonging to another installed app. Deletion requests carry session ids only; every path/key is re-validated at deletion time. Shared runtimes, OS components and RePID are locked.

## [1.2.0] — 2026-11-04

### Added
- **Performance mode**: Gaming, Focus, Render/build and Custom profiles. Background apps get below-normal priority plus Windows 11 EcoQoS; an optional focus app gets above-normal priority. New processes of selected apps are adjusted automatically, and everything is restored on stop, on selection change and when RePID quits.
- Per-app *Efficiency mode* switch in the detail panel and leaf/target markers in the process list.
- **Startup manager**: Registry Run keys, Startup folders, Microsoft Store startup tasks and logon scheduled tasks on Windows; LaunchAgents and login items on macOS; XDG autostart on Linux. Real names and publishers, live measured impact, suggestions, per-entry consequences, warnings for security/hardware/cloud-sync entries, a change journal and one-click *Restore all*.

### Changed
- PowerShell scripts are passed with `-EncodedCommand`, so quotes and newlines reach PowerShell byte for byte.
- Switching sections always starts at the top of the page.

### Fixed
- Views could not be scrolled when the window was not maximized.

### Security
- Startup and performance requests carry ids only; the main process re-scans, re-classifies and re-checks protection before every change and verifies the result afterwards. Locked entries and protected processes are refused even if the UI asks.

## [1.1.0] — 2026-11-04

### Added
- **Deep cleanup** module: user and system temp files, update download cache, Recycle Bin/Trash, DNS cache, package-manager caches, and cache/history/cookies for Chrome, Edge, Firefox, Brave, Opera, Opera GX, Vivaldi, Chromium and Safari.
- Every cleanup item explains what will happen; sensitive items (recycle bin, history, cookies) are off by default and require explicit acknowledgement.
- Open browsers are detected; RePID offers to close them before cleaning or skips their items.
- Firefox history is cleared with SQL so bookmarks in the same database survive.

### Changed
- Windows builds request administrator rights at launch (`requireAdministrator`).
- Ending processes escalates automatically when access is denied: `taskkill /F` on Windows, one `pkexec`/administrator prompt on Linux/macOS.

### Security
- Cleanup accepts target ids only; paths are derived in the main process, confined to each target folder, links/junctions are never followed and over-broad roots are refused.

## [1.0.0] — 2026-11-04

### Added
- Identity engine: catalog of 70+ apps and OS components, interpreter script detection, service detection (Windows SCM, systemd, launchd), install-path inference and executable publisher metadata (Windows).
- Application grouping with per-app CPU, RAM and GPU totals.
- Root-level process tree termination (top-down, graceful then forced).
- Service stop through the platform service manager, with polkit elevation on Linux.
- Smart Free: impact-based suggestions with an adjustable threshold.
- Three-tier protection model enforced in the engine, plus user-defined protected names.
- Live dashboard with CPU/RAM/GPU gauges and history; per-process GPU on Windows and NVIDIA.
- Process detail panel with publisher metadata, command line and full process tree.
- Spanish and English interfaces; drop-in JSON locales.
- Dark, light and system themes.
- Windows "Relaunch as administrator".
- Web demo build with simulated data.
- Supporters wall and donation link.
- Installers for Windows (NSIS, portable), macOS (DMG) and Linux (AppImage, deb, rpm).

[1.1.0]: https://github.com/rellytechgame/repid-identity/releases/tag/v1.1.0
[1.0.0]: https://github.com/rellytechgame/repid-identity/releases/tag/v1.0.0
