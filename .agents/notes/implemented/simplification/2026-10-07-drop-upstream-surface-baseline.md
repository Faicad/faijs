# Agent Note: Drop upstream-surface.json baseline and U7 reverse fence

Status: implemented

English | [中文](2026-10-07-drop-upstream-surface-baseline.zh.md)

## Problem

`packages/core/src/api/surface/upstream-surface.json` was a committed symbol baseline extracted from the external brepjs repository. Its sole live use was the U7 reverse fence: `gen-l3-surface.ts:generateModule()` loaded it and asserted every non-skip/non-faijs arg-spec entry exists in the baseline. The project forbids any dependency on brepjs or external repositories. A committed brepjs symbol manifest is a baseline dependency even though no code imports it.

## Decision

Delete `packages/core/src/api/surface/upstream-surface.json` and `upstream-exclusions.json`, and remove the U7 reverse-fence check from `gen-l3-surface.ts` and `surface-mechanism.test.ts`.

The U7 fence is fully covered by `tsc`:

- All brep-op/query arg-spec entries are `selfhost: true` (35 brep-op + 8 query, per the 2026-10-06 selfhost cleanup).
- `renderBrepOp` emits `import { … as __own_<exportName> } from '../brep-operations/…'` — a real import of core's own implementation.
- A typo'd exportName in arg-spec fails `tsc` with "has no exported member" when compiling `api/generated/*.ts`.

So U7 guards nothing that tsc does not already guard. Its remaining semantic — "the faijs-own implementation name must equal the brepjs symbol name" — is a naming-continuity constraint that no longer applies once the implementations are selfhost: faijs owns its naming.

`upstream-exclusions.json` had zero code references (grep across `src/`, `scripts/`, `test/`).

## Alternatives considered

- **Keep the baseline as documentation**: rejected — it creates a dependency on brepjs symbol names that no longer applies; the selfhost transition means faijs owns its naming.
- **Replace with a tsc-based fence (no baseline file)**: this is what was done — tsc already catches typos in exportName, so the baseline is redundant.

## Consequences

- Deleted `packages/core/src/api/surface/upstream-surface.json` and `upstream-exclusions.json`.
- `gen-l3-surface.ts`: removed `SURFACE_JSON` constant, `SurfaceSymbol` interface, `loadSurfaceSymbols()`, and the U7 validation block in `generateModule()`; updated header JSDoc.
- `surface-mechanism.test.ts`: removed the U7 test case; renumbered header items.
- `arg-spec.ts`: removed the upstream-surface.json reference from the header JSDoc.
- `npx tsx packages/core/scripts/gen-l3-surface.ts` — regenerated all 14 module shards + script-face + manifest; `git diff --stat packages/core/src/api/generated/` empty (zero drift).
- `npx vitest run packages/core/test/api/generated/surface-mechanism.test.ts` — 4 passed.
- `npm run typecheck` — clean. `npm run lint` — 0 errors.
- The naming-continuity fence against accidental arg-spec symbol-name drift is gone, but fully covered by tsc, so no live coverage loss.
