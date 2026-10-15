# Agent Note: `api/brepjs-compat` renamed to `api/geom-types`

Status: implemented

English | [中文](2026-10-07-rename-brepjs-compat-to-geom-types.zh.md)

## Problem

The directory `packages/core/src/api/brepjs-compat/` was a historical name that misled readers — after the 2026-09-25 core-decouple (decision 9), it contained no brepjs code at all, only core-inlined pure geometry utilities and types (vecOps / planeOps / types / constants + Result combinator barrel export). The name was a legacy remnant.

## Decision

Rename `packages/core/src/api/brepjs-compat/` to `packages/core/src/api/geom-types/` (git mv, history preserved).

## Changes

- Directory 5+1 files git mv'd; 14 core source files updated relative import paths `brepjs-compat/` → `geom-types/` (`api/index.ts` 3 re-export sites, `brep-operations/` 8 files, `brep-topology.ts`, `api/view/` 3 files).
- Generated file `api/surface/capability-map.json` regenerated via `gen-capability-map.ts` (16 path updates), not hand-edited.
- Comment updates: `src/index.ts` (kept old name parenthetical), `geometry2d/bridge/plane.ts`.

## Explicitly unchanged

- `packages/*/NOTICE`: the "brepjs-compat facade" wording is a license attribution statement (brepjs Apache-2.0 ported code), not invalidated by a directory rename.
- Archived plans, `.agents/notes/` historical records, JSDoc "brepjs-compatible signature" phrasing (semantic description, not a path).
- No old-path shim retained: the directory was never imported by external packages; all public symbols are flat-exported via `api/index.ts` and symbol names are unchanged — zero external breakage.

## Alternatives considered

- **Keep the name**: rejected — the name actively misled new contributors into thinking brepjs code lived there.
- **Add a redirect shim**: rejected — no external consumer ever imported the directory path; a shim would be dead code.

## Consequences

- `npm run typecheck` passed; `vitest run test/api/surface test/api/brep-operations test/api/brep-topology.test.ts` (core package) 113 tests all passed; `npm run lint` passed.
