# Agent Note: pure-2D geometry port and unified placement pipeline

Status: implemented

English | [中文](2026-09-27-2d-geometry-and-bridge.zh.md)

## Problem

faijs had no pure, kernel-free 2D geometry layer. `cad.profile` built 3D edges directly from 2D segment data by bypassing geometry (`profile.ts` loop-to-wire), with its own ad-hoc hole classification (parent chain + `depthOf` + area comparison). The 2D→3D bridge primitives the plan needs (`sketchOnPlane`/`sketchOnFace`/`punchHole`) had zero implementation, and the kernel contract (`BrepEngineApi`) does not expose any curve-handle system. Growing the 3D moulding story on this base would mean duplicating 2D geometry logic in the api layer.

## Decision

core gains a kernel-independent pure-2D geometry base under `packages/core/src/geometry2d/`, ported from brepjs (Apache-2.0, attribution in file headers):

- `curve2d.ts` — the `Curve2dObj` family (line / circle / ellipse / bezier / bspline / trimmed), evaluate / tangent / bounds, constructors, transforms, serialization, `intersectCurves2dFn`, `CurveBBox2d` / `createCurveBBox2d`; the brepjs `__bk2d` discriminant is renamed `kind2d` (and `__bk2d_bbox` → `kind2d_b`) to faijs-style names.
- `bbox2d.ts` — pure-data `BBox2d` helpers.
- `blueprint.ts` / `compound-blueprint.ts` / `blueprints.ts` — `Blueprint` / `CompoundBlueprint` / `Blueprints` as pure object containers (no kernel handles, no `dispose()`).
- `organise.ts` — `organiseBlueprints` classification (`bbox`-overlap grouping + `isInside` nesting probe via `intersectCurves2dFn`).
- `adapt.ts` — structural adapter from the legacy `cad.profile` segment shape (line / arc) to `Curve2dObj`, preserving `ccw` direction and full circles.

`cad.profile` (F2) consumes this unified pipeline: `buildProfileShape` now converts each contour to a `Blueprint` and runs `organiseBlueprints`, then builds 3D line/arc/bezier edges from the classified curves. The old ad-hoc parent-chain / `depthOf` / area-comparison classification is deleted.

2D→3D bridging (`geometry2d/bridge/`) is the same base's placement step later — per plan the bridge keeps alive the occt-only primitives (`liftCurve2dToPlane` / `draftPrism`) on the occt platform surface and combination at composition time.

Nested-loop semantic is a decision, not an accident: nested loop = hole, disjoint loop = independent island, odd depth = hole, even depth = island again. `organiseBlueprints` reproduces this, also enforced as parity by the migrated profile regression tests. `ccw` is a geometric-direction field, not metadata: the adapter derives arc sweep per-direction (CW forward sweep = `startAngle − endAngle`) and keeps full circles as real `circle` curves (the 3-point construction degenerates through the singular start/end point).

`organiseBlueprints` replaces brepjs's Flatbush spatial index with a pure union-find over `bbox`-overlap — no Flatbush dependency, pure TS, no kernel handle. The wire assembly for planar faces reuses `makeWire` and rebuilds real arc edges from three on-arc points (`makeArcEdge`), bezier via `makeBezierEdge`; sampled polylines are used only for non-analytic curves (ellipse / bspline).

## Alternatives considered

- **Port Flatbush in as a core dependency.** Rejected: heavier than needed; the same classification is reachable with a pure bbox-overlap union-find that the migrated tests already pin, and any future change is local to `organise.ts`.
- **Keep `cad.profile`'s old parent-chain classification.** Rejected: it is ad-hoc and does not generalize to arbitrary `Curve2dObj`-based inputs (`cad.draw` / sketch) that must share the same pipe.
- **Build the full bridge SKU in this round.** Rejected: the placement acceptance needs the pure-2D base to land and be regression-safe first; the bridge is a follow-on on the same base.

## Consequences

- core exposes `@faicad/faijs/geometry2d/*` subpath exports.
- The profile classification lives once, in `organiseBlueprints`, shared by `cad.profile` and later `cad.draw` / sketch-family inputs.
- Full circles, `ccw:false` arcs, and multi-island / hole-in-island contours all pass the migrated tests (33 geometry2d + 5 profile multi-island + the arc GOTCHA guards, plus multi-engine parity `mismatches=0`).
- The pure-2D base is the prerequisite for `geometry2d/bridge/` placement
- `geometry2d/bridge/` (E2) lands the plane-lift composition: `plane.ts` (frame `makePlane`/`namedPlane`/`lift`) and `lift-on-plane.ts` (`liftCurve2dToPlane`/`curvesAsEdgesOnPlane`/`assembleWire`). It types its kernel as `Pick<BrepEngineApi, makeLineEdge|makeArcEdge|makeBezierEdge|makeWire>` so callers pass `getBrepApi()` with no casts; the module imports the kernel contract but never `api/`.
- `cad.sketchOnPlane` (E2+op) lands: same contour-loop input as `cad.profile`, placed on a named or explicit `{origin, normal, xAxis}` plane; `as:'face'`/`'wire'`; registered in the cad namespace + symbol table.
- The pen layer (`BaseSketcher2d`) lives in core `geometry2d/pen-sketcher.ts` for now — the pure-object port of the brepjs sketcher — the interim home for the C-group DSL; the eventual move to `@faicad/faijs-draw` is a mechanical re-home, since the pen and the canned factories only depend on `geometry2d/*`.
- SVG-style elliptical arcs land as `geometry2d/svg-ellipse.ts` (`normalizeEllipseRadii`/`convertSvgEllipseParams`/`makeEllipseArcFromSvgParams`), emitting a `TrimmedCurve2d` over an `Ellipse2d` (parameter = sweep angle). This unblocks `ellipseTo`/`ellipse`/`halfEllipseTo`/`halfEllipse` on the pen.
- C2 lands as `geometry2d/blueprint-sketcher.ts` (`BlueprintSketcher` → `done(): Blueprint`) and `canned-blueprints.ts` (`polysidesBlueprint` / `roundedRectangleBlueprint`, circular + elliptical corners). `BlueprintSketcher` still inherits the base `close(): Curve2dObj[]`; the closed-contour `Blueprint` is obtained by wrapping `new Blueprint(pen.close())`.
- The `@faicad/faijs-draw` package (C3 base) exists: `src/draw.ts` offers the fluent `draw(session)` entry plus a `draw.rectangle`/`draw.roundedRectangle`/`draw.polygon`/`draw.circle` factory namespace over core's `geometry2d`, with `src/drawing-factories.ts`; workspace/tsconfig/vitest-alias and all publish gates (order/lockstep/ghost-deps/export-jsdoc) pass, and `npm run build` emits a clean dist. The script runtime registration of a `cad.draw` symbol is deferred.
- The shared placement core is extracted as `buildShapeFromBlueprints(kernel, plane, blueprints, as)` in `core/api/sketch-on-plane.ts`, and `buildSketchOnPlaneWith` now converts `ProfileLoop[] → Blueprint[]` then calls it. The placement helper must stay in `api/` (it returns a `Shape` and imports `fromBrep`/`solidToShape`); the `geometry2d/bridge` modules are forbidden from importing `api/`. A core e2e proves the draw-package contour shape (a `roundedRectangleBlueprint` `Blueprint`) placed via `buildShapeFromBlueprints` and kernel-`extrude`d yields a positive-volume solid — the F6 "draw entrance → shared placement → extrude" seam.
- C4 projection lands in the draw package (`src/projection.ts`): `projectPointToPlane`/`projectWire`/`drawFaceOutline`/`drawProjection` project 3D wires onto a plane frame (named plane or explicit frame) into a plotted `Blueprint`. The projection is the strict inverse of core bridge `liftPointToPlane` (`(p−o)·xDir/(p−o)·yDir` on the orthonormal frame), is kernel-free, and imports core `geometry2d` only (plane frame from `@faicad/faijs/geometry2d/bridge/plane`). A roundtrip test pins the inverse-equivalence GOTCHA; an XZ-frame test documents that a wire lying flat in the XY plane projects flat on the XZ frame (2D y is the frame's y, i.e. world Z for wires that actually live there).
- The draw primitive factory set is complete and reachable both as named exports and as `draw.xxx` namespace members: `rectangle`, `roundedRectangle`, `polygon`, `circle`, and `ellipse` (a full CCW `makeEllipse2d` single-curve contour exposing center/radii/rotation). The ellipse contour destructures into a sampled polyline at placement time, mirroring the `circle` single-contour path.
- A precise `parameterOfPoint(c, px, py, maxRatio=0.1)` lands in core `geometry2d/curve2d` (exposed at `@faicad/faijs/geometry2d`): an N=80 coarse grid refined by Newton onto the perpendicular foot `(curve−P)·tangent=0`, returning `null` past a geometric-extent ratio guard. On a radius-5 circle it converges to ~1e-9 (versus ~0.06 for the raw grid), which is the hook D1/D3 (2D boolean / corner / offset work) was waiting for; the standalone `refineParam` kept its original 80-sample behavior.
- GOTCHA (array-frame coords): `.fai.js` plane literals hand the frame as **arrays** (`{origin:[10,0,0],normal:[0,0,1]}`); `toVec3` must normalize the array form. Passing `{x,y,z}` only yields `undefined` coords → NaN wire → occt `makeFace` `CONSTRUCTION_FAILED`.