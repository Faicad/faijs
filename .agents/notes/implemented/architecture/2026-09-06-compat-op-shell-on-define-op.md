# Agent Note: compatOp is a shell over defineOp — one entry for all brepjs-lifted ops

Status: implemented

English | [中文](2026-09-06-compat-op-shell-on-define-op.zh.md)

## Problem

`compatOp(fn, spec)` used to re-implement the whole op lifecycle by itself: parameter pass-through, its own `dispatchPath` call, borrow → call → unwrap → adopt, its own `DUAL_OP_META` mounting, and its own product adoption. That made compat a second, parallel implementation path that could drift from `defineOp` (it silently lacked the `positional`/slot-map option entirely), and the multi-product annotation was a bespoke name (`geometryFields`) that the library surface duplicated. Fixing the field set meant hand-syncing two copies of the same contract. The mandated direction is a single entry point: `compatOp` is a thin shell over `defineOp` and only adds the brepjs bridging that `defineOp` cannot own; everything else (dispatch, Result boundary, product wrapping, metadata, capability routing) belongs to `defineOp`.

## Decision

- `CompatSpec extends Omit<DualOpOptions, 'mesh' | 'brep'>` with `name: string` tightened to required. The spec inherits every `defineOp` option automatically — no hand-copied field list, so future `defineOp` options are inherited in `compatOp` with zero edits. There is no self-invented option field (only `name` tightening).
- The adapter is the only execution logic kept inside `compat`: ① borrow each input with `borrowDeep`(faijs `Shape` → brepjs borrowed view), ② call `callBrepjs` and unwrap with `unwrapOrThrow` (shared `unwrapResult` leaf), ③ adopt the product with `adoptOut` (handle/records →  adopt, plain data passthrough, `outputs`-declared fields adopted per key, arrays preserved). This product then flows through `defineOp`'s own wrapping, which passes shapes/records through unchanged.
- `capabilities`, `outputs`, `schema`, `slotMap` pass through verbatim; `keep/keepHidden` still follows the standard shape-visibility contract (a compat boundary does not intercept or rewrite it)  — the borrowed brep views are new brepjs objects, so a body `keep()` on borrowed compat inputs stays a no-op by `design`, exactly as before.
- The multi-product annotation is the single name `outputs` (`fn.outputs` on the wrapped function for `admitCompatLib`); the old `geometryFields` name is gone from the whole repo.
- The op-layer positional form is renamed in `defineOp`: the boxing declaration `PositionalForm`/`positional` field → `slotMap`/`SlotMap`, keeping the statement-layer `StatementIR.positional` (the argument *values*) name.
- Two `defineOp` boundary fixes were required to make the shell cooperate with the existing callers, both verified against the compat e2e suites:
  - `wrapBrepOne` passthrough for plain data: a value that is not a Shape, not a `faceEvolution`/`fromBrep` result, and not a bare OCC handle (`__occtWasm`) is a data product (a sheetmetal-style record), so it is passed through to the engine's value store instead of being tessellated as if it were a raw handle. Native brep products are unaffected (`fromHandle` still serves straight shape-handle numbers).
  - `runImpl` now re-throws `OpError` untouched — the compat adapter throws `OpError` for a library `err` Result, and wrapping it into a plain `Error` made the engine treat it as an unexpected bug instead of a statement failure (`failedAt`). It already preserved `BrepUnsupportedError` / `MeshUnsupportedError`.

## Consequences

- There is exactly one op lifecycle. A compat op is indistinguishable from a native dual-op at the statement boundary: same `defineOp` metadata keys, same dispatch, same Result-to-`failedAt` behavior, same product wrapping.
- The `compatOp` lift works for geometry products (`outputs` records, adopted arrays) and for plain-data products (sheetmetal part records) without `OcctError: meshShape: Invalid shape ID 0`.
- `geometryFields` is unreferencable anywhere outside `docs/plans/`, so `outputs` is the only vendor-facing multi-product name.
- Lint/typecheck/tests: `packages/core` suites (incl. new `compat-op.test.ts`), the full `packages/tests` suite, gear-lib-demo, guard scripts (ghost deps, order, madge), and the doc gates (bilingual pairing re-recorded) are green. The only non-green doc gate is the pre-existing broken cross-link inside an archived plans-month folder, which is forbidden to touch.

## Alternatives considered

- **Keep the two paths and fix the field set by hand.** Rejected: a hand-maintained `CompatSpec` field list is exactly the drift the change removes; the combined-interface inherit requirement was the user's recorded preference.
- **Give compat its own data/consumption carrier (e.g. `consume` / `geometryFields`).** Rejected: memorialized and self-invented interfaces were ruled out; only the bridge essentials plus the `outputs` name remain.
- **Fix the data-return crash in `adoptOut` only.** Rejected: the crash lives in `defineOp.wrapBrepOne`, which is the owner of product wrapping; the passthrough fix there is general (any impl returning a plain object) and keeps the single-entry rule.
- **Let the engine re-catch the wrapped `Error` by message.** Rejected: matching by class (`OpError`) is the documented boundary; message sniffing would re-introduce the drift.

## Verification

- New core test `packages/core/src/api/internal/compat-op.test.ts` (7) covers meta-field set equity with `defineOp`, dispatch matrix on/off chain, `outputs` runtime record, `slotMap` positional form, `keep`/`keepHidden` terminals, and `fn.outputs` admission.
- Re-run of the compat-integration batch `compat-e2e` / `v53-lib-brep-dispatch` / `p4-l3` / `p23-cad-face` / `refactor-acceptance` (58 passed) is green; the full workspace tests are green (core 233, tests 1327, gear-lib-demo).