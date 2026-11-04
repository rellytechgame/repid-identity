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

## Impact score

```
impact = 100 × (0.45·min(1, cpu/25) + 0.40·min(1, ram%/15) + 0.15·min(1, gpu/30))
```

Saturation points keep one runaway process from flattening everyone else's score. Smart Free suggests groups with `risk = safe`, no hosted services, category not in {system, security, service} and `impact ≥ threshold` (default 30).

## Web demo

`vite.web.config.mts` builds the renderer alone. Without `window.repid`, `api.ts` uses `createDemoApi()`, which animates a simulated Windows process tree and runs the **same** shared grouping, classification and protection code.

## Internationalization

`import.meta.glob('./locales/*.json')` registers every locale at build time. The engine never produces display text: it returns catalog ids and heuristic keys with parameters, translated by the renderer (`describeIdentity()`).
