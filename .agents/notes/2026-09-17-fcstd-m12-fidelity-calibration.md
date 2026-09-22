# Agent Note: FCStd port M12 — fidelity calibration and acceptance report (2026-09-17)

Status: implemented

English | [中文](2026-09-17-fcstd-m12-fidelity-calibration.zh.md)

## M12.2: all 4 L1 located (triples)

| File | Sketch | Cause | Constraint composition |
|---|---|---|---|
| `src/Mod/CAM/CAMTests/Drilling_1.FCStd` | Sketch | unsupported-constraint | InternalAlignment×8 (B-spline/ellipse alignment) |
| `src/Mod/CAM/DemoParts/hole_puzzle.fcstd` | Sketch005 | delta=1.0e+2 (wrong solution) | Coincident×5+H/V+Angle |
| `src/Mod/CAM/Tools/Shape/taperedballnose.fcstd` | Sketch | delta=1.7e-1 | 21 mixed constraints incl. Symmetric |
| `src/Mod/Sketcher/SketcherTests/TestSketchCarbonCopyReverseMapping.FCStd` | Sketch001 | delta=1.0e+1 | incl. Symmetric/Angle×5 |

**InternalAlignment(15) not upgraded to P0**: only Drilling_1 hits it (8 occurrences concentrated in a single sketch serving B-spline internal alignment); the upgrade gain is 1/126 sketches and requires implementing B-spline/ellipse geometric-alignment solving — cost/benefit does not support it. Keep explicit fallback + reason.

**Note**: the same Drilling_1 sketch is graded differently between the locator script (parses external geometry → L1) and the converter (pre-judges L2 while external geometry is locked) — the G9 asset test pins the converter's real behavior; the two naturally agree after M13.3 unlocks external geometry.

## M12.1: T1 calibration (125 converged sketches)

Non-zero delta is bimodal: 12 in 1e-16~3.6e-15 (float noise, truly converged), 3 in 1.7e-1~1e2 (wrong solutions, the delta-exceeds trio above), and **the 1e-9~1e-6 middle band is empty**. Conclusion: `T1 = 1e-6` stays — lowering the threshold to 1e-8 changes no classification, but there is now a distribution basis (`scripts/calibrate-t1.ts` is re-runnable) instead of a hard-coded guess.

## M12.3: V6 re-runnable (currently FAIL, recorded honestly)

`scripts/verify-geometry.ts` (volume/centroid/bbox, all computed by divergence theorem over triangle meshes, `getVolume` disabled — BRepGProp exact integration would alias with the mesh caliber). Measured PadTest:

- truth (Tip=Pad002's .brp) = 48199 mm³ vs rebuilt = 230000 mm³, relErr 377%
- **FAIL is a correct diagnosis, not a script defect**: rebuilt contains only Pad (the base feature); Pad001 (UpToFace)/Pad002 (UpToLast) are explicitly baked per M9 — the product is inherently smaller than the original model. The gate can only pass after coverage improves (M13); the current gate for V6 PASS is relVol<1% and bboxDiag delta<0.5.

**Gotcha archived**: FreeCAD-written .brp's first line is `DBRep_DrawableShape`; `CASCADE Topology V1` is on the second line — judge with `includes`, not `startsWith`.

## M12.4: V5 dual caliber (re-runnable via `scripts/coverage-report.ts`)

- Caliber ① all objects: 1838 (Python lineage 990, 53.9%)
- Caliber ② non-Python: 848, of which whitelist+datum+sketch covers 556 = **65.6%**
- Uncoverable mainstays: Fem::Constraint* family, TechDraw, Part2DObjectPython

## M12.5 (V4 manual sampling): left to the user

The `freecad/` shadow already guarantees byte-level fidelity (V1); manual verification requires opening ≥3 samples in a real FreeCAD — cannot be automated, not executed, honestly left blank.

## Tests

- New `packages/tests/faijs/fcstd/fcstd-g9-contour.test.ts` (real L1-corpus contour.json landing + G7 consistency unchanged)
- New re-runnable scripts: `scripts/locate-l1-sketches.ts` / `calibrate-t1.ts` / `verify-geometry.ts` / `coverage-report.ts`
- fcstd 13 files / 97 cases all green; e2e unaffected (no source behavior change in this phase)
