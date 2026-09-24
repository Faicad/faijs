# Agent Note: Script-face feature family (shell / draft / thicken / repair) — closing the round

Status: implemented

English | [中文](2026-09-24-script-face-feature-family.zh.md)

## Problem

Phase 5 puts the face/edge-selected feature family on the scripting face: `shell`, `draft`, `thicken`, `filletVariable`, plus the thin repair wrappers (`defeature`, `removeHolesFromFace`, `reverseShape`, `unifySameDomain`, `sew`, `sewAndSolidify`). The ops themselves were written, but the round was not actually closed:

- **`cad.draft` did not work on any engine.** `api/draft.ts` handed `pull` / `neutral` to L1 as **tuples** (`[0,0,1]`), while L1 speaks `BrepVec3 = {x,y,z}` objects. The kernel read a zero vector: occt threw a message-less `KERNEL_ERROR: draft:`, brepkit threw `cannot normalize zero vector`. The cast-heavy call site (`as unknown as Parameters<typeof kernel.draft>[2]`) was the tell — the types only matched because they were defeated.
- **occt's L1 `draft` silently dropped `neutral`.** occt-wasm's native signature is `draft(shape, face, angleRad, direction)` — there is no neutral argument at all — yet the L1 contract carries one and the adapter accepted it without complaint.
- **The three-source guard was red.** The new op names were literal keys in `createApiNamespace()` but the symbol table had not been regenerated, so `op-set-consistency` failed with `missing symbol for "shell"`.
- **`arg-spec` bookkeeping was stale** for the ops that hand-written modules now override.
- **Acceptance was vacuous.** The suite asserted `toBeTruthy()` where the plan (§Phase 5.6) requires geometric equivalence (`filletVariable` with `r1 == r2` must equal `fillet`; `shell` / `draft` need two-engine parity). `draft` and the repair family had no coverage at all.

## Decision

1. **Fix `draft` rather than paper over it.** `api/draft.ts` converts `pull` / `neutral` to `BrepVec3` explicitly (the `pattern.ts` / `api/helix.ts` precedent) and the `as unknown as` casts disappear.
2. **Make the L1 asymmetry loud, not silent.** occt's `draft` adapter now rejects a non-origin `neutral` with an explicit message instead of ignoring it — the same rule `occt-primitives.ts` already applies to `interpolatePoints` ("reject rather than silently produce wrong geometry"). `draft` also rejects `neutral.normal`: neither engine consumes a plane normal (occt has no neutral at all, brepkit takes a point), so the parameter would otherwise be a silent drop.
3. **Keep the dispatch declarations as written by the round**: `shell` / `draft` / `filletVariable` / the six repair wrappers are neutral ops routed by the family capability `capabilities:['directEdit']`; `thicken` is a platform op (`engines:['occt']`) because `thickenWithHistory` is occt-only.
4. **Correct the `arg-spec` records**: `shell` gains a `reason` (hand-written override — the `extrude` / `sweep` precedent, it keeps `kind:'brep-op'` as the *vendored* engine record); `draft` / `thicken` / `removeHolesFromFace` keep `kind:'skip'` but their reasons stop describing *why faijs could not do it* and start naming the hand-written module that does.
5. **Re-run every generator** (`gen-l3-surface`, `gen-capability-map`, `gen-symbol-table`, `gen-api-dts`). The symbol table was the one that mattered: it is the third source of the consistency triple.
6. **Strengthen acceptance to the plan's real bar**, using measured numbers instead of `toBeTruthy`: `filletVariable(…, 2, 2)` and `fillet(radius: 2)` are asserted **volume-equal within 1e-6** (measured bit-identical at 991.4159); `shell` two-engine parity is asserted at its true granularity; `draft` gets a volume-changed assertion that doubles as the regression guard for the tuple bug.

## Alternatives considered

- **Declare per-kernel capability names (`capabilities:['draft']`, `['reverseShape']`, …) instead of the family boolean.** This is the red-line-correct direction and would let the static gate reject brepkit *before* execution instead of failing at runtime (see GOTCHA below). Deferred: `BrepMethodKind` (`brep/engine/types.ts:212`) does not yet contain `draft` / `defeature` / `reverseShape` / `unifySameDomain` / `removeHolesFromFace`, and occt's `methods` list does not either — so the change spans the type union plus both engine declarations. It is a cross-cutting decision, recorded as an open item rather than taken unilaterally.
- **Assert `shell` volume equality across engines.** Rejected on measurement: 2272 (occt) vs 1952 (brepkit) for the same input — the two kernels have different offset semantics. Parity is therefore asserted as *bounding box equal* + *both strictly thinner than the parent*.
- **Assert `vol === 1000` after `reverseShape`.** Rejected on measurement: reversing the shell orientation flips the **signed** volume to −1000, so the conservation assertion must use `|vol|`.
- **Drop `neutral` from the public `DraftParams`.** Rejected for now: the plan specifies it and removing it is a user-facing API decision. The loud rejection keeps the failure honest in the meantime.

## Consequences

- `cad.shell`, `cad.draft`, `cad.thicken`, `cad.filletVariable`, `cad.defeature`, `cad.removeHolesFromFace`, `cad.reverseShape`, `cad.unifySameDomain`, `cad.sew`, `cad.sewAndSolidify` are reachable from `.fai.js`.
- **GOTCHA pinned by test**: L1 vector parameters are `BrepVec3` **objects**, not tuples; a tuple arrives as a zero vector and dies inside the kernel.
- **GOTCHA pinned by test**: `neutral` is **not symmetric** across engines — occt-wasm's native `draft` has no neutral argument, so only a default (origin) neutral is representable on occt; a non-origin value now errors loudly. `neutral.normal` has no consumer on either engine and errors too.
- **GOTCHA pinned by test**: `cad.reverseShape` flips the **signed** volume (box(10,10,10): +1000 → −1000). Not a defect; the assertion must use `|vol|`. brepkit's `unifySameDomain`, separately, **re-centres** the body (`[0,10]³` → `[−5,5]³`).
- **GOTCHA pinned by test**: a BREP handle is only valid inside the kernel instance that created it. Cross-engine comparisons must sample each engine's measurements *while that engine is still active* — otherwise the second engine parses the first engine's arena ids and reports `invalid solid handle`.
- **Open item (needs a decision)**: on brepkit the family boolean `directEdit: true` admits ops that then fail at runtime — `draft` returns **volume-unchanged geometry** (a silent no-op, exactly the shape the "never silently produce wrong geometry" red line targets) and `reverseShape` throws `invalid solid handle`. Two `it.skip` cases in `feature-family.test.ts` record the *correct* behaviour so the fix has a target; see the alternatives entry above for the fix shape.
- **Known input-side gap (pre-existing, not this round)**: on brepkit `cad.sketch` and `cad.edgeRef` are unusable, so every test that feeds a sketch face or an edge ref runs on occt only. Engine-gate cases use `cad.cylinder` (brepkit declares `makeCylinder`) so the failure lands on the op under test.

## Verification

- `packages/core/src/api/feature-family.test.ts` (17 passed / 2 skipped): `shell` thin-wall with bbox + volume bounds, two-engine bbox parity; `draft` reachability with volume-change guard, angle / `neutral.normal` / occt-neutral rejection; `filletVariable` `r1 == r2` ≡ `fillet` (bbox + 1e-6 volume); `thicken` face → solid plus D11-4 (brepkit rejects before execution) and D11-3 (`brep_mock` does not intercept); `reverseShape` signed-volume semantics; `unifySameDomain` volume conservation; `sew` / `removeHolesFromFace` reachability; `defeature` empty-face-list rejection.
- Three-source triple and the surface guards green: `op-set-consistency`, `capability-map`, `arg-spec-capabilities`, `generated/surface-mechanism`, `api-dts-sync` — 24 tests, 5 files.
- `tsc --noEmit`, `eslint` on the touched files, and `scripts/check-platform-imports.mjs` (689 files / 182 platform, 0 violations) clean.
