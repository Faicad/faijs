# Agent Note: local resolution of the `brepjs-compat` subpath and the D8 Result bridge

Status: implemented

English | [中文](2026-09-20-faijs-subpath-local-resolution-and-d8-result-bridge.zh.md)

## Problem

`pwsh scripts/publish-all.ps1 -Tag next -DryRun` aborted on `scripts/ci.ps1` with two
independent failures, neither of them in the release script itself:

```
Test Files  5 failed | 78 passed (83)
Error: Cannot find module '@faicad/faijs/brepjs-compat'
  imported from 'packages/sheetmetal/src/allowanceFns.ts'
```

```
FAIL  faijs/p7-dual-chain/p7-dual-chain.test.ts > 全部 `vendored/brepjs` import 都位于 api/
AssertionError: expected [ …(10) ] to deeply equal []
```

1. Every local consumer of the workspace resolves `@faicad/faijs` by **prefix replacement**
   to `packages/core/src` (8 `vitest.config.ts` aliases, 8 `tsconfig.json` `paths`,
   `packages/demo/vite.config.ts`). The published subpath `./brepjs-compat` maps to
   `dist/api/brepjs-compat/index.js`, so the prefix rewrite produced
   `core/src/brepjs-compat` — a directory that does not exist. Typecheck stayed green
   because TypeScript, once the `paths` entry misses, falls back to the workspace symlink
   and finds `dist/api/brepjs-compat/index.d.ts`; vitest's alias hits and does not fall
   back, so the same code failed as `Cannot find module`. All 40 files under
   `packages/sheetmetal/src/` use that specifier.
2. The FCStd port imported the vendored Result implementation directly
   (`../vendored/brepjs/core/result.js`) from 10 files under `packages/core/src/fcstd/`,
   which D8 forbids: `vendored/brepjs` may only be reached from `src/api/`. The rule is
   enforced twice — `scripts/check-layer-boundaries.mjs` (R5, exit 1) and the
   `p7-dual-chain.test.ts` boundary assertion — and `ok`/`err`/`isOk`/`isErr` had no
   platform-side definition at all.

## Decision

1. `packages/core/src/brepjs-compat.ts` re-exports `./api/brepjs-compat/index.js`, so the
   `src/` layout carries the same name as the `package.json` exports key. The repo-wide
   prefix aliases then resolve without touching any of the 17 configuration sites, and the
   published surface is unchanged (`exports` still points at `dist/api/brepjs-compat/`).
2. `packages/core/src/api/result.ts` re-exports the vendored Result surface, and the 10
   `packages/core/src/fcstd/*.ts` imports now point at `../api/result.js` — `src/api/` is
   the single legal bridge to the vendored tree, so no guard is weakened.

## Alternatives considered

- **Add an exact alias ahead of the prefix alias** in each of the 17 config sites
  (8 vitest + 8 tsconfig + demo vite). Rejected: 17 edits that must be kept ordered
  (exact before prefix), and the next subpath whose `src/` layout differs from its exports
  key reintroduces exactly this "typecheck green, tests red" split.
- **Point `fcstd` at `../api/brepjs-compat/index.js`** instead of a Result-only module.
  Rejected: the solver/document layers would pull the whole compat facade and its
  dependency chain for four symbols.
- **Whitelist `fcstd` in the D8 guard** (and relax the `p7-dual-chain` assertion).
  Rejected: that makes the gate green by weakening the rule that keeps `vendored/brepjs`
  behind `src/api/`.
- **Keep `test.stderr`/"5 failed suites" as the only signal** and fix per-invocation.
  Rejected: the failure was structural (alias vs `paths` semantics), not per-file.

## Consequences

Verified one step at a time, each command run alone:

| Check | Before | After |
| --- | --- | --- |
| `packages/sheetmetal/src/reference.test.ts` | `Cannot find module` | 6/6 pass |
| sheetmetal package (`vitest run`) | all suites failed to load | **22 files / 233 tests pass** |
| `packages/core` fcstd (`vitest run src/fcstd`) | 7 files `Failed to load url` | **15 files / 121 tests pass** |
| `faijs/p7-dual-chain` | 1 failed of 6 | 6/6 pass |
| `node scripts/check-layer-boundaries.mjs` | exit 1, 10 offenders | pass (260 ported files) |
| `packages/tests` (full) | 5 files failed | **85 files / 1609 pass + 3 skipped, 0 failed** |

Two consequences worth keeping:

- Typecheck is not evidence for workspace consumers: `tsconfig` `paths` fall back to
  `node_modules`/`dist`, a `vitest` alias does not. A subpath whose `src/` layout differs
  from its `exports` key must have an alias file under `src/`.
- `dist/` freshness can mask a source-level hole; the sheetmetal suite is the check that
  actually exercises it.
