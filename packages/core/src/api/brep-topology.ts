/**
 * brep-topology — faijs BREP 拓扑查询 / 构造面（core-decouple wrapup §2.2）
 *
 * @platform occt — `outerWire` / `normalAt`（带点路径）走 occt 原生面
 * `getOcctKernel()`（occt-only 能力，未进 L1 中立契约）；其余经 L1
 * `BrepEngineApi`。sheetmetal 钣金库改写的消费面（原 §5.8）。
 *
 * faijs 风格（wrapup §0.1 判据）：全部同步；`Shape` 进、`Shape` 家族
 * （CurveShape/SolidShape）出——子形状可直接再喂回 faijs op（建模链
 * `face(...)` → `extrude(...)` 零适配）；曲面类型为内核中立串
 * （'plane'/'cylinder'/…）；错误用 faijs 第一方 `Result` + `BrepErrorCode`。
 * **不提供 brepjs 兼容面**（裁决 9：brepjs 兼容层不由本 monorepo 提供），
 * 不复刻 brepjs 符号名 / 法文枚举 / 包装句柄形态。
 */

import { getBrepApi } from '../brep/handle-bridge'
import type { BrepHandle } from '../brep/engine/types'
import { getOcctKernel } from '../occt-kernel/occtKernel'
import type { Shape } from '../mesh/types'
import type { Vec3 } from './brepjs-compat/types'
import { fromBrep, fromBrepCurve } from '../shape'
import type { CurveShape, SolidShape } from '../shape'
import { brepHandleOf } from './brep-mirror/brepHelpers'
import { ok, err, type Result } from '../result/result'
import { kernelError, validationError } from '../result/errors'

/** An empty mesh payload for shapes that only carry a BREP handle. */
const EMPTY_MESH: Shape = { positions: new Float32Array(0), indices: new Uint32Array(0) }

/** Wrap an engine handle as a faijs curve shape (edge / wire, no mesh payload). */
const wrapCurve = (h: BrepHandle): CurveShape => fromBrepCurve(EMPTY_MESH, { solid: h })

/** Wrap an engine handle as a faijs solid shape (face etc., no mesh payload). */
const wrapSolid = (h: BrepHandle): SolidShape => fromBrep(EMPTY_MESH, { solid: h })

/** Convert an array Vec3 to the engine's object Vec3. */
const v3 = (v: Vec3): { x: number; y: number; z: number } => ({ x: v[0], y: v[1], z: v[2] })

/** Convert an engine object Vec3 to an array Vec3. */
const v3a = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z]

/** Extract the BREP handle from a faijs Shape (建模链产物，brepOf 提句柄). */
const asHandle = (shape: Shape): BrepHandle => brepHandleOf(shape)

// ---------------------------------------------------------------------------
// 拓扑查询（同步）
// ---------------------------------------------------------------------------

/**
 * Get all edges of a shape as faijs curve shapes.
 *
 * @param shape - a faijs Shape on the BREP chain.
 * @returns the edge curve shapes of the shape.
 */
export function getEdges(shape: Shape): CurveShape[] {
  return getBrepApi().getSubShapes(asHandle(shape), 'edge').map(wrapCurve)
}

/**
 * Get all faces of a shape as faijs solid shapes.
 *
 * @param shape - a faijs Shape on the BREP chain.
 * @returns the face shapes of the shape.
 */
export function getFaces(shape: Shape): SolidShape[] {
  return getBrepApi().getSubShapes(asHandle(shape), 'face').map(wrapSolid)
}

/**
 * Get all solids of a shape as faijs solid shapes.
 *
 * Booleans (`cut`/`fuse`) and some sweeps return a compound wrapping the
 * solid(s); use this to unwrap them without reaching into the kernel.
 *
 * @param shape - a faijs Shape on the BREP chain.
 * @returns the solid shapes of the shape.
 */
export function getSolids(shape: Shape): SolidShape[] {
  return getBrepApi().getSubShapes(asHandle(shape), 'solid').map(wrapSolid)
}

/**
 * Check whether a shape is a solid.
 *
 * @param shape - a faijs Shape on the BREP chain.
 * @returns true when the shape is a solid.
 */
export function isSolid(shape: Shape): boolean {
  return getBrepApi().isSolid(asHandle(shape))
}

/**
 * Axis-aligned bounding box of a shape from the BREP kernel.
 *
 * 说明：`cad.boundingBox` 只读 mesh 载荷（positions），brep 产物（空载荷）
 * 会得空盒；本出口直连引擎包围盒，供 sheetmetal 侧组合 `Bounds3D`。
 *
 * @param shape - a faijs Shape on the BREP chain.
 * @returns the bounding box min/max corner points.
 */
export function bounds3D(shape: Shape): { min: Vec3; max: Vec3 } {
  const b = getBrepApi().getBoundingBox(asHandle(shape))
  return {
    min: [b.xmin, b.ymin, b.zmin],
    max: [b.xmax, b.ymax, b.zmax],
  }
}

/**
 * Get the geometric surface type of a face (kernel neutral string).
 *
 * @param face - a faijs face Shape (from `getFaces`).
 * @returns ok with the surface type ('plane' / 'cylinder' / 'sphere' / …).
 */
export function getSurfaceType(face: Shape): Result<string> {
  return ok(getBrepApi().surfaceType(asHandle(face)))
}

// ---------------------------------------------------------------------------
// 曲线 / 曲面求值（同步）
// ---------------------------------------------------------------------------

/**
 * Get the start point of an edge or wire curve.
 *
 * @param shape - an edge/wire faijs Shape.
 * @returns the curve start point.
 */
export function curveStartPoint(shape: Shape): Vec3 {
  const h = asHandle(shape)
  const { first } = getBrepApi().curveParameters(h)
  return v3a(getBrepApi().curvePointAtParam(h, first))
}

/**
 * Get the end point of an edge or wire curve.
 *
 * @param shape - an edge/wire faijs Shape.
 * @returns the curve end point.
 */
export function curveEndPoint(shape: Shape): Vec3 {
  const h = asHandle(shape)
  const { last } = getBrepApi().curveParameters(h)
  return v3a(getBrepApi().curvePointAtParam(h, last))
}

/**
 * Get the center of mass of a face.
 *
 * @param face - a faijs face Shape (from `getFaces`).
 * @returns the face center point.
 */
export function faceCenter(face: Shape): Vec3 {
  return v3a(getBrepApi().surfaceCenterOfMass(asHandle(face)))
}

/**
 * Get the surface normal at a point (or at the UV-center when no point given).
 *
 * When a 3D point is given, it is projected to UV coordinates via the occt
 * native `uvFromPoint` (occt-only; falls back to UV origin when the projection
 * fails).
 *
 * @param face - a faijs face Shape (from `getFaces`).
 * @param locationPoint - optional 3D point on the face.
 * @returns the surface normal at the location.
 */
export function normalAt(face: Shape, locationPoint?: Vec3): Vec3 {
  const h = asHandle(face)
  let u: number
  let v: number
  if (locationPoint === undefined) {
    const bounds = getBrepApi().uvBounds(h)
    u = 0.5 * (bounds.uMin + bounds.uMax)
    v = 0.5 * (bounds.vMin + bounds.vMax)
  } else {
    const uv = getOcctKernel().uvFromPoint(h as never, v3(locationPoint) as never)
    if (uv === undefined || uv === null || typeof uv.u !== 'number') {
      return v3a(getBrepApi().surfaceNormal(h, 0, 0))
    }
    u = uv.u
    v = uv.v
  }
  return v3a(getBrepApi().surfaceNormal(h, u, v))
}

/**
 * Get a point on a face surface at normalized UV coordinates (0-1 range).
 *
 * @param face - a faijs face Shape (from `getFaces`).
 * @param u - normalized U parameter (0-1).
 * @param v - normalized V parameter (0-1).
 * @returns the surface point.
 */
export function pointOnSurface(face: Shape, u: number, v: number): Vec3 {
  const h = asHandle(face)
  const bounds = getBrepApi().uvBounds(h)
  const absU = u * (bounds.uMax - bounds.uMin) + bounds.uMin
  const absV = v * (bounds.vMax - bounds.vMin) + bounds.vMin
  return v3a(getBrepApi().pointOnSurface(h, absU, absV))
}

/**
 * Get the edges shared by two faces.
 *
 * @param a - first faijs face Shape.
 * @param b - second faijs face Shape.
 * @returns the shared edge curve shapes.
 */
export function sharedEdges(a: Shape, b: Shape): CurveShape[] {
  return getBrepApi().sharedEdges(asHandle(a), asHandle(b)).map(wrapCurve)
}

/**
 * Get the outer wire of a face (occt native `BRepTools::OuterWire`).
 *
 * @param face - a faijs face Shape.
 * @returns the outer wire curve shape.
 */
export function outerWire(face: Shape): CurveShape {
  return wrapCurve(getOcctKernel().outerWire(asHandle(face) as never) as unknown as BrepHandle)
}

// ---------------------------------------------------------------------------
// 构造（同步）
// ---------------------------------------------------------------------------

/**
 * Create a line edge between two points.
 *
 * @param from - start point.
 * @param to - end point.
 * @returns the edge curve shape.
 */
export function line(from: Vec3, to: Vec3): CurveShape {
  return wrapCurve(getBrepApi().makeLineEdge(v3(from), v3(to)))
}

/**
 * Check whether a wire is closed (forms a loop).
 *
 * @param wire - a faijs wire Shape.
 * @returns true when the wire is closed.
 */
export function isClosedWire(wire: Shape): boolean {
  return getBrepApi().curveIsClosed(asHandle(wire))
}

/**
 * Assemble edges into a connected wire, open or closed (no closure check).
 *
 * Sheetmetal form cuts (louver U-cuts) are deliberately OPEN paths in the
 * developed plane — the fabricator leaves the hinge side uncut — so the
 * topology face must be able to produce a non-closed wire. {@link wireLoop}
 * adds the closure contract on top of this primitive.
 *
 * @param edges - ordered edge curve shapes to assemble.
 * @returns ok with the assembled wire shape, or WIRE_BUILD_FAILED.
 */
export function assembleWire(edges: Shape[]): Result<CurveShape> {
  let w: BrepHandle
  try {
    w = getBrepApi().makeWire(edges.map(asHandle))
  } catch (e) {
    return err(
      kernelError(
        'WIRE_BUILD_FAILED',
        `Failed to build the wire: ${e instanceof Error ? e.message : 'unknown error'}`,
        e
      )
    )
  }
  return ok(wrapCurve(w))
}

/**
 * Assemble edges into a connected wire, requiring the result to be closed.
 *
 * @param edges - ordered edge curve shapes to assemble.
 * @returns ok with the closed wire shape, or WIRE_BUILD_FAILED /
 *   WIRE_NOT_CLOSED.
 */
export function wireLoop(edges: Shape[]): Result<CurveShape> {
  let w: BrepHandle
  try {
    w = getBrepApi().makeWire(edges.map(asHandle))
  } catch (e) {
    return err(
      kernelError(
        'WIRE_BUILD_FAILED',
        `Failed to build the wire: ${e instanceof Error ? e.message : 'unknown error'}`,
        e
      )
    )
  }
  if (!getBrepApi().curveIsClosed(w)) {
    return err(
      validationError(
        'WIRE_NOT_CLOSED',
        'Assembled wire is not closed: start and end points do not coincide'
      )
    )
  }
  return ok(wrapCurve(w))
}

/**
 * Check whether a wire is planar (all edges lie in a common plane).
 *
 * Strategy: try planar face construction; if it succeeds, verify the surface
 * type. A failure to build the face means the wire is not planar.
 *
 * @param wire - a faijs wire Shape.
 * @returns true when the wire is planar.
 */
export function isPlanarWire(wire: Shape): boolean {
  try {
    const f = getBrepApi().makeFace(asHandle(wire))
    const type = getBrepApi().surfaceType(f)
    try {
      getBrepApi().dispose(f)
    } catch {
      /* best-effort cleanup */
    }
    return type === 'plane'
  } catch {
    return false
  }
}

/**
 * Create a planar face from a closed wire, optionally with holes.
 *
 * The result is a faijs solid Shape carrying the face BREP handle, ready for
 * the modeling chain (`extrude` etc.).
 *
 * @param w - a closed planar wire Shape.
 * @param holes - optional hole wire Shapes.
 * @returns ok with the face shape, or FACE_BUILD_FAILED / FACE_NOT_PLANAR.
 */
export function face(w: Shape, holes?: Shape[]): Result<SolidShape> {
  let f: BrepHandle
  try {
    f = getBrepApi().makeFace(asHandle(w))
    if (holes !== undefined && holes.length > 0) {
      f = getBrepApi().addHolesInFace(f, holes.map(asHandle))
    }
  } catch (e) {
    return err(
      kernelError('FACE_BUILD_FAILED', 'Failed to build the face. Your wire might be non planar.', e)
    )
  }
  if (getBrepApi().surfaceType(f) !== 'plane') {
    return err(
      validationError('FACE_NOT_PLANAR', 'makeFace produced a non-planar face — wire may not be truly planar')
    )
  }
  return ok(wrapSolid(f))
}

/**
 * Create a polygonal face from three or more coplanar points.
 *
 * @param points - three or more coplanar points.
 * @returns ok with the face shape, or POLYGON_MIN_POINTS / wire / face errors.
 */
export function polygon(points: Vec3[]): Result<SolidShape> {
  if (points.length < 3) {
    return err(validationError('POLYGON_MIN_POINTS', 'You need at least 3 points to make a polygon'))
  }
  const edges: CurveShape[] = []
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i]
    const p2 = points[(i + 1) % points.length]
    edges.push(line(p1, p2))
  }
  const wire = wireLoop(edges)
  if (!wire.ok) return wire
  return face(wire.value)
}

// ---------------------------------------------------------------------------
// 测量（faijs 既有：api/generated/measurement.ts 的 measureVolume /
//   measureArea / measureLength 已在 api/index.ts 平铺；本面不重复导出）
// ---------------------------------------------------------------------------
