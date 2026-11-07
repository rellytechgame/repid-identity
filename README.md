<div align="center">

<img src="assets/brand/repid-mark.svg" width="112" alt="RePID Identity logo" />

# RePID Identity

**Know what every process does. End resource hogs from the root.**

A free, open-source desktop app for **Windows, macOS and Linux** that explains — in plain language — what every process and service on your computer is doing, and ends the heavy ones *together with everything they spawned*, to reclaim CPU, RAM and GPU safely.

[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%20%2B%20Commercial-6366f1.svg)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/rellytechgame/repid-identity?color=22d3ee&label=release)](https://github.com/rellytechgame/repid-identity/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/rellytechgame/repid-identity/total?color=8b5cf6)](https://github.com/rellytechgame/repid-identity/releases)
[![CI](https://github.com/rellytechgame/repid-identity/actions/workflows/ci.yml/badge.svg)](https://github.com/rellytechgame/repid-identity/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/rellytechgame/repid-identity?style=flat&color=eab308)](https://github.com/rellytechgame/repid-identity/stargazers)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-10b981.svg)](CONTRIBUTING.md)
[![i18n](https://img.shields.io/badge/i18n-ES%20%7C%20EN%20%7C%20%2B%20yours-f472b6.svg)](docs/ADDING_A_LANGUAGE.md)

[**Download**](https://github.com/rellytechgame/repid-identity/releases/latest) ·
[**Web demo**](https://repid-identity-demo.vercel.app) ·
[**Website**](https://repid.voxel.lat) ·
[**Report a bug**](https://github.com/rellytechgame/repid-identity/issues/new/choose) ·
[**Español**](README.es.md)

<br />

<img src="assets/screenshots/dashboard.png" alt="RePID Identity overview: live CPU, memory and GPU gauges, Smart Free suggestion and top consumers" width="900" />

</div>

---

> ⭐ **If RePID saves you time, please star the repository.** Stars are how other people discover the project — it takes one second and helps a lot.

## Table of contents

- [RePID Identity](#repid-identity)
  - [Table of contents](#table-of-contents)
  - [Why RePID Identity?](#why-repid-identity)
  - [Features](#features)
  - [Screenshots](#screenshots)
  - [Download \& install](#download--install)
  - [Platform support](#platform-support)
  - [How it works](#how-it-works)
  - [Safety model](#safety-model)
  - [Performance mode](#performance-mode)
  - [Startup manager](#startup-manager)
  - [Smart uninstaller](#smart-uninstaller)
    - [Leftovers of apps you already uninstalled](#leftovers-of-apps-you-already-uninstalled)
  - [Deep cleanup](#deep-cleanup)
  - [Disk analyzer](#disk-analyzer)
  - [Automatic mode](#automatic-mode)
  - [App updates](#app-updates)
  - [Health, network and services](#health-network-and-services)
  - [Editions: free and Enterprise](#editions-free-and-enterprise)
  - [Privacy](#privacy)
  - [Development](#development)
  - [Project structure](#project-structure)
  - [Languages](#languages)
  - [Roadmap](#roadmap)
  - [Contributing](#contributing)
  - [Support the project](#support-the-project)
  - [Star history](#star-history)
  - [License \& credits](#license--credits)

## Why RePID Identity?

Task Manager, Activity Monitor and `top` tell you *that* `node.exe`, `svchost.exe` or `Google Chrome Helper (Renderer)` is using resources. They don't tell you **what it is, why it's running, or how to get rid of it properly**:

- Ending one Chrome process leaves 30 others running.
- Ending a service's process just makes the service manager restart it.
- Ending the wrong system process logs you out or crashes the machine.

RePID (*Re*-identify the *PID*) closes that gap: it **identifies** every process, **groups** it with the application it belongs to, **explains** it in your language and **ends the whole tree from the root** — while making it impossible to touch anything that would break your system.

## Features

| | |
|---|---|
| 🧠 **Identity engine** | Combines a curated catalog of 70+ apps and OS components, the script an interpreter runs (`node vite`, `python train_model.py`), hosted services, install location and the executable's own publisher metadata to explain each process in plain language. |
| 🌳 **Root-level termination** | Ends an app and every child it spawned, supervisor first so it can't respawn them. Graceful `SIGTERM` first, `SIGKILL` only for survivors (POSIX). |
| ✨ **Smart Free** | A 0–100 impact score blends CPU, RAM and GPU and suggests what to close — never system processes, services or anything you protected. You review and confirm. |
| 📈 **Live CPU · RAM · GPU** | Gauges with history, per-application usage and per-process GPU utilization (Windows GPU engine counters, NVIDIA `nvidia-smi` elsewhere). |
| ⚙️ **Service-aware** | Detects Windows services, systemd units and launchd agents, and **stops** them through their manager instead of killing processes that would come back. |
| 🛡️ **Safety net** | Three-tier protection (Protected / Caution / Safe) enforced inside the engine, re-checked against fresh data right before every action. |
| 🚀 **Performance mode** | One-click profiles (Gaming, Focus, Render/build, Custom) that make background apps **yield CPU** to what you're using: below-normal priority plus Windows 11 **EcoQoS** (Task Manager's green leaf), and optionally above-normal priority for one focus app. Nothing is closed; everything is restored on stop or when RePID exits. |
| ⏻ **Startup manager** | Every program that opens at sign-in (Registry Run keys, Startup folders, Microsoft Store apps, logon scheduled tasks · LaunchAgents and login items · XDG autostart) with its real name, publisher and **live measured impact**. Disable reversibly with the OS's own mechanism, see what will happen first, and restore everything RePID changed in one click. |
| 📦 **Smart uninstaller** | Runs each app's **own uninstaller**, then finds what it left behind — install folder, AppData/ProgramData folders, caches, registry keys, Run entries, scheduled tasks and shortcuts (macOS: `~/Library` by bundle id · Linux: Flatpak). Leftovers are matched by **exact name**, never other apps' folders; files go to the **Recycle Bin** and registry keys are **backed up** first. Also finds **leftovers of apps you already uninstalled**: unclaimed folders, broken shortcuts, startup entries and “Installed apps” entries. |
| 🧹 **Deep cleanup** | Temp files, system temp, update cache, Recycle Bin/Trash, DNS cache, package-manager caches and the **cache, history and cookies of every browser** (Chrome, Edge, Firefox, Brave, Opera, Opera GX, Vivaldi, Chromium, Safari). Every item says *exactly what will happen* before you delete it; irreversible items need explicit confirmation. Passwords, bookmarks and documents are never touched. |
| 🗺️ **Disk analyzer** | A clickable map of what fills your disk, the biggest files (filter: untouched for a year) and **real duplicates** found by SHA-256 content hash. Always keeps one copy, never offers system, program, app-data or tool folders, and sends everything to the Recycle Bin. |
| ⏱️ **Automatic mode** | Performance mode turns on by itself when a game (Steam, Epic, GOG, Xbox, EA, Ubisoft, Riot, Battle.net libraries) or an app you chose opens, and off when it closes; scheduled cleanup of safe items only; alerts for runaway memory and full disks; optional tray icon and start at sign-in. |
| ⬇️ **App updates** | Lists outdated programs and updates them with the OS's own package manager (winget · Homebrew · Flatpak). Major version jumps are flagged and never pre-selected. |
| 📊 **Per-app disk activity** | The real read/write rate of every application, so you can see which app is hammering the disk — a sortable Disk column, read/write in the detail panel, and a one-click "busiest disk app" insight on the dashboard. Read-only, no admin. |
| 🩺 **Health** | Drive status, SSD wear, temperatures and errors, battery capacity vs. new, free space and uptime, explained in plain language; one-click Windows restore point. |
| 🌐 **Network by app** | Which apps are online right now, how many connections and to which servers; block or unblock an app's internet with a Windows Firewall rule. |
| 🧩 **Windows services** | A curated list of auto-start services (updaters, telemetry, remote access, databases…) that can start on demand instead. Switch to *Manual* — never disabled — with what happens explained, verified and undoable. Drivers, audio, network and security are never shown. |
| 🔑 **Full privileges** | Windows builds run as administrator (UAC prompt at launch) to end any process, stop services and clean system folders. macOS/Linux ask for your password only for the actions that need it (one prompt per action). Critical processes stay blocked regardless. |
| 🌍 **Multilingual** | Spanish and English built in. Adding a language is adding **one JSON file** — the UI discovers it automatically. |
| 🎨 **Polished UX** | Dark/light/system themes, keyboard accessible, reduced-motion aware, native-feeling title bar on every OS. |
| 🔒 **100% local** | No accounts, no telemetry, no servers. |

## Screenshots

| Understand what a process does | Smart Free suggestions |
|---|---|
| <img src="assets/screenshots/identify.png" alt="Process list with detail panel explaining a Python process" /> | <img src="assets/screenshots/smart.png" alt="Smart Free dialog with suggested apps" /> |
| **Performance mode: background apps yield CPU** | **Startup programs with measured impact** |
| <img src="assets/screenshots/boost.png" alt="Performance mode active with the Gaming profile: a priority app and background apps in efficiency mode" /> | <img src="assets/screenshots/startup.png" alt="Startup manager listing programs that open at sign-in with impact, suggestions and what happens if disabled" /> |
| **Smart uninstaller: every leftover, reviewed** | **Deep cleanup with clear consequences** |
| <img src="assets/screenshots/uninstall.png" alt="Uninstall wizard listing the leftovers an app left behind: folders, registry keys and a scheduled task, each with the reason it was matched" /> | <img src="assets/screenshots/cleanup.png" alt="Cleanup module listing temp files, recycle bin, DNS and per-browser cache, history and cookies with what happens if deleted" /> |
| **Disk map: what fills your disk** | **Automatic mode** |
| <img src="assets/screenshots/disk.png" alt="Disk analyzer showing a treemap of the home folder with protected folders striped" /> | <img src="assets/screenshots/automation.png" alt="Automatic mode: performance mode for games, scheduled cleanup, alerts and background options" /> |
| **App updates with winget, Homebrew or Flatpak** | **Health in plain language** |
| <img src="assets/screenshots/updates.png" alt="List of apps with new versions, major versions flagged" /> | <img src="assets/screenshots/health.png" alt="Health: drives, battery capacity, temperatures and disk space" /> |
| **Who is using your internet** | **Services that start with Windows** |
| <img src="assets/screenshots/network.png" alt="Apps with network connections and a button to block internet access" /> | <img src="assets/screenshots/services.png" alt="Curated Windows services with suggestions to switch to manual" /> |
| **Your language, your rules** | |
| <img src="assets/screenshots/settings.png" alt="Settings: language, theme, safety and protected processes" /> | |

## Download & install

Grab the installer for your system from the [**latest release**](https://github.com/rellytechgame/repid-identity/releases/latest):

| OS | Package | Notes |
|---|---|---|
| **Windows 10/11** | `RePID-Identity-x.y.z-win-x64.exe` (installer), `…-portable.exe` | x64 and ARM64. Requests administrator rights at launch (UAC) so it can end any process, stop services and clean system folders. |
| **macOS 12+** | `RePID-Identity-x.y.z-mac-arm64.dmg` / `-x64.dmg` | Apple Silicon and Intel. |
| **Linux** | `.AppImage`, `.deb`, `.rpm` | System services are stopped through polkit (`pkexec`) when required. |

> [!NOTE]
> Until code-signing certificates are funded, Windows SmartScreen and macOS Gatekeeper may warn on first launch. See [Support the project](#support-the-project) — signing is the first thing donations pay for.

## Platform support

| Platform | Status | Why |
|---|---|---|
| Windows | ✅ Full | Processes, services (SCM), per-process GPU, elevation via UAC. |
| macOS | ✅ Full | Processes, launchd agents, bundle metadata. Per-process GPU only with NVIDIA tooling. |
| Linux | ✅ Full | Processes, systemd units (system & user), polkit elevation, NVIDIA per-process GPU. |
| Web | 🟡 Demo | Browsers cannot see OS processes. The [web demo](https://repid-identity-demo.vercel.app) runs the same UI and engine logic on a simulated computer. |
| Android / iOS | ❌ Not possible | Mobile OSes sandbox each app and forbid inspecting or ending other apps' processes. A mobile build could not do its job, so we don't ship one. |

## How it works

```mermaid
flowchart LR
    subgraph Main["Main process (Node.js · privileged)"]
        S[systeminformation<br/>process list] --> G[Grouping<br/>same-app clusters]
        SV[Service map<br/>SCM · systemd · launchd] --> G
        GPU[GPU sampler<br/>WMI · nvidia-smi] --> G
        G --> C[Classifier<br/>catalog · scripts · paths]
        C --> M[Metadata enrichment<br/>publisher · description]
        M --> P[Protection<br/>critical · caution · safe]
        K[Killer<br/>top-down tree end]
    end
    subgraph Renderer["Renderer (React · sandboxed)"]
        UI[Dashboard · Processes · Smart Free]
    end
    P -- "snapshot (IPC)" --> UI
    UI -- "kill(pids) · validated" --> K
    K -- "re-resolves tree +<br/>re-checks protection" --> P
```

1. **Sample** — every few seconds the engine reads the process list, services and GPU counters (expensive lookups run in the background and are cached).
2. **Group** — processes are clustered into applications by walking up same-named ancestors; interpreters are keyed by the script they run, so `node vite` and `node tsserver` stay separate.
3. **Identify** — each group is classified (catalog → interpreter script → hosted service → Chromium/Electron role → updater/helper naming → system path → install folder → executable metadata).
4. **Score** — `impact = 45% CPU (saturates at 25%) + 40% RAM (saturates at 15%) + 15% GPU (saturates at 30%)`.
5. **Act** — on confirmation, the engine re-scans, resolves the full descendant tree itself, re-checks protection, ends parents before children, waits for a graceful exit and force-kills survivors.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Safety model

| Tier | Examples | Behaviour |
|---|---|---|
| 🔴 **Protected** | `System`, `csrss`, `lsass`, `svchost`, `kernel_task`, `launchd`, `WindowServer`, `systemd`, `Xorg`, RePID itself, anything you add | Never ended. The UI disables the action **and** the engine refuses it. |
| 🟠 **Caution** | `explorer`, `vmmem`, `SearchIndexer`, `Finder`, `Dock`, `pipewire`, `NetworkManager` | Requires ticking an explicit acknowledgement. |
| 🟢 **Safe** | User applications | Confirmation dialog shows the whole tree and the memory it frees. |

Electron hardening: `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP in production, IPC sender verification, schema validation of every IPC payload, external links restricted to fixed URLs, no shell string interpolation (all commands use `execFile` with argument arrays; paths reach PowerShell through environment variables). Report vulnerabilities via [SECURITY.md](SECURITY.md).

## Performance mode

Performance mode never ends a process. It changes **scheduling priority only**, and only for apps classified as safe:

| Profile | Yields CPU (pre-selected) | Never pre-selected |
|---|---|---|
| 🎮 Gaming | Browsers, cloud sync, updaters, office apps, IDEs, background helpers | Voice chat, overlays, launchers, media, running scripts/containers, unknown apps (it might be the game) |
| 🎯 Focus | Game launchers, updaters, background helpers | Your work apps |
| 🛠️ Render / build | Browsers, chat, launchers, media, sync, updaters, office | Your editor, renderer or build |
| ⚙️ Custom | Nothing — you choose | — |

- **Efficiency**: below-normal priority (`nice 10` on macOS/Linux) plus **EcoQoS** on Windows 11. A user's stronger manual choice (e.g. "Low") is never overridden.
- **Priority app**: above-normal only. "High" and "Realtime" are never used — they can starve input and audio. Windows only (raising priority needs root elsewhere).
- New processes an app starts later (new browser tabs) are adjusted automatically.
- Every change is recorded with its original value and restored on **Restore all**, when the selection changes, and when RePID quits. Pids are re-checked against the process name before restoring, so a reused pid is never touched.
- OS components, services, security software and anything marked *caution* keep their priority — enforced in the main process, not just hidden in the UI.

## Startup manager

| Source | How RePID disables it | Admin |
|---|---|---|
| Registry Run (user / machine / 32-bit) | `StartupApproved` flag — exactly what Task Manager's *Disable* writes. The Run value itself is untouched. | Machine entries only |
| Startup folder shortcuts | `StartupApproved\StartupFolder` flag; the shortcut stays. | All-users folder only |
| Microsoft Store apps | Startup task `State` = disabled-by-user, the same as *Settings › Apps › Startup*. | No |
| Scheduled tasks at sign-in (non-Microsoft) | `schtasks /Change /DISABLE`. | Depends on the task |
| macOS LaunchAgents | `launchctl disable gui/<uid>/<label>` — the plist is untouched. | No |
| macOS login items | Removed and kept in RePID's journal so they can be added back. | No |
| Linux XDG autostart | `Hidden=true` in your user copy; system files in `/etc` are never modified. | No |

- **Locked**: Windows components (outside DriverStore), entries enforced by policy, desktop plumbing on macOS/Linux (settings daemons, keyring, input methods, accessibility).
- **Caution** (warning + confirmation): security tools, hardware utilities (audio, touchpad, hotkeys, RGB, GPU) and cloud sync.
- **Suggested**: updaters, browsers preloading at sign-in, chat, media and game launchers.
- Impact is **measured now** from the entry's running processes (RAM/CPU), not guessed.
- After every change RePID reads the state back and reports *not applied* if the OS or the app reverted it. Everything RePID disabled is listed in a journal with **Restore all**.

## Smart uninstaller

1. **Official uninstaller first.** RePID runs the command the app registered (or `msiexec /x {ProductCode}` for MSI, `Remove-AppxPackage` for Store apps, Trash for a macOS `.app`, `flatpak uninstall` on Linux) and waits for it — including uninstallers that relaunch themselves from `%TEMP%`. Open instances can be closed first.
2. **Verified.** If the app is still installed afterwards (you cancelled in its window), RePID stops: it never hunts leftovers of an installed app.
3. **Leftovers, by evidence:**

| Where | Matched when | Removed with |
|---|---|---|
| Install folder | It is the folder the app declared (and no other app lives in it) | Recycle Bin |
| `%APPDATA%`, `%LOCALAPPDATA%`, `LocalLow`, `ProgramData`, `Program Files`, Start Menu | Folder named **exactly** like the app, or `Vendor\App` | Recycle Bin |
| `HKCU\Software`, `HKLM\SOFTWARE` (+ WOW6432Node) | Key named exactly like the app, or `Vendor\App` | `reg export` backup, then delete |
| Run entries, logon tasks, shortcuts | They launch a file inside the app's folders | Backup (`.reg` / task XML) or Recycle Bin |
| macOS `~/Library` | Entry carries the bundle id (`com.vendor.app…`) | Trash |
| Linux | `~/.var/app/<id>` of the Flatpak | Trash |

### Leftovers of apps you already uninstalled

**Find leftovers of uninstalled apps** checks every top-level folder of AppData, LocalLow, ProgramData and Program Files against all evidence of use: installed apps (names, publishers, folders), running processes, **services and drivers**, startup entries and tasks that still work, and every shortcut target. A folder is offered only if nothing claims it **and** nothing in it changed for 60 days. Ticked by default: broken shortcuts, Run entries and tasks whose program is gone, “Installed apps” entries whose uninstaller and folder are gone, and program-free folders idle for 6+ months. Folders with programs and LocalLow (game saves) are listed for review only. Windows plumbing, other apps' uninstall data (InstallShield) and shared ecosystems are never offered. In a real dry run it found 11 GB of leftovers from about 40 removed apps.

Safety rules learned from a dry run over 69 real installed apps: names shorter than 6 letters only match inside the vendor's folder (so `Unity` never claims `LocalLow\Unity`, shared by every Unity game); a version is only stripped from the **end** of a name (so *Visual Studio 2010 Tools for Office* never becomes *Visual Studio*); install folders shared with another app (Office suites, plugins) are not offered; names claimed by any other installed app are skipped; shared runtimes (.NET, Visual C++, WebView2), OS components and RePID itself are locked; drivers, security software and runtimes need explicit confirmation. Nothing is removed until you review the list.

## Deep cleanup

| Item | Risk | What happens | Needs admin |
|---|---|---|---|
| Temporary files & user caches | 🟢 Safe | Temp files, crash dumps, thumbnail/shader caches. Recreated automatically; files in use are skipped. | No |
| System temporary files | 🟠 Caution | `C:\Windows\Temp`, Windows Error Reporting archives · `/Library/Caches` · `/var/crash`, old `/var/tmp`, journal vacuum. | Yes |
| Update download cache | 🟠 Caution | Already-downloaded update installers (Windows Update, Delivery Optimization, apt/dnf/pacman). Installed updates are **not** removed. | Yes |
| Recycle Bin / Trash | 🔴 Sensitive | **Permanent** deletion. Cannot be undone. Off by default. | No |
| DNS cache | 🟢 Safe | Flushes name lookups. No downside. | Yes |
| Package-manager caches | 🟠 Caution | npm, Yarn and pip caches. The next install downloads again. Off by default. | No |
| Browser cache | 🟢 Safe | Pages load slower the first time. Sessions and passwords are kept. | No |
| Browser history | 🔴 Sensitive | History, address-bar suggestions, top sites, saved sessions. **Bookmarks and passwords are kept** (Firefox history is removed with SQL because bookmarks share its database). | No |
| App caches | 🟢 Safe | HTTP, code and GPU caches of Electron/Chromium apps (Discord, Slack, VS Code, Postman…), only where Chromium's own markers prove it is a cache. Sessions and messages are kept. | No |
| Crash memory dumps | 🟢 Safe | `MEMORY.DMP`, `Minidump`, `LiveKernelReports`: only useful to diagnose past crashes. | Yes |
| Previous Windows & update leftovers | 🟠 Caution | `Windows.old`, setup files and superseded update components, removed by Windows' own Disk Cleanup handlers. You can no longer roll back to the previous Windows. Off by default. | Yes |
| Browser cookies | 🔴 Sensitive | Signs you out of every website; two-step verification may be asked again. | No |

Open browsers lock their files: RePID shows which ones are open and offers to close them (warning about unsaved work) or skips them. Deletion is confined to each target folder, never follows symbolic links or junctions, refuses over-broad roots (a misconfigured `%TEMP%` such as `C:\`) and only accepts target ids from the UI — never paths.

## Disk analyzer

1. **Map.** Pick your home folder or a drive. RePID walks it in parallel (about 1.5 million files in 80 seconds on a laptop SSD), never follows symbolic links or junctions, and draws a squarified treemap you can click into.
2. **Large files.** Files of 100 MB or more, with a filter for the ones untouched for over a year.
3. **Duplicates.** Same size → same first and last 64 KB → same full **SHA-256**. Identical names are not enough.

What is never offered for deletion (shown striped in the map): Windows and `Program Files` on any drive, `ProgramData`, AppData, the Recycle Bin, and **tool folders** — any dot-folder (`.git`, `.gradle`, `.android`, `.nuget`…), `node_modules`, `venv`, `vendor`, Go module cache, build outputs. Libraries (`.dll`, `.jar`, `.so`…) are never offered as duplicates; programs only when they sit in Downloads. A duplicate set always keeps one copy (the engine refuses a request that would remove all of them), files that changed since the scan are refused, and everything goes to the Recycle Bin. These rules came from a real dry run, where a naive scan flagged Gradle caches and Android emulator images as "duplicates".

## Automatic mode

| | What it does | Safety |
|---|---|---|
| **Performance mode for games** | When a game from a store library or an app on your list opens, applies the Gaming profile (focus on it, background apps in efficiency mode). Off when it closes. | Never overrides a boost you started; if you stop it by hand it stays off until that app closes. Launchers, anti-cheat and crash reporters are not games. |
| **Scheduled cleanup** | Daily or weekly. | Only targets RePID marks safe and pre-selected; never sensitive data, never anything an open app is using, never admin-only targets without admin, never during a game. First run is one full interval after turning it on. |
| **Alerts** | An app whose memory keeps climbing (+1 GB and +50 % in 30 min, above 1.5 GB, without settling), a drive above your threshold. | System notifications; clicking one opens the right section. |
| **Background** | Keep running in the tray when the window closes; start minimized at sign-in (Windows/macOS). | Off by default. |

## App updates

RePID runs the platform's package manager — `winget upgrade` on Windows, `brew outdated` on macOS, `flatpak remote-ls --updates` on Linux — and installs the updates you choose with `--exact` ids passed as separate arguments. winget output is parsed by column position, so it works in any Windows language. Major version jumps (MariaDB 11 → 13, WinRAR 6 → 7) can change how an app or its data works, so they are flagged and never pre-selected.

## Health, network and services

- **Health:** drive health from Windows Storage (with wear, temperature, read errors and power-on hours when RePID runs as administrator) or SMART elsewhere; battery full-charge vs. design capacity from `powercfg /batteryreport` (no admin needed); CPU/GPU temperature when the hardware exposes it; space per drive; days since the last restart. Findings are ordered worst first.
- **Restore points:** on Windows (administrator, System Protection on) RePID can create a restore point by hand, and — unless you turn it off in Settings — automatically before changing services, uninstalling an app or removing `Windows.old`. Windows allows one point per 24 hours; RePID tells you when a recent one already covers you.
- **Network:** open connections per app (loopback ignored), the servers it talks to and the ports it listens on, refreshed every 4 seconds. On Windows, *Block internet* adds an outbound Windows Firewall rule (group "RePID Identity") for that program; rules are listed even when the program is closed and removed with one click. System components cannot be blocked.
- **Services (Windows):** only services that start automatically and match a curated list: Microsoft telemetry, Maps, link tracking, fax and demo mode (suggested); Search, SysMain and Print Spooler (caution); third-party updaters and analytics (suggested); remote access, databases and license managers (caution, never pre-selected). Drivers, audio, touchpad, GPU, network, security and any other Windows internal are never shown. RePID only switches *Automatic → Manual* (Windows still starts the service on demand), records the original mode (including *delayed*), verifies the change and restores it exactly.

## Editions: free and Enterprise

RePID is **free for individuals**. Companies use **RePID Enterprise** — **$20 USD per computer per year** ([subscribe with PayPal](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=YGXL925PT8524)) — which adds direct support from Voxel Enterprise (`support@voxel.lat` / `soporte@voxel.lat`, with a verifiable support code) and early access to Beta versions.

- **Free edition:** everything works. On a company computer (domain, Azure AD, Windows Server or MDM) a notice suggests Enterprise. If **more than 5 free copies** run on the same local network, Automatic, Services, Updates, Disk and Network are locked with a banner pointing to Enterprise; monitoring, ending processes, performance mode, startup, cleanup and the uninstaller keep working.
- **Enterprise edition** (`RePID-Identity-Enterprise-x.y.z` installers): activate the license key you receive by email in *About*. The key is signed (it cannot be forged or edited) and checked offline; using it on more computers than it covers on one network is detected.

No server or database is involved — see [docs/ENTERPRISE.md](docs/ENTERPRISE.md).

## Privacy

RePID makes **no network requests of its own** except anonymous calls to the public GitHub API: the star count on the *About* screen and, at start-up and every 6 hours, a look at the [download page](https://github.com/rellytechgame/repid-identity/releases/tag/win-release) to tell you when a newer version exists (turn it off in Settings). Nothing about you or your computer is sent. To count copies per network, RePID broadcasts a small message on your **local network only** every two minutes (UDP port 47913: a random install id, the edition and, for Enterprise, the license id) — it never reaches the internet. The *Updates* section runs your system's package manager (winget, Homebrew or Flatpak), which contacts its own repositories — only when you open that section. It has no analytics, no crash reporting service and no accounts. Settings live in the app's local storage.

## Development

**Requirements:** Node.js ≥ 20, npm ≥ 10. Git.

```bash
git clone https://github.com/rellytechgame/repid-identity.git
cd repid-identity
npm ci
npm run dev          # Electron app with hot reload
```

| Script | What it does |
|---|---|
| `npm run dev` | Launches the desktop app in development mode. |
| `npm run dev:web` | Runs the UI in the browser with simulated data (web demo). |
| `npm run build` | Compiles main, preload and renderer into `out/`. |
| `npm run build:web` | Builds the web demo into `dist-web/` (deployable to Vercel). |
| `npm run dist` / `dist:win` / `dist:mac` / `dist:linux` | Produces installers in `release/` with electron-builder. |
| `npm run typecheck` | TypeScript strict type checking. |
| `npm test` | Unit tests (Vitest): engine logic, cleaner, uninstaller, disk analyzer (real temp files), automation scheduler, parsers. |
| `npm run i18n:check` | Verifies every language has every key and every catalog entry has a description. |
| `npm run icons` | Regenerates the app icon and social preview from `assets/brand/repid-mark.svg`. |

> [!TIP]
> Running from a terminal **inside VS Code's integrated tooling** that exports `ELECTRON_RUN_AS_NODE=1` makes Electron behave like plain Node. If the app fails with *"Cannot find module 'electron'"*, unset that variable.

## Project structure

```
repid-identity/
├─ src/
│  ├─ main/                 # Electron main process (privileged)
│  │  ├─ engine/            # sampling, services, GPU, metadata, killer, privileges
│  │  ├─ cleaner/           # cleanup targets, safe deletion, Firefox history (+ tests)
│  │  ├─ startup/ boost/ uninstall/   # startup manager, performance mode, uninstaller
│  │  ├─ disk/ automation/ updates/   # disk analyzer, background automation, package managers
│  │  ├─ health/ network/ services/   # health & restore points, firewall, Windows services
│  │  ├─ ipc.ts             # validated IPC surface
│  │  └─ index.ts           # window, CSP, lifecycle
│  ├─ preload/              # contextBridge → window.repid (typed, minimal)
│  ├─ shared/
│  │  ├─ engine/            # pure logic: catalog, classifier, grouping, protection, smart (+ tests)
│  │  ├─ types.ts           # contract shared by every layer
│  │  └─ constants.ts       # repository and donation URLs
│  └─ renderer/             # React UI
│     └─ src/locales/       # one JSON per language  ← add yours here
├─ assets/brand/            # logos (SVG master, Voxel Enterprise marks)
├─ docs/                    # architecture, translation guide
├─ scripts/                 # icon generation, locale checker
└─ electron-builder.yml     # packaging for Windows, macOS, Linux
```

The website ([repid-identity.vercel.app](https://repid-identity.vercel.app)) is maintained by Voxel Enterprise in a separate private repository.

## Languages

| Language | App | Website |
|---|---|---|
| 🇪🇸 Español (primary) | ✅ | ✅ |
| 🇬🇧 English | ✅ | ✅ |
| *Yours?* | [Add it →](docs/ADDING_A_LANGUAGE.md) | |

## Roadmap

- [x] Deep cleanup module (v1.1)
- [x] Performance mode with Windows 11 EcoQoS and a reversible startup manager (v1.2)
- [x] Smart uninstaller with leftover detection, Recycle Bin and registry backups (v1.3)
- [x] Leftovers of already-uninstalled apps, app caches, crash dumps and Windows.old cleanup (v1.4)
- [ ] Code-signed installers for Windows and macOS (**funded by donations**)
- [ ] Auto-update through GitHub Releases
- [x] Disk analyzer, automatic mode, app updates, health, network by app and Windows services (v1.5)
- [x] Per-application disk I/O rate in Processes, detail and dashboard (v1.6)
- [ ] Per-process network bandwidth
- [ ] Custom alert rules such as "warn when Y exceeds 4 GB"
- [ ] Quick Smart Free from the tray icon
- [ ] Community-maintained catalog file with remote updates (opt-in)
- [ ] More languages: Português, Français, Deutsch, Italiano…

Have an idea? [Open a feature request](https://github.com/rellytechgame/repid-identity/issues/new?template=feature_request.yml). Sponsors vote on priorities.

## Contributing

Contributions of every size are welcome — code, a missing process in the catalog, a translation, a bug report or a typo fix. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and look for issues labelled [`good first issue`](https://github.com/rellytechgame/repid-identity/labels/good%20first%20issue).

<a href="https://github.com/rellytechgame/repid-identity/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=rellytechgame/repid-identity" alt="Contributors" />
</a>

## Support the project

RePID Identity is free, has no ads, sells no data and will **never** lock features behind a paywall. Donations keep it that way:

| Where the money goes | |
|---|---|
| 🔏 Code signing | Windows certificate + Apple Developer Program (USD 99/yr) so installers open without warnings |
| 🧠 Smarter identification | Growing the catalog and heuristics |
| 🛠️ Maintenance | Testing on three operating systems and shipping stable releases |
| 🌍 Translations | Professional review of new languages |

| Tier | Amount | You get |
|---|---|---|
| ☕ Coffee | USD 3 | Public thank-you in the next release notes |
| 🚀 Booster | USD 10 | Your name on the supporters wall (app, website, [SUPPORTERS.md](SUPPORTERS.md)) |
| 💎 Sponsor | USD 25 | Name **with link** · a vote on roadmap priorities · priority triage of your issues |
| 🏢 Company | USD 100 | Logo in this README, the website and the app's *About* screen for 12 months · direct contact channel |

<div align="center">

[![Donate with PayPal](https://img.shields.io/badge/Donate-PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/iandasystems)

</div>

Write your name or GitHub username in the PayPal note so we can credit you (applied manually within 7 days). No budget? A ⭐, a share or a translation helps just as much.

## Star history

<a href="https://star-history.com/#rellytechgame/repid-identity&Date">
  <img src="https://api.star-history.com/svg?repos=rellytechgame/repid-identity&type=Date" alt="Star history chart" width="600" />
</a>

## License & credits

Created by **RellyDev — Voxel Enterprise**. Dual-licensed: free for noncommercial use under the [PolyForm Noncommercial License 1.0.0](LICENSE); company use requires a paid commercial license (RePID Enterprise). © 2026 RellyDev — Voxel Enterprise.

<div align="center">
<br />
<sub>Designed and built by</sub><br />
<a href="https://github.com/rellytechgame">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/voxel-logo-light.png" />
    <img src="assets/brand/voxel-logo-dark.png" alt="Voxel Enterprise" width="200" />
  </picture>
</a>
</div>
