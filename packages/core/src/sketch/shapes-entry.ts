/**
 * @faicad/faijs/sketch/shapes — environment-agnostic pure-function surface of
 * the sketch shape model.
 *
 * Everything here is plain TS over 2D points: no kernel, no solver, no wasm
 * loader, and — crucially — **no** `op.js` (the `cad.sketch` execution chain,
 * whose static closure reaches `api/sketch-on-plane.js` → `brep-ops.js` →
 * `occt-kernel/occtKernel.js` → `occt-wasm`).
 *
 * Hosts that only need to *build / preview / emit* sketch shapes (e.g. the
 * weapp main thread) import this entry instead of `@faicad/faijs/sketch`,
 * which statically re-exports `createPlanegcsSolver` (→ `@salusoft89/planegcs`)
 * and the cad.sketch op chain.
 *
 * Constraint: nothing in this module's dependency graph may be
 * platform-specific. `shapes.js` imports only types, `bspline.js` imports
 * nothing — this entry adds no edges.
 */
export {
  SketchShapeError,
  nextShapeTag,
  rectCorners,
  regularPolygonVertices,
  slotOutline,
  trapezoidCorners,
  clampedUniformKnots,
  expandShapes,
  arcSweep,
  arcPoints,
  shapeHandles,
  dragShapeHandle,
  handleForGeomControl,
  refsOfConstraint,
} from './shapes.js'
export type {
  Pt2,
  SketchMode,
  ShapeBase,
  SketchShape,
  ShapeSpan,
  ExpandedShapes,
  ShapeHandleKind,
  ShapeHandle,
  GeomControl,
} from './shapes.js'
export { evalBSpline, sampleBSpline, bsplineToSegments } from './bspline.js'
export type { BSPole, BSplineCurveData } from './bspline.js'
