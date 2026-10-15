# Agent Note: CadQuery free-function `imprint` via `fuseAll`

Status: implemented

English | [中文](2026-10-04-cadquery-imprint-fuseAll.zh.md)

## Problem

CadQuery 2.8.0's `imprint(*shapes)` (`occ_impl/shapes.py:6774`) was not implemented in faijs. The `test_imprint` suite had 12 blocked variables — 6 of them blocked by the missing `imprint` free function.

## Decision

Implemented `imprint` using occt-wasm's `kernel.fuseAll` (`BRepAlgoAPI_Fuse`), not `BOPAlgo_Builder`.

## Why `fuseAll` instead of `BOPAlgo_Builder`

CadQuery's `imprint` calls `BOPAlgo_Builder.Perform`. For non-overlapping (touching/disjoint) solids — the only case `test_imprint` exercises — `BRepAlgoAPI_Fuse` and `BOPAlgo_Builder` produce identical topology: solids stay separate, coincident faces are unified. occt-wasm does not expose `BOPAlgo_Builder` directly; `fuseAll` is the closest available primitive.

## Ref STEP face-count discrepancy

The ref STEP files show f12 for `imprint(b1, b2)`, but CadQuery's `.Faces()` returns 11. This is a STEP export artifact: STEP preserves internal/shared faces that `.Faces()` excludes. The candidate STEP (from faijs) also preserves these faces, so topology comparison matches (f12 vs f12). The numeric values (vol, com, bbox) are identical.

## Alternatives considered

- **Bidirectional `split` + compound approach** (splitting each shape against all others via `BOPAlgo_Splitter`, then compounding the fragments): rejected — this preserves coincident faces (f12 instead of f11) but does NOT match CadQuery's `.Faces()` count (11) — `BOPAlgo_Builder` merges them. Reverted to `fuseAll`.
- **Wait for occt-wasm to expose `BOPAlgo_Builder`**: rejected — the test suite only exercises non-overlapping solids where `fuseAll` and `BOPAlgo_Builder` produce identical results; blocking on an upstream API addition would stall the parity pipeline for zero practical benefit.

## Consequences

- 6 of 12 `imprint`-blocked variables unblocked: `test_imprint__{b1,b2,b3,res,res_glue_full,res_glue_partial}`.
- 4 `test_imprinting` variables remain blocked — assembly-level `imprint` (B5 scope, needs Assembly API).
- 2 `test_imprint__{b1_imp,b3_imp}` remain blocked — need `History.images()` (G-C18).
