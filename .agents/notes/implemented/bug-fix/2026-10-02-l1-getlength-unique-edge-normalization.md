# Agent Note: L1 `getLength` normalizes to the sum of unique-edge arc lengths

Status: implemented

English | [中文](2026-10-02-l1-getlength-unique-edge-normalization.zh.md)

## Problem

`BrepEngineApi.getLength(shape)` is a single L1 method backed by two engines, and on a
solid the two disagree by more than an order of magnitude: occt returns 280 for a
20×10×5 box, brepkit returns 20. Neither is the solid's total edge length.

- **occt** passes straight through to `BRepGProp::LinearProperties`, whose default
  `SkipShared=false` walks by **face** and counts each shared edge once per adjacent
  face, so a solid yields the sum of its face perimeters (280 = 2×140), not an arc
  length. This is the native OCC default: real OCC (OCP) and opencascade.js 1.1.1 both
  return 24 for a unit box; only `SkipShared=true` gives 12. occt-wasm is a faithful
  reproduction, not a bug.
- **brepkit** dispatches with a `getEdgeCurveType`-then-`wireLength` probe; the first
  branch also succeeds for a solid, a face and a wire, so it returns the **first edge's**
  length, which drifts with build history (20 for one box, 10 for another; 20 for a
  two-edge wire whose true length is 15).

Two doc comments assert behaviour the engines do not have. `api/measurement/index.ts`
claims "both engines, one measure". `faijs-cadquery/src/shape-class.ts` claims a
`Shape.Length()` method that does not exist in CadQuery 2.8.0 — `Length` is defined only
on `Mixin1D` (Edge/Wire), and `Solid.Length` raises `AttributeError`.

## Decision

`getLength(shape)` means **the sum of the arc lengths of the shape's unique edges**,
implemented identically by both adapters. For an edge this is its own length; for a wire
the sum of its edges; for a face its boundary; for a solid every edge; for a compound the
sum over sub-solids. Target values for the 20×10×5 box: solid 140, face 30, wire 15,
compound of two boxes 152 — the same on both engines.

- occt adapter: bracket a `getSubShapes(shape, 'edge')` walk with the wasm arena
  `checkpoint()` / `releaseSince(mark)` pair, summing each edge's `getLength`.
- brepkit adapter: sum `api.getSubShapes(shape, 'edge')` through `api.curveLength`.
- brepkit's `getSubShapes(compound, 'edge')` currently returns an empty list; it gains
  the missing `'edge'` branch so a compound is not silently reported as 0.
- faijs-cadquery's `lengthOf` reads the raw occt kernel rather than the L1 adapter, so it
  performs the same normalisation in its class layer; `shape-class.test.ts` pins
  `lengthOf(unitBox) == 12`.

For edge and wire this equals CadQuery's `Edge.Length()` / `Wire.Length()` bit for bit,
so parity is not broken. For face, solid and compound it is an extension on shapes
CadQuery leaves undefined, and its value equals the `sum(e.Length() for e in
shape.Edges())` a CadQuery user would write by hand.

## Alternatives considered

- **Narrow the domain to edge/wire and throw for everything else.** Closer to CadQuery's
  class design, where `Length` lives on `Mixin1D`, but it forces both adapters to add
  shape-type dispatch plus a new error code, pushes a summation into every upper-layer
  consumer (`measurement.length`, `lengthOf`, the vendored `measureLength`), and turns
  `getLength(solid)` from a number into a throw — a breaking change. The normalisation
  route already satisfies L1's core requirement, that both engines agree, without a break.
- **Leave the kernels alone.** Accepts that one L1 method returns 280 on one engine and
  20 on the other, contradicting D5 ("the core surface only carries what both engines
  have") and the measurement op's stated contract.

## Verification

- Raw → normalized on the box fixture (20×10×5): occt 280 → 140, brepkit 20 → 140; a
  compound of two boxes 304 / 20 → 152 on both; `Σ face getLength` = 280 on both engines
  (the per-face total agrees, so a single face differs only by enumeration order).
- `packages/core/src/brep/engine/getlength-domain.probe.test.ts` asserts those values on
  both engines; `measurement-script.test.ts` and `api/generated/measurement.test.ts` pass
  with 140; the faijs-cadquery suite is 383/383 and `shape-class.test.ts` pins
  `lengthOf(unitBox) == 12`; typecheck adds no error.
- Unrelated pre-existing failures in the full core run: 13 brepkit multi-version tests
  (the gitignored `_test-kernels/` packages are absent) and one `fontRegistry.node-esm`
  spawn `EBUSY`.

## Consequences

- Every L1 `getLength` consumer — sketch line length, the `measurement` script op, the
  vendored `measureLength`, faijs-cadquery's `lengthOf` — now sees the unique-edge sum;
  solids and compounds change from the old double count (280) to the single count (140).
- `getLength(solid)` is O(E) kernel calls instead of O(1); a non-hot path.
- brepkit's `getSubShapes(compound,'edge')` now returns real edges. The only other
  consumer route is `brep-topology.ts`'s `getEdges(shape)`, which gains edges on
  compounds where it previously got none — matching what occt already returned.
- `api/generated/measurement.ts` needed no edit: it flows through
  `getBrepApi().getLength`.
