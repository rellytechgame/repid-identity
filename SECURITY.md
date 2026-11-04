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

## Security design (summary)

- Renderer: `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP in production, permission requests denied, navigation and new windows blocked.
- IPC: sender origin verified; every payload validated (integer pids, bounded arrays, enum-only link targets). External URLs are fixed constants in the main process.
- Engine: protection is evaluated in the main process from freshly collected data; the UI's view of risk is never trusted.
- Cleanup: the UI sends target ids only; paths come from fixed templates, deletion is confined to each target folder, links are never followed, drive/home/OS roots are refused; elevated shell lines on macOS/Linux are constants (plus validated integer pids for kills).
- Commands: `execFile` with argument arrays only; dynamic values reach PowerShell via environment variables; service names are taken from the engine's own lookup and validated against a strict pattern.
- Supply chain: lockfile committed, Dependabot, `npm audit` and CodeQL in CI.
