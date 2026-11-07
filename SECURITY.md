# Security Policy

RePID Identity can end processes and stop services, sometimes with administrator rights. We take its security seriously and appreciate responsible disclosure.

## Supported versions

| Version | Supported |
|---|---|
| Latest minor release (1.x) | ✅ |
| Older releases | ❌ — please update |

## Reporting a vulnerability

**Please do not open public issues for security problems.**

Report privately through **[GitHub Security Advisories](https://github.com/rellytechgame/repid-identity/security/advisories/new)**. Include:

- Affected version and operating system
- A description of the issue and its impact
- Steps or a proof of concept to reproduce it
- Any suggested fix (optional)

**What to expect**

| Step | Target time |
|---|---|
| Acknowledgement | 3 business days |
| Initial assessment | 7 business days |
| Fix for critical issues | 30 days, coordinated disclosure afterwards |

We'll credit you in the release notes unless you prefer to stay anonymous.

## In scope

- Ending or stopping processes/services that the protection model should refuse
- Executing arbitrary commands through process names, paths, service names or IPC payloads
- Escaping the renderer sandbox or abusing the `window.repid` bridge
- Privilege escalation through the elevation flow (UAC relaunch, `pkexec`)
- Loading remote content or navigating the app window to untrusted origins
- Making the cleanup delete anything outside its target folders (path traversal, link/junction following, over-broad roots)
- Making the startup manager change an entry RePID classifies as locked, or anything other than the entry's enable flag
- Making performance mode change the priority of a protected process, or leave priorities changed after *Restore all* or quit
- Making the orphan scan offer a folder that an installed app, service, driver, running process or working startup entry uses
- Making the disk analyzer delete the last copy of a duplicate, a file that changed since the scan, or anything under a system, program, app-data or tool folder
- Making the updater run anything other than the package manager with an id from its own latest scan
- Making the firewall or services modules touch a protected program, a non-curated service, or leave a change that *Undo* cannot restore
- Making the uninstaller offer or delete a folder, key or task that belongs to another installed app or to the OS, or delete anything without a Recycle Bin move / registry backup

## Security design (summary)

- Renderer: `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP in production, permission requests denied, navigation and new windows blocked.
- IPC: sender origin verified; every payload validated (integer pids, bounded arrays, enum-only link targets). External URLs are fixed constants in the main process.
- Engine: protection is evaluated in the main process from freshly collected data; the UI's view of risk is never trusted.
- Cleanup: the UI sends target ids only; paths come from fixed templates, deletion is confined to each target folder, links are never followed, drive/home/OS roots are refused; elevated shell lines on macOS/Linux are constants (plus validated integer pids for kills).
- Startup: ids only; every change re-scans and re-classifies first, uses the OS's own reversible flag (`StartupApproved`, Store task `State`, `schtasks /DISABLE`, `launchctl disable`, XDG `Hidden=true`), never deletes the entry, and is verified by reading the state back. Registry/task names reach `reg.exe`/`schtasks.exe` as argument-array values; Store package ids and launchd labels are pattern-validated.
- Performance mode: group ids only; eligibility is re-checked on every tick; only below-normal/above-normal priorities are used; original values are restored with a pid+name check against reuse. The EcoQoS helper is a constant P/Invoke shim compiled in memory (no DLL written to disk); it receives integer pids only.
- Uninstaller: the UI sends an app id and session leftover ids only. Uninstall commands come from the app's own registration; MSI is rebuilt as `msiexec /x {ProductCode}`; Store package names and Flatpak ids are pattern-validated. Leftover paths are re-checked at deletion (depth ≥ 3, not a known root, not under Windows); files go to the Recycle Bin via `shell.trashItem`; registry keys are exported with `reg export` before `reg delete`.
- Disk analyzer: file and duplicate-set ids only; deletion re-checks removability, size and modification time, keeps one copy of every set and uses the Recycle Bin.
- Automation: the configuration is re-validated in the main process; it can only call the same guarded modules as the UI (performance mode, cleaner) and only with safe, pre-selected cleanup targets.
- Updates / firewall / services: package ids, rule ids and service names are pattern-validated and must come from the module's latest scan; firewall rules target paths from the engine's process list; services are only switched between Automatic and Manual and are journaled for exact restore.
- Commands: `execFile` with argument arrays only; dynamic values reach PowerShell via environment variables; service names are taken from the engine's own lookup and validated against a strict pattern.
- Supply chain: lockfile committed, `npm audit` and CodeQL in CI.
