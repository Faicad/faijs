# Agent Note: compatOp adopt-only — retiring the borrow vocabulary at the library boundary

Status: proposed

English | [中文](2026-10-07-compatop-adopt-only-terminology.zh.md)

## Problem

The L3 library boundary used to run a borrow → call → adopt pipeline: `borrowDeep` rewrote every faijs `Shape` argument into a kernel handle view, the compat source function was called, and the product was adopted back into a faijs `Shape`. The borrow half is now deleted — neither real library needs it, because `sheetmetal` and `faijs-gears` are faijs-native and consume core `Shape`s directly. `borrowDeep`, `borrowBrepjsShape`, `createBorrowedHandle`, `compat-projection.ts` and the `registerLib` `borrow` option are gone, and the adapter passes arguments through untouched.

The descriptive text did not follow, leaving four kinds of residue:

- skip reasons in `api/surface/arg-spec.ts` argued from the deleted mechanism ("array inputs are no longer a blocker — `borrowDeep` borrows them recursively"), so a conclusion rested on a premise that no longer exists;
- roughly fifteen comments described the retired pipeline as the current one ("handle borrow → call compat source → Result flip → adopt"), including a stale pointer in `api/extrude.ts`, two leftover sentences in `api/internal/compat-op.ts`, and the `callBrepjs` JSDoc in `api/internal/l3-bridge.ts`;
- `docs/library-dev-guide.md` and its Chinese counterpart still taught `borrow: false` — an option that no longer exists on `registerLib`, so a reader following the manual writes dead configuration — and still listed "Borrow" as a boundary step the engine performs;
- the generated docs carried the same wording into every chapter: `packages/core/scripts/gen-l3-surface.ts` emits "no vendored borrow/call" into generated JSDoc, and `scripts/gen-ops-api-inventory.ts` hard-codes "entry `Shape` → borrow" into the three-surface table of `docs/ops-api-inventory.md` and its Chinese side.

## Proposal

Align the vocabulary with the mechanism that exists: the engine passes library inputs through unchanged and only adopts products on the way out — adopt-only. Concretely:

- `arg-spec.ts`: rewrite the four reasons that argued from `borrowDeep` without inventing a replacement argument (the `loft` entry points at the handwritten `api/loft.ts` as the only implementation path; `guidedSweep` / `multiSectionSweep` keep only the factual conclusion), and restate the pipeline descriptions as "input pass-through → call compat source → Result flip → adopt", with the geometry-argument field docs saying `brepOf` reads the kernel handle directly.
- `gen-l3-surface.ts` and `gen-ops-api-inventory.ts`: update the JSDoc and table templates ("no vendored borrow/call" and "entry `Shape` → borrow" become "no compat-source relay" and "entry `Shape` passes through"), then re-run both generators so the generated files and the standing inventory document are regenerated rather than hand-edited.
- `library-dev-guide.md` plus `library-dev-guide.zh.md`: delete the `borrow: false` lesson, replace the boundary step "Borrow" with "Pass-through", correct the `unfoldSolid` row from a borrowed arena view to direct consumption of the input `Shape`, and drop `borrow` from the adoption lifecycle; both languages move together and the pair sidecar is re-recorded.
- Keep the borrow vocabulary that is still true: `BorrowedShapeHandle` and `adoptEntity` (product-side "not owned, not disposed"), `brepOf` (the current way to reach a kernel handle), and the kernel-level local borrows in `api/feature-repair.ts`, the `borrowed` wire views in `api/internal/profile-wire.ts`, and `api/cadquery-selectors/borrow-bridge.ts`.

No runtime behavior changes: the diff is comments, documentation text, and generator templates.

## Alternatives considered

**Keep the reasons and only drop the function name.** Rejected: the argument dies with the mechanism. Under pass-through there is no input-rewriting step at all, so "array inputs are no longer a blocker" has no referent, and a reason that cannot be re-derived from the code misleads the next maintainer of the single hand-maintained spec file.

**Rename `BorrowedShapeHandle` / `borrowHandles` / `borrowedShapeCache` for vocabulary consistency.** Rejected: the product-side meaning ("borrowed = not owned, not disposed") is still exactly what the type means, and the other two are kernel-level borrows — a different mechanism. The churn buys nothing and would touch working code for a documentation goal.

**Hand-edit the generated documents.** Rejected: `docs/ops-api-inventory.md` and its Chinese side are generator output and the inventory check inside the documentation gate fails on staleness; the templates are the only correct edit point.

**Fix the English manual only.** Rejected: the two sides are one document under the bilingual pairing gate, so a single-sided edit is itself a gate failure.

## Acceptance criteria

- A repository-wide search for the deleted identifiers (`borrowDeep`, `borrowBrepjsShape`, `borrow: false`) matches only historical plan and analysis documents.
- `arg-spec.ts` carries no argument that cites the retired borrow step.
- Both generators re-run to zero diff on a second pass, and `capability-map.json` is unchanged.
- The documentation gate passes, including the bilingual pairing and paragraph-wrap checks, with the guide pair re-recorded.
- Targeted tests pass: the arg-spec and capability-map surface tests, plus the compat-e2e sheetmetal, aluminum-enclosure and lib-error flows.

## Risks

- The English and Chinese sides of the guide can drift structurally; the pairing gate catches that only at commit time.
- Removing an argument shortens the skip reasons, losing some rationale for later op-coverage decisions — mitigated by pointing at the handwritten implementation path instead.
- The generator templates change generated JSDoc across many files; any later wording change must go through the generators again, never through the generated files.
