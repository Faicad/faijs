# Agent Note: CadQuery free-function `imprint` via `fuseAll`

Status: implemented

English | [中文](2026-10-04-cadquery-imprint-fuseAll.zh.md)

## Problem

CadQuery 2.8.0 exposes a free-function `imprint(*shapes)` (`occ_impl/shapes.py:6774`) that faijs must support through its occt-wasm BREP chain. occt-wasm does not expose `BOPAlgo_Builder` directly, which is the primitive CadQuery uses internally, so faijs needs an equivalent primitive that reproduces `imprint`'s observable topology for the upstream parity suite.

## Decision

Implement `imprint` using occt-wasm's `kernel.fuseAll` (`BRepAlgoAPI_Fuse`).

For the case `test_imprint` exercises — non-overlapping (touching/disjoint) solids — `BRepAlgo_Fuse` and `BOPAlgo_Builder` yield identical topology: solids stay separate and coincident faces are unified. `fuseAll` is the closest primitive occt-wasm exposes.

A bidirectional `split` + compound approach was rejected (see `## Alternatives considered`): it preserves coincident faces (f12) instead of merging them to CadQuery's `.Faces()` count (11).

## Ref STEP face-count discrepancy

The ref STEP files show f12 for `imprint(b1, b2)`, while CadQuery's `.Faces()` returns 11. This is a STEP export artifact: STEP preserves internal/shared faces that `.Faces()` excludes. The candidate STEP (from faijs) also preserves these faces, so topology comparison matches (f12 vs f12). The numeric values (vol, com, bbox) are identical.

## What was unblocked

6 of 12 `imprint`-blocked variables: `test_imprint__{b1,b2,b3,res,res_glue_full,res_glue_partial}`.

## What remains blocked

- 4 `test_imprinting` variables — assembly-level `imprint` (B5 scope, needs the Assembly API).
- 2 `test_imprint__{b1_imp,b3_imp}` — need `History.images()` (G-C18).

## Alternatives considered

- **`BOPAlgo_Builder` directly**: the exact primitive CadQuery uses, but occt-wasm does not expose it; not available to the BREP backend. Rejected for availability.
- **Bidirectional `split` + compound**: split each shape against all others via `BOPAlgo_Splitter`, then compound the fragments. This preserves coincident faces (f12 instead of f11) but does not match CadQuery's `.Faces()` count (11), which `BOPAlgo_Builder` merges down to. Reverted to `fuseAll`.
- **`kernel.fuseAll` (`BRepAlgo_Fuse`)** (chosen): identical topology to `BOPAlgo_Builder` for the supported case, and exposed by occt-wasm.

## Consequences

Unblocks 6 of 12 `imprint`-blocked variables in parity tests. The remaining `imprint`/`imprinting` variables move to B5 (Assembly API) and G-C18 (`History.images()`). The STEP face-count discrepancy is handled as an export artifact, not a topology mismatch.