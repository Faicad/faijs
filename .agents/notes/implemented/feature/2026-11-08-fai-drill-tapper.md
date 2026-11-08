# Agent Note: `fai_drill_tapper` two-string tapped-hole op

Status: implemented

English | [中文](2026-11-08-fai-drill-tapper.zh.md)

## Problem

The editor creates tapped holes from two drawing callouts that live on the drawing as **two separate strings**: the pilot-drill callout (`Φ2.5↓12` / `Ø2.5 THRU`) and the tap callout (`M3-6H↓8` / `PT1/8`). `fai_drill` accepts either one descriptive thread string or explicit numeric params — there was no op that takes the two callout strings verbatim, cross-validates them, and yields a tapped hole with PMI.

The user's decisions (2026-11-08): key names are `drill` + `tap`; a **through hole with a fixed thread depth is allowed** (tap drills deeper than the hole makes no sense, but tap-shallower-than-through is a normal shop practice); PMI is produced **even without a tolerance class, and no default tolerance is ever filled in** (a hole without a called-out tolerance is modeled without one — no invented `6H`/`2B`); pipe threads (`PT1/8`) are supported. Mesh chain is frozen, so the op is BREP-only.

## Decision

`fai_drill_tapper` (extra/ops/fai_drill_tapper.ts) is a brep-only `defineOp` registered through the editor four-piece (`op-names.ts` EDITOR_OPS, `editor-ops.ts`, `extra/index.ts`, `api/api-namespace.ts`).

- **`parseDrillSpec`** (primitives/screw/drill-spec.ts) parses the drill string into `ResolvedDrillSpec { diameter, depth (0 = through), thru }` with the same OCR-whitelist philosophy as `parseThreadSpec`: length cap, invisible-character reject (raw + NFKC), NFKC, diameter glyph map `[Ø⌀Φφ∅] → Ø`, CN keywords (`深n → ↓n`, `完全贯穿 → THRU`), edge-junk strip, a **majority-number guard before compaction** (`Ø2.5 10` must not compact into `2.510`), comma decimals, the closed alphabet `Ø 0-9 ↓ .`, and explicit contradiction checks (THRU+↓, THRU+DEEP, ↓+DEEP).
- **Shared text layer** `spec-text.ts`: `ThreadSpecError`, the length/invisible/junk regexes, `DEEP_RE`, `THROUGH_RE`, and the arrow variants (incl. `▼` U+25BC) live in one place; `thread-spec.ts` imports and re-exports `ThreadSpecError`, and inserts its CN substitutions after the junk strips, before `DEEP`.
- **Two-string cross-validation** (`normalizeTapperParams`): drill diameter must be ≥ the thread's nominal major diameter; a THRU tap on a blind hole and a thread depth deeper than the hole both reject with `E_ARG`. The two-string form owns the derived fields — any of `diameter, depth, thread, threadDepth, threadClass, holeType, screwSystem, screwSpecIdx, screwThread, screwPitchCustom, tolerance` explicitly given alongside the strings rejects with `E_ARG`.
- **No default tolerance (user Q3)**: the internal `fai_drill` params carry `thread: params.tap`, so `params.thread !== undefined` and the `6H`/`2B` defaulting branch never runs; PMI is produced unconditionally because the op's semantics *is* a tapped hole. Labels come from the existing `formatThreadHole` (e.g. `M3-6H 通（底孔 Φ2.5 通，攻丝）`, `PT1/8 ↓20（底孔 Φ8.7 ↓20，攻丝）`).
- **Through + fixed thread depth (user Q2)** needs zero changes downstream: `buildThreadHolePmi` already takes `pilotDepth > 0 ? min(threadDepth, pilotDepth) : threadDepth`.
- **Reuse over re-implementation**: `fai_drill.ts` exports five internals (`drillBrepPath`, `buildThreadHolePmi`, `faceNormalFrom`, `resolveDirection`, `inwardDirection`); the tapper builds params, then delegates to the exact same BREP path, so geometry is bit-identical to `fai_drill` simple at the same diameter (pinned by equivalence tests).

## Alternatives considered

**One combined string (`'Ø2.5↓12 M3-6H'`).** Rejected: the drawing presents two callouts; the two-string form maps 1:1 onto what OCR reads, and keeps each string's grammar closed.

**Reusing `fai_drill`'s `normalizeDrillParams` for this op.** Rejected: its single-string mutex rules (thread vs. diameter etc.) do not apply to two mutually explanatory strings; the tapper cross-validates instead, and keeps `assertDrillParams` only as a defensive layer.

**Auto-filling a default tolerance class when the tap string omits one.** Rejected by the user: PMI must state exactly what was called out; an invented `6H` is a silent geometry lie.

**Rejecting through hole + fixed thread depth.** Rejected by the user: it is legitimate shop practice; the existing min-branch already expresses it.

**A mesh implementation.** Not taken: the mesh chain is frozen (2026-11-07); brep-only `defineOp` means mesh dispatch is `E_MESH_UNSUPPORTED` by construction.

## Consequences

- 22 core BREP tests (`test/extra/ops/fai-drill-tapper.test.ts`) and 4 e2e tests (`packages/tests` `faijs/tapper/`, brep-mode editor runtime + PMI round-trip) pass; the screw suite (164/164) and full core suite stay green after `gen-api-dts` regeneration.
- CN keywords and `▼` now work in both the thread and drill grammars; `'Ø2.5 THRU ↓10'` rejects via the closed alphabet (mid-string `THRU`), `'Ø2.5 ↓10 THRU'` rejects via the contradiction check — both reject, each pinned by a test.
- `parseDrillSpec`/`ResolvedDrillSpec` are re-exported from `primitives/index.ts` and `browser.ts` (public surface); the symbol table gains entry 180 and `ops-api-inventory` is regenerated from the JSDoc.
- GOTCHA preserved as a comment + test: a `replaceAll` over `throw new ThreadSpecError(` statements also rewrote the `fail()` helper itself into a self-recursive call — the helper's own line must stay a direct `throw new ThreadSpecError(...)`.
- BREP chain only; the mesh chain is frozen and untouched.
