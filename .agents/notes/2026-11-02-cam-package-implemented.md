# Agent Note: New `@faicad/cam` package (BREP.io CAM kernel port)

Status: implemented

English | [中文](2026-11-02-cam-package-implemented.zh.md)

## Problem

Port BREP.io's CAM functionality to the 3d_editor web front end (weapp phase 2). The
algorithm kernel lives in a new faijs `@faicad/cam` declarative-library package: CAM
declarations go into sceneScript (replayable and AI-controllable), execution reuses a new
faijs worker instruction `camGenerate` (BREP handles never leave the worker), and results
are collected back to the main thread through `camBuild` — they do not enter the scene
tree and add no undo entries.

## Decision

Add a `packages/cam` workspace package (version 0.45.19, on the family version line):

- Skeleton mirrors sheetmetal: `faijs.autoLift=false`, `peerDependencies: { "@faicad/faijs": "^0.45.0" }`,
  a single entry `exports: { "." }`, and build =
  `tsc -p tsconfig.build.json && node ../../scripts/fix-import-extensions.mjs dist`.
- Only one third-party dependency, `clipper-lib@6.4.2` (it ships no type declarations, so
  `src/clipper-lib.d.ts` carries a single line `declare module 'clipper-lib'`).
- Root `package.json`: insert `packages/cam` into the workspaces array after
  `packages/sheetmetal`, and `npm run build -w @faicad/cam` into the build chain after
  sheetmetal.
- Re-ran `node scripts/gen-importmap.mjs`: cdn/versions.json and friends gain an
  `@faicad/cam@0.45.19` pin.

## API surface (everything exported from src/index.ts)

- Declaration entry points (fai-script side): `cam.machine` / `cam.stock` /
  `cam.op.roughing` / `cam.op.surfacing` (lib.ts → the module-level `_current` collector in
  collect.ts, mirroring the fai-animation runtime pattern;
  `import type { Shape } from '@faicad/faijs/browser'`).
- Sole worker-side entry point: `generateToolpathForDeclaration(op, target, machine)` +
  `resolveFaceTriangles(op, shape, triangles)` (faces: `undefined` / `'all'` → whole part;
  `number | number[]` → filtered by `faceRanges`, hard-throwing when there is no
  `faceRanges` or the selection is empty; arrays of entity references hard-throw and require
  the host to pre-resolve them into face indices).
- Algorithms: `generateSurfacingToolpath` (analytic three-contact ball-nose solution +
  TriangleFootprint XY spatial hash + adaptive sampling + serpentine linking; ball-nose only
  this phase), `generateRoughingToolpath` (shadow-loops constant-height roughing, clipper
  union/offset), `generateGcodeForCamToolpathProgram` + `combineCamToolpathPrograms`
  (G-code post-processing), `flattenCamToolpathProgram` (the replay/simulation data layer),
  `makeStockMesh` (box/cylinder/custom), and `CamMachineProfile` / `CamStockProfile`
  defaults plus normalization.

## Behaviour notes (recorded in tests)

- Coordinates: `toMachinePoint` is the identity — 3d_editor is +Z-up, so BREP.io's
  `[x,y,z]→[x,z,y]` swap is unnecessary.
- Empty-result semantics: any internal algorithm failure returns an empty program plus
  warnings and never throws outward (even the surfacing raster-density gate, whose throw is
  converted to a warning inside the main try/catch).
- roughing produces **one continuous path** end to end (makeRoughingContinuousPath merges
  every level); `summary.levelCount` is the number of slices; the path's z lands at each
  slice's bottomZ (buildDepthLevels semantics: topZ exclusive, bottomZ inclusive).
- With gcode `tokenSpacer=false` the spindle word is `M3S12000` (M3 first, then S).
- Test fixture note: `makeBoxMesh(size, center=[0,0,0])` gives a box with z∈[-5,5]; pass
  `center=[0,0,5]` explicitly when z∈[0,10] is needed.

## Verification

- 10 test files / 82 cases all green (`vitest run -w @faicad/cam`).
- typecheck / lint / build pass; `check-api-test-coverage --package=cam` passes (77 L1
  exports, 16 L2 APIs, zero gaps, including a dedicated api-coverage.test.ts).
- `check-workspaces-order` and `check-lockstep` pass (gen-importmap has been re-run).
