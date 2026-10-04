/**
 * @faicad/faijs-cadquery — CadQuery API compatibility layer for faijs.
 *
 * Usage in .fai.js:
 *   import * as cq from '@faicad/faijs-cadquery'
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
  solidMakeCone,
  CQ,
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
  imprint,
  solid,
  solidWithInner,
  intersect,
  combine,
  fillet,
  chamfer,
  shell,
  val,
  vals,
  all,
  first,
  last,
  item,
  end,
  findSolid,
  stackFilter,
  stackMap,
  stackApply,
  sortStack,
  bboxSize,
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
  bezier,
  clean,
  consolidateWires,
  size,
  sort,
  workplaneFromTagged,
  text,
  split,
  section,
  sweep,
  splineWire3D,
  offset2D,
  mirrorX,
  mirrorY,
  polarArray,
  polarLine,
  polarLineTo,
  rotateAboutCenter,
  slot2D,
  wires,
  compounds,
  shells,
  copyWorkplane,
  sketch,
  placeSketch,
  sketchFinish,
  eachpoint,
  cutEach,
  partAt,
  faceFromPoints,
} from './workplane'
export type {
  Workplane as WorkplaneType,
  RGB,
  CqLocation,
  TaggedWorkplane,
  CombineMode,
  HAlign,
  VAlign,
} from './workplane'

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
  push as sketchPush,
  edge as sketchEdge,
  face as sketchFace,
  segment as sketchSegment,
  arc as sketchArc,
  spline as sketchSpline,
  bezier as sketchBezier,
  close as sketchClose,
  assemble as sketchAssemble,
  add as sketchAdd,
  subtract as sketchSubtract,
  rarray as sketchRarray,
  parray as sketchParray,
  distribute as sketchDistribute,
  moved as sketchMoved,
  located as sketchLocated,
  copy as sketchCopy,
  deleteSel as sketchDelete,
  replace as sketchReplace,
  fillet as sketchFillet,
  chamfer as sketchChamfer,
  clean as sketchClean,
  hull as sketchHull,
  hullFromPoints as sketchHullFromPoints,
  constrain as sketchConstrain,
  solve as sketchSolve,
  finalize as sketchFinalize,
} from './sketch'
export type {
  Sketch,
  SketchMode,
  SketchOpts,
  SketchEdgeOpts,
  SketchEdge,
  SketchConstraint,
  SketchConstrainSpec,
  SketchSolveStatus,
  SketchGeom,
  Pt2,
  Loc2,
} from './sketch'

// Shape class model (CadQuery Shape.py parity: Compound.makeCompound /
// Face.makePlane / Face.makeSplineApprox / Shape topology selectors +
// Selector class hierarchy). Compound/domain names that already exist on the
// Workplane layer (shells/solids/compounds) stay Workplane-owned; the Shape
// domain functions carry their CQ class-method-derived names.
export {
  wrapShape,
  borrowShape,
  unwrapShape,
  disposeShape,
  makeCompound,
  facesOf,
  wiresOf,
  faceMakePlane,
  faceMakeSplineApprox,
  TypeSelector,
  DirectionSelector,
  NearestToPointSelector,
  StringSyntaxSelector,
  boundingBoxOf,
  volumeOf,
  areaOf,
  lengthOf,
  centerOfMassOf,
  centerOf,
  radiusOf,
  shapeTypeOf,
  isValidShape,
  geomTypeOf,
} from './shape-class'

// Object selector classes (CadQuery selectors.py object-selector parity —
// audit §3.3 "C 类 · 对象选择器类", priority P4). Upstream composes these with
// the `&` / `+` / `-` operators; TS has no operator overloading, so the binary
// classes are constructed explicitly.
export {
  NthSelector,
  CenterNthSelector,
  LengthNthSelector,
  AreaNthSelector,
  RadiusNthSelector,
  BoxSelector,
  NearestToShapeSelector,
  AndSelector,
  SumSelector,
  SubtractSelector,
  InverseSelector,
} from './object-selectors'
export type {
  Pt3,
  CqShape,
  Selector,
  CqBBox,
} from './shape-class'

// Plane coordinate transforms (CadQuery Plane.toLocalCoords / mirrorInPlane
// parity, audit §3.4). Reuses kernel generalTransform; no core changes.
export {
  toLocalCoords,
  toWorldCoords,
  mirrorInPlane,
  toLocalCoordsVec,
  mirrorInPlaneVec,
} from './plane'
export type { CqPlane } from './plane'

// Internal helpers (asBrepShape/resolveFaceSelector) are consumed by the
// assembly layer in src/assembly/ (merged 2026-10-02, ex standalone
// cq-compat-assembly package) — no longer re-exported for an external package.

// Gear primitive layer (raw-handle kernel access for the cq_gears port)
// migrated to @faicad/faijs-gears `src/kernel/` (2026-10-02) — the only
// consumer was faijs-gears itself.
export type { Vec3 } from './geom-types'
