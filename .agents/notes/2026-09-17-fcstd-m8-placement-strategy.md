# Agent Note: FCStd port M8 — Placement transform strategy (2026-09-17)

Status: implemented

English | [中文](2026-09-17-fcstd-m8-placement-strategy.zh.md)

## Decision: features build in sketch-local frame, re-placed as a whole after output (M8.3)

`cad.sketch` only builds faces in the local XY plane (normal +Z, `api/sketch.ts` contract), and `cad.extrude` extrudes along local +Z. Therefore a non-XY sketch **cannot** bake 3D coordinates into the contour — the choice:

1. Features (Pad/Pocket/Revolution…) all build in the sketch-local frame (unchanged);
2. codegen appends `cad.rotate_euler` + `cad.translate` after the feature's last call (order: rotate first, then translate), with rotation angles from that object's Placement quaternion.

**Why re-place as a whole instead of baking coordinates into the contour**: baking requires converting the extrude direction into an arbitrary 3D vector too (`cad.extrude`'s height is a scalar slot — `literals: [vec]` only makes sense in the local frame), while rotate/translate are existing brep ops with clear semantics and individually debuggable statements (alongside mapping.json).

## Measured calibration (do not change from memory)

- **Quaternion component order = (x, y, z, w)**: FCStd `Q0..Q3`, Q3 is the scalar. identity = (0,0,0,1).
- `quatToEulerXYZDeg` aligns case-by-case with `THREE.Euler('XYZ')` (`quat-euler.test.ts` uses THREE itself as the oracle, 8 cases covering all three PadTest placements). Matrix convention: `M = RX·RY·RZ` (row-major), `m[2] = +sinY` — the first implementation wrote `-sinY`, off by 180°, caught on the spot by the THREE-oracle test.
- Sketch-local Z in the sample set is always 0 (measured on PadTest's three sketches); non-zero Z has no "project to (u,v)" need — explicitly downgrade to L2 (`reason: sketch-geometry-off-plane`), never silently drop Z.

## GOTCHA (pitfall guard)

- `quatToMatrix` normalizes with `s = 2` (components already divided by the norm); do not multiply by `2/n` again — double scaling once made non-unit-quaternion tests fail.
- `rotate_euler`'s pivot defaults to the origin; FreeCAD Placement rotation is inherently about the origin (translation lives in p), so rotate precedes translate and neither takes a pivot — the order is not swappable.
- Corpus quaternions truncate to 12 digits (0.707106781187); calibration tolerance is ≤1e-5°, don't tighten it.

## Tests

- `placement.test.ts`: parsing + closed-form matrix solution (90°/180° per axis) + round-trip.
- `quat-euler.test.ts`: THREE oracle (GOTCHA archived).
- `placement-corpus.test.ts`: PadTest Sketch002 point-by-point on-plane + rigid distance preservation (skipIf without corpus).
- e2e three samples still fully green (`packages/tests/faijs/fcstd/fcstd-e2e.test.ts`).
