/**
 * P3 测试专用 facade：brepjs 自己的测试（topology/query/measurement 批次）所需的公共 API 面。
 *
 * 来源：docs/plans/2026-09-01-layered-api-architecture.md §P3（搬 L2 第一批、用 brepjs 自己的测试跑通）。
 *
 * 本 facade 刻写 brepjs `src/index.ts` 对 P3 批的公共面，全部重导出至 vendored 树
 * （`@faicad/faijs-core/vendored/brepjs/…`）。sketch 层 fixture（sketchCircle /
 * sketchRectangle）因属 P5 的 2d/blueprints + sketching，此处以 vendored 已移植的
 * topology 原语（line/circle/wire/face）实现最小兼容对象 `{ wire, face() }`——这正对
 * topology/query/measurement 测试对 `.wire` / `.face()` 的调用面。
 *
 * 注：cornerFinder / polysidesBlueprint / roundedRectangleBlueprint 依赖 2d/blueprints
 *（P5），cornerFinder.test.ts 因此不在 P3 批次内（见 plan 状态行标记）。
 */

// ── 重导出组：拓扑 primitive（干净命名层）──
export {
  box,
  cylinder,
  sphere,
  cone,
  torus,
  ellipsoid,
  line,
  circle,
  ellipse,
  helix,
  threePointArc,
  ellipseArc,
  bsplineApprox,
  bezier,
  tangentArc,
  wire,
  face,
  filledFace,
  subFace,
  polygon,
  vertex,
  compound,
  solid,
  offsetFace,
  sewShells,
  addHoles,
} from '@faicad/faijs-core/vendored/brepjs/topology/primitiveFns.js'

// ── 变换 / 布尔 / 修饰（admin API 层）──
export {
  translate,
  rotate,
  mirror,
  scale,
  clone,
  fuse,
  cut,
  fuseAll,
  cutAll,
  intersect,
  section,
  sectionToFace,
  split,
  slice,
  fillet,
  chamfer,
  shell,
  simplify,
  toBREP,
  isEmpty,
} from '@faicad/faijs-core/vendored/brepjs/topology/api.js'

// ── shape 查询（shapeFns）──
export {
  getHashCode,
  getEdges,
  getFaces,
  getWires,
  getVertices,
  getSolids,
  getShells,
  getCompSolids,
  iterEdges,
  iterFaces,
  iterWires,
  iterSolids,
  iterShells,
  iterCompSolids,
  getBounds,
  vertexPosition,
  isSameShape,
  isEqualShape,
} from '@faicad/faijs-core/vendored/brepjs/topology/shapeFns.js'

// ── curve 查询 ──
export {
  curveStartPoint,
  curveEndPoint,
  curvePointAt,
  curveTangentAt,
  curveAxis,
  curveLength,
  curveIsClosed,
  curveIsPeriodic,
  curvePeriod,
  getCurveType,
  getOrientation,
  flipOrientation,
  offsetWire2D,
} from '@faicad/faijs-core/vendored/brepjs/topology/curveFns.js'

// ── surface/face 查询 ──
export {
  getSurfaceType,
  faceGeomType,
  faceOrientation,
  flipFaceOrientation,
  uvBounds,
  pointOnSurface,
  uvCoordinates,
  normalAt,
  faceCenter,
  outerWire,
  innerWires,
  removeHolesFromFace,
  projectPointOnFace,
} from '@faicad/faijs-core/vendored/brepjs/topology/faceFns.js'

// ── 测量 ──
export {
  measureVolume,
  measureArea,
  measureLength,
  measureDistance,
  measureDistanceProps,
  createDistanceQuery,
  measureVolumeProps,
  measureSurfaceProps,
  measureLinearProps,
  measureCurvatureAt,
  measureCurvatureAtMid,
} from '@faicad/faijs-core/vendored/brepjs/measurement/measureFns.js'

// ── core：result + shape 类型判定 ──
export {
  unwrap,
  unwrapErr,
  isOk,
  isErr,
} from '@faicad/faijs-core/vendored/brepjs/core/result.js'
export {
  createFace,
  createSolid,
  isSolid,
  isShell,
  isCompound,
  isEdge,
  isFace,
  isWire,
  isShape3D,
  castShape,
  getShapeKind,
} from '@faicad/faijs-core/vendored/brepjs/core/shapeTypes.js'
export type {
  Wire,
  Face,
  Solid,
  Shell,
  Edge,
  Vertex,
  Compound,
  AnyShape,
  Shape3D,
  Shape1D,
} from '@faicad/faijs-core/vendored/brepjs/core/shapeTypes.js'

// ── query 查找器 ──
export { getSingleFace } from '@faicad/faijs-core/vendored/brepjs/query/helpers.js'
export { edgeFinder, faceFinder } from '@faicad/faijs-core/vendored/brepjs/query/finderFns.js'

// ── kernel registry（null-shape 预检测试用）──
export { getKernel } from '@faicad/faijs-core/vendored/brepjs/kernel/index.js'

// ── 修饰参数判定 ──
export {
  isNumber,
  isChamferRadius,
  isFilletRadius,
} from '@faicad/faijs-core/vendored/brepjs/topology/shapeModifiers.js'

// ── 包装表面（wrapper）──
export { shape, BrepWrapperError } from '@faicad/faijs-core/vendored/brepjs/topology/wrapperFns.js'

// ── P3 测试侧最小 sketch 兼容（P5 sketching 层落地前）──
import {
  line,
  circle,
  wire,
  face,
} from '@faicad/faijs-core/vendored/brepjs/topology/primitiveFns.js'
import { unwrap } from '@faicad/faijs-core/vendored/brepjs/core/result.js'

/**
 * 最小 `Sketch`-兼容对象：只承诺 P3 批次测试用到的 `.wire` 与 `.face()`，
 * 并带 brepjs `shape()` 识别的 `_defaultOrigin` 哨兵（SKETCH 判定面）。
 * P5 迁移 2d/blueprints + sketching 之后，这些兼容体将被真实 Sketch 取代。
 */
export interface P3SketchSurface {
  readonly wire: unknown
  face(): unknown
  readonly _defaultOrigin: [number, number, number]
}

const XY_ORIGIN: [number, number, number] = [0, 0, 0]

/** compat：以 4 条首尾相连的边组装矩形闭合 wire（XY 平面，中心在原点）。 */
export function sketchRectangle(xLen: number, yLen: number): P3SketchSurface {
  const hx = xLen / 2
  const hy = yLen / 2
  const pts: Array<[number, number, number]> = [
    [-hx, -hy, 0],
    [hx, -hy, 0],
    [hx, hy, 0],
    [-hx, hy, 0],
  ]
  const edges = pts.map((p, i) => line(p, pts[(i + 1) % 4]))
  const w: unknown = unwrap(wire(edges))
  const makeFaceCompat = () => unwrap(face(w as never))
  return {
    wire: w,
    face: makeFaceCompat,
    _defaultOrigin: XY_ORIGIN,
  }
}

/** compat：单条闭合圆边组装成 wire（XY 平面，圆心在原点）。 */
export function sketchCircle(radius: number): P3SketchSurface {
  const edge = circle(radius)
  const w: unknown = unwrap(wire([edge]))
  return {
    wire: w,
    face: () => unwrap(face(w as never)),
    _defaultOrigin: XY_ORIGIN,
  }
}