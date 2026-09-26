# Agent Note: brepkit global degradation — 13 occt-only ops opened via capability routing / static dispatch

English | [中文](2026-09-26-brepkit-global-degradation.zh.md)

## Problem

After clone/intersect were degraded to brepkit (2026-09-26), the user required extending the same pattern to **all** degradable occt-only ops: "只要是能够降级使用的，应该全部都要降级使用至至少要支持他呀，有没有历史 withhistory 并不重要。" An audit of `arg-spec.ts` found 48 `engines:['occt']` declarations; after excluding query/compat ops and mesh-only ops, 14 were candidates for degradation.

## Design decision: two reusable patterns

### Pattern 1 — clone mode (capability routing)
For ops whose implementation calls only L1 kernel methods with no occt-specific API:
- `arg-spec.ts`: `engines:['occt']` → `capabilities:['realCapabilityName']`
- Regenerate `api/generated/*.ts` via `gen-l3-surface.ts`
- Adapter `methods` declares the capability only when a real implementation exists (red line: declaration ⊆ instance, guarded by `engine-switch-p3.test.ts`)
- occt behavior zero-change (occt also has the same capability)

### Pattern 2 — intersect mode (static dispatch)
For ops with a `*WithHistory` path where brepkit only has the bare method:
- Remove `capabilities` gate → neutral op
- Inside op implementation, statically branch on `engineCapabilitySet(getBackends().config.brepCapabilities).has('xxxWithHistory')`:
  - Engine declares `*WithHistory` (occt) → history path (faceEvolution + roleTable)
  - Otherwise (brepkit) → bare kernel method, **no faceEvolution, no roleTable** (honest degradation, no fabricated identity mapping)
- No runtime try-catch fallback (BREP chain static determination red line)

## Changes (13 ops degraded)

| op | Pattern | Key detail |
|---|---|---|
| ellipsoid | clone | `makeEllipsoid`+`translate`; brepkit bbox Z query has precision issue (volume exact=8π), registered as known gap |
| makeBaseBox | clone | `makeRectangle`+`extrude`; adapter declared both (real impls existed but were unwired) |
| rotate | clone + impl fix | `rotateBrep` hard-coded `getOcctKernel().transform()` → switched to L1 `getBrepApi().transform()` |
| mirror | clone + thin override | handwritten thin override in `replicate.ts` shadowed generated version; both downgraded |
| applyMatrix | clone | `transform`+`generalTransform`; both adapters declared |
| healSolid | clone | `healSolid` already declared |
| chamfer | intersect | static dispatch: occt→`chamferWithHistory`, brepkit→bare `kernel.chamfer` |
| convexHull | clone | `hullFromPoints` (→`kernel.convexHull`); adapter declared + guard whitelist updated |
| section | clone | `sectionByPlane`+`makeCompound`; removed `getOcctKernel().IsNull` coupling; semantic diff: occt=edge/wire, brepkit=face |
| drill | clone | `makeCylinder`+`located`+`getBoundingBox`+`cut` |
| pocket | clone | `getSubShapes`+`surfaceCenterOfMass`+`uvBounds`+`surfaceNormal`+`makeFace`+`translate`+`extrude`+`cut` |
| boss | clone | same as pocket but `extrude(+normal)`+`fuse` |
| mirrorJoin | handwritten rewrite | original called OCCT-only `mirrorWithHistory`; rewritten to L1 `kernel.mirror`+`kernel.fuse`; roleTable rebuilt via centroid clustering |

## Not degradable (1 op)

- **split**: `splitBrep` directly calls `getOcctKernel().split(h, tools[])` for arbitrary tool shapes. brepkit L1 only has `splitByPlane` (single plane → 2 solids). Kept `engines:['occt']` with reason documented in arg-spec.

## Adapter capability declarations added

brepkit `methods`: `makeRectangle`, `extrude`, `transform`, `generalTransform`, `hullFromPoints`, `sectionByPlane`, `makeCompound`, `located`, `getSubShapes` (all real impls in `brepkitKernel.ts`, previously undeclared).

occt `methods`: `transform`, `generalTransform`, `sectionByPlane`, `makeCompound`, `located`, `getSubShapes` (previously bypassed by `engines:[occt]`, now required for capability routing).

`BrepMethodKind` union extended with new method names.

## Consequences

- 13 ops now pass on occt + brepkit 2.129.15/3.4.18/4.0.32 (bbox within 1% or registered as known geometric gap).
- occt zero regression: all ops behave identically on occt (gate changed from engines to capabilities, occt declares all required methods).
- brepkit outputs for chamfer/mirrorJoin/intersect have no face evolution (honest degradation); downstream selection/naming on these outputs will report `nameless shape` — same as occt behavior for clone.
- Three brepkit versions behave identically — all issues are in faijs adapter layer, not wasm kernel.

## Verification

- `multi-engine-op-parity.test.ts`: 180 parity combos + 21 error combos, mismatches=0.
- New regression tests: `brepkit-batchA-fix.test.ts` (1 case/6 ops), `brepkit-batchB-fix.test.ts` (8 cases), `brepkit-batchC-fix.test.ts` (6 cases).
- Guards: `engine-switch-p3` (10), `arg-spec-capabilities` (5), `evolution-declaration` (4) all pass.
- Existing: `brepkitKernel.test.ts` (75), `brepkit-clone-fix` (2), `brepkit-intersect-fix` (4), `brepkit-non-solid-fix` (10) all pass.
