/**
 * @faicad/faijs-sketch — faijs sketch & constraint capability library.
 *
 * The canonical sketch model (§4) plus:
 * - `solveSketch` — canonical entry to the planegcs pipeline;
 * - `sketchFaces` — solve + contour + core face construction;
 * - the FCStd solve pipeline (`SketchSolver` / `extractContours` / `classifySketch`)
 *   consumed by `@faicad/faijs-fcstd`;
 * - the `cad.sketch` script-face op and its `cad`-namespace merge helpers.
 *
 * Node hosts import the wasm path resolver from `@faicad/faijs-sketch/node`;
 * browser hosts inject wasm bytes through `HostPorts.assets`.
 */

// ── canonical model (§4) ──
export type {
  At, Ref, SketchGeom, SketchConstraint, SketchConstraintKind, SketchInput,
  SolveStatus, SolveOutcome,
} from './canonical.js'

// ── projection table (§4.5) ──
export {
  SketchProjectionError,
  atToFreeCad, atFromFreeCad, atToCadQuery, atFromCadQuery,
  buildTagIndex, refToFreeCad,
  toFreeCadGeoms, fromFreeCadGeoms,
  toFreeCadConstraints,
  CONSTRAINT_KIND_TO_CADQUERY, CADQUERY_TO_CONSTRAINT_KIND,
  constraintKindToCadQuery, constraintKindFromCadQuery,
} from './project.js'
export type { ProjectedConstraints } from './project.js'

// ── solve + faces ──
export { solveSketch } from './solve.js'
export type { SolveSketchOptions } from './solve.js'
export { sketchFaces, shapeFromSolved } from './faces.js'
export type { SketchFacesOptions } from './faces.js'

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

// ── cad.sketch op + namespace assembly ──
export {
  sketch, assertSketchParams, installSketchSolver, uninstallSketchSolver,
  setSketchDiagnosticSink, SKETCH_OP_NAME,
} from './op.js'
export type { SketchParams } from './op.js'
export {
  createSketchNamespace, mergeSketchNamespace, createSketchCadNamespace,
  registerSketchSymbols, unregisterSketchSymbols, SKETCH_OPS,
} from './namespace.js'