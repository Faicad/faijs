# Agent Note: FCStd port M9 — Pad/Pocket Type semantics and the Body fuse chain (2026-09-17)

Status: implemented

English | [中文](2026-09-17-fcstd-m9-pad-pocket-types.zh.md)

## Decision 1: Pad/Pocket `Type` enum parsed via two tables (M9.1)

`App::PropertyEnumeration` is persisted in FCStd as either a **string label or an integer index** (both seen in the corpus). `featureTypeOf()` parses per the Pad/Pocket enum tables:

- Pad:    0=Length 1=UpToLast 2=UpToFirst 3=UpToFace 4=TwoLengths
- Pocket: 0=Length 1=ThroughAll 2=UpToFirst 3=UpToFace 4=TwoLengths
  (the two tables differ at index 1 — Pocket is ThroughAll; source: FreeCAD Pad.h/Pocket.h)

Missing `Type` attribute = Length (FreeCAD default). **Out-of-range index / unknown label → `unknown`, never silently treated as Length** (the G4 violation is eliminated).

## Decision 2: semantic mapping (M9.2/M9.3)

- `Length` → single-segment extrude (unchanged)
- `TwoLengths` → `+Length` / `−Length2` two-segment extrude then `cad.union`, with intermediate variables `<out>__pos` / `<out>__neg` for mapping lookup
- `UpToLast/UpToFirst/UpToFace/ThroughAll` → **explicit baked + reason** (`pad-type-<T>-unsupported` / `pocket-type-<T>-unsupported`), never guessing the length from the bbox
- Pocket's `Midplane` stays explicitly baked (`pocket-midplane-unsupported`)

## Decision 3: D-C landed — same-Body chained fuse (M9.4)

codegen parses `PartDesign::Body`'s `Group` (`Property > LinkList > Link*`, in Body.Group order) to establish member ownership; the first translated feature is the chain base, after which Pad-like features do `cad.union(prev, next)` and Pocket/Cut-like features `cad.subtract` from the chain head.

**GOTCHA (double-subtract guard)**: Pocket's own translate already emits `cad.subtract(base, cut)` (when BaseFeature resolves to the chain-head variable). In that case the chain head advances directly to Pocket's output variable, and you must **not** append another subtract against the chain head — it would cut twice. The chained subtract is only added when Pocket's base does not point at the chain head (e.g. a stray Part feature).

`cad.group` is no longer used to combine same-Body features (that is assembly semantics; M10 uses it across Bodies).

## Baseline change (reason stated)

PadTest e2e golden: translated **6→4**, baked 4→6. The former Pad001 (UpToFace) and Pad002 (UpToLast) were silently translated by Length (exactly the G4 violation M9 eliminates); they are now explicitly baked with a reason. This is a behavior correction, not a regression.

## Corpus gap

The planned `TwoLengthsPad*.FCStd` three samples are **not in the local corpus** (`D:/Faicad/FreeCAD/data/tests/` only has Crank/PadTest/PocketTest/ProjectTest). Semantic tests use synthetic fixtures instead (`feature-type.test.ts`, 12 cases covering both label and index forms).

## Tests

- `feature-type.test.ts`: Type enum dual form + TwoLengths two segments + every baked reason
- `codegen.test.ts`: same-Body three-feature chain (Pad→Pocket→Pad001) yields exactly 2 chain-level ops, no double subtract, no `cad.group`
- e2e three-sample golden all green (baseline 4/6/3 with reason noted)
