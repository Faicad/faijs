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
} from './workplane'
export type { Workplane as WorkplaneType, RGB, CqLocation } from './workplane'

export { faceRef, constraint, buildAssembly, Color } from './assembly'

export { compareStepFiles, printCompareReport } from './step-compare'
export type {
  CompareOptions, StepCompareResult, MetricResult, TopologyStats,
} from './step-compare'

export { compareAssemblyFiles, printAssemblyReport } from './assembly-compare'
export type {
  AssemblyCompareOptions, AssemblyCompareResult, PartCompareResult,
} from './assembly-compare'

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
