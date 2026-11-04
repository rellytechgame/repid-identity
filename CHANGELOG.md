# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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

[1.0.0]: https://github.com/rellytechgame/repid-identity/releases/tag/v1.0.0
