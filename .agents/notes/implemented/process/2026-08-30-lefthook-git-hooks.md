# Agent Note: lefthook git hooks for staged gates

Status: implemented

English | [中文](2026-08-30-lefthook-git-hooks.zh.md)

## Problem

Repository-wide gates live only in CI (`scripts/ci.ps1`): a developer can commit staged documentation or source that violates pairing, archive-frozen, lint, and whitespace rules and only learn about it on the next CI run. Commit-time feedback was missing.

## Decision

The repository installs [lefthook](https://lefthook.dev) git hooks via the root `postinstall` script (`scripts/install-lefthook.mjs`). `lefthook.yml` defines fast, staged-scoped checkpoints; CI keeps owning the full gate matrix:

- `pre-commit`: translation pairing for staged `.i18n.yaml` records (`verify-translation-pairing --cached`), archived Agent Notes freeze check, staged ESLint (`eslint --fix`, then re-stage fixes), and `git diff --cached --check`.
- `pre-merge-commit`: the two documentation checks again.
- `pre-push`: `npm run typecheck`.

The staged lint runs ESLint (the repository's existing linter) instead of switching to oxlint, so there is no rule duplication or config drift. CI runs skip installation via the `CI`/`GITHUB_ACTIONS` environment guard.

The `whitespace (staged)` gate is backed by a repository-wide LF policy: the root `.gitattributes` declares `* text=auto eol=lf` (binary fixtures via `*.3mf binary` / `*.pdf binary`), so the index form is always LF and CRLF never surfaces as trailing whitespace in `git diff --cached --check`, on any host.

## Alternatives considered

- **oxlint for the staged lint job.** Faster for full-repo linting, but its speed advantage disappears for a handful of staged files, and oxlint had a known out-of-memory issue on Windows. It would duplicate rules already enforced by ESLint and create config drift.
- **Full DSH installer port.** The deepseek-harness installer adds worktree ownership markers, install locking, and a pairing merge driver. faijs does not use worktrees or a pairing merge driver; a plain `lefthook install` covers it.
- **No commit hooks, CI only.** Correctness pressure stays on CI and catches problems late; the staged checks cost under a second and justify themselves.
- **Third-party notices and vendor manifest guard.** DSH hooks specific to vendored Python SDKs; no equivalent inputs exist in faijs.

## Consequences

- `npm install` now installs the hooks (`.git/hooks/pre-commit`, `pre-merge-commit`, `pre-push`); `npm ci` on a fresh checkout installs them too.
- A commit with a broken staged `.i18n.yaml` record, a touched frozen archive, a lint error, or trailing whitespace now fails immediately.
- Working-tree files on CRLF (e.g. Windows editors) are normalized to LF in the index at add time, and `eol=lf` keeps a fresh checkout LF across platforms.
- ESLint auto-fixes still apply to staged files; the re-staged result is what gets committed.
- Where a native hook cannot run in some environment, `native:*` overrides remain available in `lefthook.yml`.
