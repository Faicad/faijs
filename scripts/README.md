# Script Layout

English | [中文](README.zh.md)

This repository keeps two kinds of scripts in separate homes:

| Kind | Location | Purpose |
|---|---|---|
| Third-party entry | `packages/core/scripts/faijs-cli.ts` | The only script meant for external callers (bin-like entry). Thin shell over `cliMain` from `packages/core/src/node-host/cli.ts`; run with `npx tsx packages/core/scripts/faijs-cli.ts <check\|run\|view> <file.fai.js> [options]`. |
| Repo-internal | `scripts/` and `packages/core/scripts/gen-*` | CI, doc gates, translation tooling, generators, and dev utilities. Never referenced by external callers. |

## Third-party entry

`packages/core/scripts/faijs-cli.ts` is the public CLI. The CLI logic itself lives in `packages/core/src/node-host/cli.ts` (importable and unit-tested, same pattern as `check`/`run`); the entry file only wires `process.argv` and the `cad` namespace.

## Repo-internal scripts

Root `scripts/` holds the repo's own tooling: CI scripts (`ci.ps1`/`ci.sh`), doc gates (`verify-*`, `doc-typecheck.ts`), translation pairing, and utilities. `packages/core/scripts/gen-*` holds the L3 API-surface generators. Per-script details live in [docs/analysis/2026-08-30-scripts-reference.md](../docs/analysis/2026-08-30-scripts-reference.md).
