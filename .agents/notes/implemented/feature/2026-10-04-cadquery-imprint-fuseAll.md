# B2-1: CadQuery free-function `imprint` via `fuseAll`

## Decision

Implemented CadQuery 2.8.0's `imprint(*shapes)` (`occ_impl/shapes.py:6774`) using occt-wasm's `kernel.fuseAll` (`BRepAlgoAPI_Fuse`), not `BOPAlgo_Builder`.

## Why `fuseAll` instead of `BOPAlgo_Builder`

CadQuery's `imprint` calls `BOPAlgo_Builder.Perform`. For non-overlapping (touching/disjoint) solids — the only case `test_imprint` exercises — `BRepAlgoAPI_Fuse` and `BOPAlgo_Builder` produce identical topology: solids stay separate, coincident faces are unified. occt-wasm does not expose `BOPAlgo_Builder` directly; `fuseAll` is the closest available primitive.

A bidirectional `split` + compound approach was also tried (splitting each shape against all others via `BOPAlgo_Splitter`, then compounding the fragments). This preserves coincident faces (f12 instead of f11) but does NOT match CadQuery's `.Faces()` count (11) — `BOPAlgo_Builder` merges them. Reverted to `fuseAll`.

## Ref STEP face-count discrepancy

The ref STEP files show f12 for `imprint(b1, b2)`, but CadQuery's `.Faces()` returns 11. This is a STEP export artifact: STEP preserves internal/shared faces that `.Faces()` excludes. The candidate STEP (from faijs) also preserves these faces, so topology comparison matches (f12 vs f12). The numeric values (vol, com, bbox) are identical.

## What was unblocked

6 of 12 `imprint`-blocked variables: `test_imprint__{b1,b2,b3,res,res_glue_full,res_glue_partial}`.

## What remains blocked

- 4 `test_imprinting` variables — assembly-level `imprint` (B5 scope, needs Assembly API).
- 2 `test_imprint__{b1_imp,b3_imp}` — need `History.images()` (G-C18).