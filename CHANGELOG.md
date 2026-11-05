# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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
