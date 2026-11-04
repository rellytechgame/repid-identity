# Contributing to RePID Identity

First of all — thank you! 💜 RePID Identity is built in the open and every contribution matters, whether it's a line of code, a process the catalog doesn't know yet, a translation or a well-written bug report.

*¿Hablas español? Puedes abrir issues y pull requests en español sin problema.*

## Table of contents

- [Code of conduct](#code-of-conduct)
- [Ways to contribute](#ways-to-contribute)
- [Development setup](#development-setup)
- [Project conventions](#project-conventions)
- [Adding a process to the catalog](#adding-a-process-to-the-catalog)
- [Adding a language](#adding-a-language)
- [Pull request process](#pull-request-process)
- [Commit messages](#commit-messages)
- [Security-sensitive changes](#security-sensitive-changes)
- [Recognition](#recognition)

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to uphold it.

## Ways to contribute

| You have… | Do this |
|---|---|
| 🐛 Found a bug | [Open a bug report](https://github.com/rellytechgame/repid-identity/issues/new?template=bug_report.yml) with your OS, version and steps. |
| 🔎 Seen a process RePID can't explain (or explains wrong) | [Report a process](https://github.com/rellytechgame/repid-identity/issues/new?template=process_identification.yml) — or add it yourself (see below, it's a great first PR). |
| 💡 An idea | [Request a feature](https://github.com/rellytechgame/repid-identity/issues/new?template=feature_request.yml). Search existing issues first. |
| 🌍 A language | [Translate RePID](docs/ADDING_A_LANGUAGE.md). |
| 🧑‍💻 Time to code | Pick an issue labelled [`good first issue`](https://github.com/rellytechgame/repid-identity/labels/good%20first%20issue) or [`help wanted`](https://github.com/rellytechgame/repid-identity/labels/help%20wanted) and comment that you're on it. |
| ⭐ Two seconds | Star the repo and share it. Seriously, it helps. |

## Development setup

**Requirements:** Node.js ≥ 20, npm ≥ 10, Git. On Linux you may need `libnss3`, `libgtk-3-0` and `libasound2` for Electron.

```bash
git clone https://github.com/<your-user>/repid-identity.git
cd repid-identity
npm ci
npm run dev        # desktop app with hot reload
npm run dev:web    # UI only, simulated data (no OS access needed)
```

Before pushing, run the same checks CI runs:

```bash
npm run typecheck && npm test && npm run i18n:check && npm run build
```

## Project conventions

- **TypeScript strict.** No `any` unless justified in a comment.
- **Layers stay separate.** `src/shared/engine` is pure logic (no Node, no Electron, no DOM) so it can be unit-tested and reused by the web demo. OS access lives in `src/main/engine`. The renderer never gets Node APIs — only the typed `window.repid` bridge.
- **Never trust the renderer.** Every IPC payload is validated in `src/main/ipc.ts`; the engine re-resolves pids and re-checks protection itself.
- **No shell strings.** Run binaries with `execFile` and argument arrays (`src/main/engine/exec.ts`). Pass dynamic values to PowerShell through environment variables, never by interpolating them into the script.
- **Every user-facing string is translated.** Add it to `en.json` *and* `es.json` (or at least `en.json` — missing keys fall back to English).
- **Comments explain *why*,** not what the code obviously does.
- **Tests for logic.** Changes to grouping, classification, protection or Smart Free need tests in `src/shared/engine/*.test.ts`.
- Formatting: 2 spaces, single quotes, no semicolons (see `.editorconfig`).

## Adding a process to the catalog

This is the easiest high-impact contribution.

1. Add an entry to [`src/shared/engine/catalog.ts`](src/shared/engine/catalog.ts):

   ```ts
   { id: 'obsidian', category: 'office', product: 'Obsidian', names: ['obsidian'], prefixes: ['obsidian helper'] },
   ```

   - `names` are matched against the process name lowercased, without `.exe`.
   - `prefixes` catch helper variants (`Obsidian Helper (Renderer)`).
   - Pick the closest `category` from `src/shared/types.ts`.

2. Describe it in **one sentence** under `catalog.<id>` in `src/renderer/src/locales/en.json` and `es.json`. Say what it *does*, and if relevant, what happens if you end it.
3. If the process must never be ended, or needs a warning, add it to `CRITICAL` or `CAUTION` in [`protection.ts`](src/shared/engine/protection.ts) — and explain why in the PR.
4. Run `npm run i18n:check && npm test`.

## Adding a language

See [docs/ADDING_A_LANGUAGE.md](docs/ADDING_A_LANGUAGE.md). In short: copy `en.json` to `<code>.json`, translate the values, set `_meta.name`, run `npm run i18n:check`. No code changes needed.

## Pull request process

1. Fork, then create a branch from `main`: `feat/tray-icon`, `fix/linux-cgroup-parse`, `i18n/pt-BR`, `catalog/obsidian`.
2. Keep PRs focused — one concern per PR.
3. Fill in the PR template, including screenshots for UI changes (dark **and** light theme).
4. Make sure CI is green.
5. A maintainer reviews within a few days. Direct pushes to `main` are disabled; every change goes through review.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(engine): detect Flatpak sandboxed apps
fix(ui): keep detail panel open after refresh
docs(i18n): add Portuguese guide
catalog: add Obsidian and Logseq
```

## Security-sensitive changes

Changes to process termination, protection lists, IPC, elevation, Electron `webPreferences`/CSP, or command execution are **security-sensitive**. Please:

- Include positive **and** negative tests (what must be allowed, what must be refused).
- Explain the threat you considered in the PR description.
- Expect a more thorough review.

To report a vulnerability, **do not open a public issue** — see [SECURITY.md](SECURITY.md).

## Recognition

All contributors appear in the README contributors grid automatically. Significant contributions are credited in the release notes. Thank you for making RePID better! 🙌
