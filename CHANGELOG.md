# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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
