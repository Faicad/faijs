/**
 * @faicad/cq-compat — CadQuery API compatibility layer for faijs.
 *
 * Usage in .fai.js:
 *   import * as cq from '@faicad/cq-compat'
 *   let wp = cq.Workplane('XY')
 *   let wp1 = await cq.box(wp, 100, 80, 10)
 *   let wp2 = await cq.faces(wp1, '>Z')
 *   let wp3 = await cq.workplane(wp2)
 *   let result = await cq.hole(wp3, 5)
 *   let shape = cq.val(result)
 *
 * All methods are standalone functions taking Workplane as first argument
 * (transpiler converts method chains to this form).
 */

export {
  Workplane,
  add,
  box,
  sphere,
  wedge,
  cylinder,
  torus,
  cone,
  rarray,
  rect,
  circle,
  ellipse,
  polygon,
  extrude,
  revolve,
  loft,
  cutBlind,
  cutThruAll,
  hole,
  cboreHole,
  cskHole,
  threadedHole,
  faces,
  edges,
  vertices,
  solids,
  workplane,
  center,
  pushPoints,
  moveTo,
  move2D,
  lineTo,
  line,
  vLine,
  hLine,
  vLineTo,
  hLineTo,
  polyline,
  close,
  wire,
  face,
  vertex,
  threePointArc,
  sagittaArc,
  radiusArc,
  tangentArcPoint,
  spline,
  translate,
  rotate,
  mirror,
  faceCompound,
  edgeCompound,
  Location,
  isLocation,
  composeLocations,
  moved,
  move,
  union,
  cut,
  compound,
  intersect,
  combine,
  fillet,
  chamfer,
  shell,
  val,
  vals,
  transformed,
  setColor,
  splineFace,
  helix,
  splitFace,
  twistExtrude,
  solidFromFaces,
  planarCap,
  siblings,
  tag,
  workplaneFromTagged,
} from './workplane'
export type { Workplane as WorkplaneType, RGB, CqLocation, TaggedWorkplane } from './workplane'

// Sketch geometry container (CadQuery Sketch.py parity, non-planegcs part —
// Phase 2 of the max-cadquery plan; constraints blocked on LGPL verdict).
// Names carry a `sketch` prefix to avoid clashing with the Workplane ops
// (rect/circle/val/tag/... are already taken by the workplane layer).
export {
  sketch as sketchCreate,
  rect as sketchRect,
  circle as sketchCircle,
  ellipse as sketchEllipse,
  polygon as sketchPolygon,
  regularPolygon as sketchRegularPolygon,
  slot as sketchSlot,
  trapezoid as sketchTrapezoid,
  offset as sketchOffset,
  faces as sketchFaces,
  wires as sketchWires,
  edges as sketchEdges,
  vertices as sketchVertices,
  reset as sketchReset,
  val as sketchVal,
  vals as sketchVals,
  tag as sketchTag,
  select as sketchSelect,
  area as sketchArea,
  faceCount as sketchFaceCount,
  extrude as sketchExtrude,
  dispose as sketchDispose,
} from './sketch'
export type { Sketch, SketchMode, SketchOpts } from './sketch'

// Internal helpers consumed by @faicad/cq-compat-assembly (the assembly layer
// split into its own package; these workplane-internal symbols are re-exported
// so the assembly package does not duplicate them).
export { asBrepShape, resolveFaceSelector } from './workplane'

// Assembly layer (buildAssembly/constraint/constraintEx/faceRef/pointRef/axisRef/
// Color + CadQuery solve()/toCompound()/save()) lives in
// @faicad/cq-compat-assembly. STEP / assembly equivalence comparers (dev-only)
// live in @faicad/cq-compat-compare.

// Gear primitive layer (raw-handle kernel access for the cq_gears port;
// see gears.ts header). fai_cq_gears consumes these instead of occt-wasm.
export {
  getGearKernel,
  connectEdgesToWires,
  gearFaceFromWires,
  gearShellToSolid,
  gearEdgeEnds,
  buildGearSplineFace,
  soleGearFace,
  gearDistanceToFace,
  gearFaceDeviation,
  DEFAULT_GEAR_SPLINE_FACE_STRATEGY,
  GEAR_SPLINE_FACE_STRATEGIES,
} from './gears'
export type {
  GearKernel,
  GearAxis,
  GearEdgeEnds,
  GearSplineFaceStrategy,
  GearSplineFaceOptions,
  GearSplineGrid,
  GearDeviationStats,
} from './gears'
export type { Vec3 } from './geom-types'
