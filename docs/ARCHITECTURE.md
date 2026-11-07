# Architecture

RePID Identity is an Electron application split into three trust zones.

```
┌──────────────────────────── Main process (Node.js, privileged) ────────────────────────────┐
│  src/main/index.ts        window, CSP, single-instance, permission & navigation lockdown   │
│  src/main/ipc.ts          the ONLY entry point from the UI — validates every payload       │
│  src/main/engine/         OS access                                                         │
│    index.ts   Engine      sampling orchestration, caches, fresh re-scan before actions      │
│    services.ts            pid → Windows service / systemd unit / launchd label; stop()      │
│    gpu.ts                 per-process GPU (WMI GPU Engine counters · nvidia-smi pmon)       │
│    metadata.ts            FileDescription/CompanyName enrichment (batched, cached)          │
│    killer.ts              top-down tree termination, graceful → forced                     │
│    details.ts             executable metadata + full subtree for the detail panel           │
│    privileges.ts          elevation detection, UAC relaunch                                 │
│    exec.ts                execFile wrapper (no shell)                                       │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ contextBridge (src/preload) — typed RepidApi
┌──────────────────────────── Renderer (React, sandboxed) ───────────────────────────────────┐
│  src/renderer/src         views, components, i18n, settings (localStorage)                 │
│  api.ts                   window.repid in Electron · createDemoApi() in a browser           │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ imports (pure functions, no I/O)
┌──────────────────────────── Shared (pure logic, unit-tested) ──────────────────────────────┐
│  src/shared/engine        catalog · classifier · grouping · protection · smart              │
│  src/shared/types.ts      the contract between all layers                                   │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Snapshot pipeline

1. `si.processes()` (systeminformation) → `ProcessInfo[]`. On Windows the idle pseudo-process (pid 0) is dropped.
2. `getServiceMap()` — cached 20 s. Windows: `tasklist /svc /fo csv`. Linux: last segment of `/proc/<pid>/cgroup` ending in `.service` (user units detected via `user@<uid>.service`). macOS: `launchctl list`, ignoring `application.*` GUI instances.
3. `getGpuSample()` — non-blocking; returns the last finished sample and starts a new one every 4 s.
4. `buildGroups()` clusters each process under its topmost ancestor with the same **cluster key** (normalized name; for interpreters, name + script). Stats are summed per cluster; descendants with other names are listed as `descendantPids`.
5. `classify()` assigns an `Identity` from the strongest evidence available.
6. `enrichWithMetadata()` fills product/publisher for processes the catalog doesn't know (Windows), cached per executable path.
7. `riskOf()` decides `critical | caution | safe` per member; the group takes the maximum.

## Termination

`Engine.kill()` ignores everything the UI knows except the root pids:

1. Re-scan processes (cache age 0).
2. Resolve descendants breadth-first from the fresh list (cycle-safe).
3. Evaluate risk again; `critical` → refused, `caution` → refused unless `allowCaution`.
4. Signal roots first, then children (supervisors can't respawn).
5. POSIX: `SIGTERM`, poll up to 2 s, `SIGKILL` survivors. Windows: `TerminateProcess` (no catchable signal exists for arbitrary processes).
6. Report per-pid outcome (`killed`, `already-exited`, `protected`, `denied`, `failed`) and the resources freed.

Services are stopped instead of killed: `sc.exe stop`, `systemctl [--user] stop` (falling back to `pkexec` for system units), `launchctl stop`. The service name always comes from the engine's own lookup.

## Cleanup

`src/main/cleaner/`:

- `targets.ts` — pure per-OS definitions (`systemTargets`, `chromiumTargets`, `firefoxTargets`, `safariTargets`) built from an injected environment, plus `isSafeCleanRoot` (refuses drive/filesystem roots, home, OS folders and anything shallower than two segments).
- `fsops.ts` — `processSpec(spec, remove)` measures or deletes `contents` / named `files` / `match`ed files inside one directory. Uses `lstat`; links and junctions are removed as links, never traversed; every entry is checked with `isInside(entry, specDir)`; files in use are skipped and counted.
- `firefox.ts` — clears history rows in `places.sqlite` with `node:sqlite` (bookmarks share the database).
- `index.ts` — `Cleaner.scan()` discovers profiles and measures; `Cleaner.clean()` validates the id-only request, refuses sensitive targets without acknowledgement, optionally ends blocking browsers through the engine (protection rules apply), deletes, and runs all macOS/Linux privileged lines in a single elevated call.

## Startup manager

`src/main/startup/` — one adapter per OS behind `StartupAdapter { list, setEnabled }`:

- `windows.ts` — one read-only PowerShell inventory (Run keys + `StartupApproved`, Startup folders with shortcut targets, Store startup tasks from each package manifest, non-Microsoft logon/boot tasks). Changes go through `reg.exe` (`StartupApproved` / Store `State`) or `schtasks.exe`.
- `darwin.ts` — LaunchAgents via `plutil` + `launchctl print-disabled`, toggled with `launchctl enable|disable gui/<uid>/<label>`; login items through JXA with values passed in environment variables.
- `linux.ts` — XDG autostart with user-over-system precedence; pure helpers for `.desktop` editing.
- `index.ts` — `StartupManager`: classification (`shared/engine/startup.ts`: `parseCommand`, `assessStartup`, `matchRunning`, `measureImpact`), protection re-check, verification by re-reading, and the change journal (`startup-journal.json` in userData, written atomically).

## Performance mode

`src/main/boost/` — `Booster` keeps targets by cluster key (`boostKey`) and a ledger of adjusted pids with their original priority. A 4 s tick adjusts new pids and forgets exited ones; `stop()` (also on `before-quit`) restores everything. `ecoqos.ts` runs one PowerShell worker per session that compiles a constant P/Invoke shim for `SetProcessInformation(ProcessPowerThrottling)` and receives pid batches over stdin. Planning (`shared/engine/boost.ts`: profiles, eligibility, suggestions) is pure and shared with the web demo.

## Smart uninstaller

`src/main/uninstall/` — `PlatformUninstaller { inventory, run, leftovers, removeNonFile }` per OS:

- `windows.ts` — inventory from the three Uninstall registry views plus `Get-AppxPackage`; runs the registered uninstaller with its original command line (`windowsVerbatimArguments`), MSI through `msiexec /x`, Store through `Remove-AppxPackage`; waits for follow-up uninstaller processes; finds leftovers in folders, registry (`reg query`), startup entries (reusing the startup adapter) and shortcuts (resolved in one PowerShell call); removes keys/values after `reg export` and tasks after exporting their XML.
- `darwin.ts` — `.app` bundles from `/Applications` and `~/Applications`, leftovers in `~/Library` by bundle id.
- `linux.ts` — Flatpak apps and `~/.var/app/<id>`.
- `index.ts` — `Uninstaller`: protection re-check, closing running instances through the engine, verification that the app is gone, per-app leftover sessions (ids only reach the renderer) and deletion (Recycle Bin via injected `shell.trashItem`).

Orphans (`orphans-windows.ts`, `orphans-unix.ts`) cross every top-level folder of the per-user and machine data roots with all evidence of use — installed apps, running processes, service/driver binaries (`Win32_Service`, `Win32_SystemDriver`), working startup entries and resolved shortcut targets — and skip anything changed in the last 60 days (`orphanVerdict`).

Pure matching rules live in `shared/engine/uninstall.ts` (`productKeys`, `vendorKeys`, `matchFolders`, `classifyApp`, `parseUninstallString`) and are unit-tested with cases taken from a real inventory.

## Disk analyzer

`src/main/disk/` — `DiskAnalyzer` walks a root with a bounded pool of 24 concurrent directory reads (`opendir`, symlinks and junctions skipped), sums sizes up the folder chain, folds each folder to its 40 biggest children (`foldTree`) and keeps files ≥ 100 MB and duplicate candidates ≥ 1 MB. Duplicates: size → SHA-256 of the first and last 64 KB → full streamed SHA-256 (capped at 40 GB, biggest savings first). Files and sets get session ids; `delete` re-checks removability, size and modification time, refuses any request that would empty a set (`refusedDuplicateIds`) and confirms another copy still exists before calling the injected `shell.trashItem`. Pure rules (`squarify`, `foldTree`, `suggestKeep`, `isToolPath`, `isDuplicateCandidate`) live in `shared/engine/disk.ts`; `disk.test.ts` exercises the real file system.

## Automation

`src/main/automation/` — a 15-second tick in the main process (so it keeps working with the window hidden in the tray). Auto-boost applies `planBoost(…, 'gaming', trigger)` through the same `Booster` the UI uses, remembers which boost it started and never touches one the user started; a manual stop suppresses the trigger until that app closes. Memory samples are taken once a minute and evaluated with `detectGrowth`; drives are checked every 10 minutes. Scheduled cleanup reuses `Cleaner.scan/clean` with only safe, pre-selected, unblocked targets. Configuration is validated by `sanitizeAutomation` (the UI can never set the schedule clock) and written atomically to `userData/automation.json`. Notifications are localized in `messages.ts` and open the relevant section on click.

## Updates, health, network, services

- `updates/` — `winget upgrade` parsed by column position (`parse.ts`), `brew outdated --json=v2`, `flatpak remote-ls --updates`; upgrades with `--exact` ids from the latest scan.
- `health/` — `Get-PhysicalDisk` + `Get-StorageReliabilityCounter`, `powercfg /batteryreport /xml`, systeminformation elsewhere; findings from `shared/engine/health.ts`. Restore points with `Checkpoint-Computer`, comparing the newest sequence number before and after to tell *created* from *a recent one exists*.
- `network/` — `si.networkConnections()` grouped per app by `summarizeConnections`; speeds measured from byte counters between scans; outbound block rules named `RePID-Block-<sha256(path)>` in the "RePID Identity" firewall group.
- `services/` — `Win32_Service` with executable company, classified by `classifyService` (curated Microsoft list, third-party updaters/telemetry/remote/database/license, everything hardware or security excluded); `Set-Service -StartupType Manual`, restore with `Automatic` or `sc config start= delayed-auto`; journal in `userData/services-journal.json`, verified by reading the start mode back.

## Privileges

- Windows: `requestedExecutionLevel: requireAdministrator` in the packaged manifest. Denied terminations retry with `taskkill /F` (which enables SeDebugPrivilege).
- macOS/Linux: Chromium cannot run as root, so the app stays unprivileged and escalates per action through `runElevated` (`pkexec` / AppleScript `with administrator privileges`). Only constant lines or validated integer pids are passed.

## Impact score

```
impact = 100 × (0.45·min(1, cpu/25) + 0.40·min(1, ram%/15) + 0.15·min(1, gpu/30))
```

Saturation points keep one runaway process from flattening everyone else's score. Smart Free suggests groups with `risk = safe`, no hosted services, category not in {system, security, service} and `impact ≥ threshold` (default 30).

## Web demo

`vite.web.config.mts` builds the renderer alone. Without `window.repid`, `api.ts` uses `createDemoApi()`, which animates a simulated Windows process tree and runs the **same** shared grouping, classification and protection code.

## Internationalization

`import.meta.glob('./locales/*.json')` registers every locale at build time. The engine never produces display text: it returns catalog ids and heuristic keys with parameters, translated by the renderer (`describeIdentity()`).
