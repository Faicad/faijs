/**
 * @faicad/faijs/sketch — faijs sketch & constraint capability.
 *
 * The canonical sketch model (§4) plus:
 * - `solveSketch` — canonical entry to the planegcs pipeline;
 * - `sketchFaces` — solve + contour + core face construction;
 * - the FCStd solve pipeline (`SketchSolver` / `extractContours` / `classifySketch`);
 * - the `cad.sketch` script-face op.
 *
 * The cad namespace is now fully assembled inside `createApiNamespace()`;
 * hosts no longer need to merge/register sketch symbols. Solver wasm is
 * injected via `setSketchSolverInitFn()` (see `./solver-loader`).
 *
 * Node-only symbols (`planegcsWasmPath`, `createNodePlanegcsSolver`) are
 * deliberately NOT re-exported from this entry — `./node.js` statically
 * imports `node:module` / `node:path`, and a static re-export would drag
 * `node:*` into browser/worker bundles. They live on the dedicated
 * `@faicad/faijs/sketch/node` subpath (guarded by
 * `test/sketch/sketch-entry-browser.test.ts`).
 */

// ── canonical model (§4) ──
export type {
  At, Ref, SketchGeom, SketchConstraint, SketchConstraintKind, SketchInput,
  SolveStatus, SolveOutcome, ConflictDetail,
} from './canonical.js'

// ── projection table (§4.5) ──
export {
  SketchProjectionError,
  atToFreeCad, atFromFreeCad, atToCadQuery, atFromCadQuery,
  buildTagIndex, refToFreeCad,
  toFreeCadGeoms, fromFreeCadGeoms,
  toFreeCadConstraints, fromFreeCadConstraints,
  CONSTRAINT_KIND_TO_CADQUERY, CADQUERY_TO_CONSTRAINT_KIND,
  constraintKindToCadQuery, constraintKindFromCadQuery,
} from './project.js'
export type { ProjectedConstraints, UnmappedConstraint, FromFreeCadConstraints } from './project.js'

// ── solve + faces ──
export { solveSketch } from './solve.js'
export type { SolveSketchOptions } from './solve.js'
export { sketchFaces, shapeFromSolved } from './faces.js'
export type { SketchFacesOptions } from './faces.js'

// ── semantic shape surface (`cad.sketch({ shapes })`) ──
export {
  expandShapes, nextShapeTag, shapeHandles, dragShapeHandle, handleForGeomControl,
  refsOfConstraint,
  SketchShapeError,
  rectCorners, regularPolygonVertices, slotOutline, trapezoidCorners, clampedUniformKnots,
  arcPoints, arcSweep,
} from './shapes.js'
export type {
  SketchShape, SketchMode, ShapeBase, ShapeSpan, ExpandedShapes,
  ShapeHandle, ShapeHandleKind, GeomControl, Pt2,
} from './shapes.js'

// ── serialize dimension spec (`cad.sketch` unit-aware codegen) ──
export { shapesDimSpec, constraintsDimSpec, sketchDimSpec, contoursDimSpec } from './dim-spec.js'

// ── FCStd solve pipeline (consumed by the fcstd port) ──
export type { SketchSolver, FcstdSolveOutcome, ExternalFixedSeg } from './solver.js'
export { SUPPORTED_CONSTRAINT_TYPES, allConstraintsSupported } from './solver.js'
export { createPlanegcsSolver, PlanegcsSolver } from './planegcs-backend.js'
export type { PlanegcsSolverOptions } from './planegcs-backend.js'
export { extractContours } from './contour.js'
export type { Contour, ContourSeg } from './contour.js'
export { evalBSpline, sampleBSpline, bsplineToSegments } from './bspline.js'
export type { BSPole, BSplineCurveData } from './bspline.js'
export { anchorPoints, maxPointDistance, classifySketch } from './verify.js'
export type { SketchVerdict } from './verify.js'
export {
  ConstraintType, CONSTRAINT_NAMES, GeoId, PointPos,
} from './fcstd-types.js'
export type {
  FcstdSketchGeom, FcstdGeoRef, FcstdSketchCon, FcstdParsedSketch,
} from './fcstd-types.js'

// ── cad.sketch op ──
export {
  sketch, assertSketchParams, installSketchSolver, uninstallSketchSolver,
  setSketchDiagnosticSink, SKETCH_OP_NAME,
} from './op.js'
export type { SketchParams } from './op.js'
export {
  setSketchSolverInitFn, initSketchSolver,
} from './solver-loader.js'