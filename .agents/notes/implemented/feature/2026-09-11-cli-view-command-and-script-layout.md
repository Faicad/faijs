# Agent Note: faijs-cli view command and script layout

Status: implemented

English | [中文](2026-09-11-cli-view-command-and-script-layout.zh.md)

## Problem

1. The view projection ops (`projectView`/`projectSheet`/`viewCamera`, landed with the view-projection plan) existed only as a library API. The user's requirement was a script: give it a `.fai.js` filename, get a view SVG out. The CLI had `check` and `run` but no `view` command.
2. Scripts had grown two families — the third-party entry `packages/core/scripts/faijs-cli.ts` and the repo's own doc/ci/dev scripts (root `scripts/` plus `packages/core/scripts/gen-*`) — but the split was undocumented. `docs/analysis/2026-08-30-scripts-reference.md` covered only root `scripts/`, and no `scripts/README.md` existed to name the boundary.

## Decision

### `view` command in the CLI

- `cli.ts` gains a third command: `faijs-cli view <file.fai.js> --out <x.svg>` with options `--view <front|back|top|bottom|left|right|iso|"x,y,z">` (single view, default `front`), `--sheet <front,top,right,iso>` (multi-view sheet, mutually exclusive with `--view`), and `--part <name>` (project one shape variable; default resolves terminal shapes like `run`).
- `cliView(filePath, outPath, opts)` is the testable logic: read + execute the script with the CLI ports (project loader, lib loader), select viewable (mesh-bearing) shapes, call `projectView`/`projectSheet` host-side, write the SVG string(s) to disk. Multiple shapes produce one file per terminal (`<out>_<i>_<name>.svg`).
- Viewing requires the BREP path: `initOcctWasm()` is awaited up front and mesh-only shapes surface `E_BREP_ONLY_INPUT` (no runtime fallback, per the static-rule red line).

### Script layout documented

- New `scripts/README.md` declares the boundary: `packages/core/scripts/faijs-cli.ts` is the third-party entry (thin shell over `cliMain`); root `scripts/` and `packages/core/scripts/gen-*` are repo-internal (CI, doc gates, translation, generators) and link to `docs/analysis/2026-08-30-scripts-reference.md` for per-script detail instead of duplicating it.
- `cli.ts`'s header comment names the same split so future contributors see it at the entry point.

## Alternatives considered

- **Put the CLI logic directly in `faijs-cli.ts`.** Rejected: the logic must stay importable and unit-testable (the established `check`/`run` pattern); the entry stays a thin `process.argv` shell.
- **Expose only `projectSheet` (no single-view command).** Rejected: single-view SVG is the primary user requirement (one part, one drawing); the multi-view sheet is an option on top.
- **Write a full scripts reference inside `scripts/README.md`.** Rejected: one home per fact — root-`scripts/` detail already lives in `docs/analysis/2026-08-30-scripts-reference.md`; the README links, it does not duplicate.

## Consequences

- `npx tsx packages/core/scripts/faijs-cli.ts view <file.fai.js> --out <x.svg> [--view|--sheet] [--part]` works end to end. Verified with a centered box: `--view iso` yields a valid SVG with visible solid paths, hidden `stroke-dasharray` lines, and a correct viewBox.
- `view` requires the BREP path; mesh-only shapes fail fast with `E_BREP_ONLY_INPUT` (tests assert no output file is written).
- CLI parsing accepts `"x,y,z"` direction strings as `ViewSpec` objects (e.g. `--view 1,-1,1`).
- Tests: `cli.test.ts` +10 (parseArgs view/sheet/part ×2, single-view viewBox, iso hidden lines, multi-view sheet labels, `--part`, multi-terminal file naming, mesh-mode error, bogus view, missing part); `cli.test.ts` + `view.test.ts` together 40 tests green, core suite and integration suite green.
