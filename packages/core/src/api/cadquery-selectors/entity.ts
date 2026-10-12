/**
 * cadquery-selectors/entity — projection of kernel handles into the geometric
 * quantities the selector predicates need.
 *
 * Each helper mirrors the CadQuery shape method it stands in for (plan §4.3):
 *   · `Vertex.Center()`      → vertex position
 *   · `Edge.Center()`        → linear centre of mass (LinearProperties centroid)
 *   · `Face.Center()`        → surface centre of mass (SurfaceProperties centroid)
 *   · `Face.normalAt(None)`  → parametric surface normal at the uv midpoint,
 *                              oriented outward via `containsPoint` on the owner
 *   · `Edge.tangentAt()`     → curve tangent at the parameter midpoint,
 *                              oriented along the edge parameter direction
 *   · `Face/Edge.geomType()` → kernel surface/curve kind mapped to the CadQuery
 *                              geom_LUT uppercased names
 *
 * These are deliberately decoupled from any single entity type so the
 * predicates (predicates.ts) and the narrowing engine (resolve.ts) stay
 * type-agnostic. All quantities are computed lazily by the caller via the
 * projection object below.
 *
 * @platform neutral — 2026-10-12 内核无关化：投影经 `getBrepApi()`（BrepEngineApi，
 * 引擎中立）访问当前装配的 BREP 引擎，occt / brepkit 均可求值（双内核等价测试
 * `test/api/cadquery-selectors/selectors-brepkit.test.ts` 钉住）。此前直连
 * occt-wasm `getKernel()` 的 occt 耦合已移除。
 */

import { getBrepApi } from '../../brep/handle-bridge'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { BrepHandle, BrepVec3 } from '../../brep/engine/types'

/** Resolve the kernel geometry-kind → CadQuery LUT upcased name. */
export interface GeomKindMap {
  surface: Record<string, string>
  curve: Record<string, string>
}

const NAMED_GEOM: { surface: Record<string, string>; curve: Record<string, string> } = {
  surface: {
    plane: 'PLANE',
    cylinder: 'CYLINDER',
    cone: 'CONE',
    sphere: 'SPHERE',
    torus: 'TORUS',
    bspline: 'BSPLINE',
    bezier: 'BEZIER',
    offset: 'OFFSET',
    revolution: 'REVOLUTION',
    extrusion: 'EXTRUSION',
  },
  curve: {
    line: 'LINE',
    circle: 'CIRCLE',
    ellipse: 'ELLIPSE',
    hyperbola: 'HYPERBOLA',
    parabola: 'PARABOLA',
    bspline: 'BSPLINE',
    bezier: 'BEZIER',
    offset: 'OFFSET',
  },
}

/**
 * Map a kernel surface-kind string to the CadQuery `geomType()` name.
 *
 * 2026-10-12 大小写归一（双内核等价的前提）：occt `surfaceType` 返回小写
 * `'plane'`，brepkit 同为小写 `'plane'`；但 brepkit `curveType` 实测返回大写
 * `'LINE'`（occt 为小写 `'line'`）——统一 `toLowerCase()` 后再查表，两内核
 * 的 PLANE/LINE 谓词语义才一致（`selectors-brepkit.test.ts` 钉住）。
 *
 * @param kind - The kernel surface kind (e.g. `plane`, `cylinder`, `torus`).
 * @returns The uppercased CadQuery geometry name, or `OTHER` when unmapped.
 */
export function faceGeomType(kind: string): string {
  return NAMED_GEOM.surface[String(kind).toLowerCase()] ?? 'OTHER'
}

/**
 * Map a kernel curve-kind string to the CadQuery `geomType()` name.
 *
 * 大小写归一理由同 {@link faceGeomType}（brepkit 实测 `curveType` 返回大写）。
 *
 * @param kind - The kernel curve kind (e.g. `line`, `circle`, `bspline`).
 * @returns The uppercased CadQuery geometry name, or `OTHER` when unmapped.
 */
export function edgeGeomType(kind: string): string {
  return NAMED_GEOM.curve[String(kind).toLowerCase()] ?? 'OTHER'
}

/** World-space cartesian coordinates of an entity center point. */
export interface EntityCenter {
  x: number
  y: number
  z: number
}

/** Plain 3-D vector in faijs' internal convention. */
export type P3 = { x: number; y: number; z: number }

export type { BrepHandle as ShapeHandle }

function v(v: BrepVec3 | P3): P3 {
  return { x: v.x, y: v.y, z: v.z }
}

/**
 * The lazily-evaluable geometry of one candidate entity. Predicates only access
 * the fields they need so the heavy computation (surface normal, etc.) is only
 * paid for when a direction/parallel filter is actually applied.
 */
export interface EntityGeom {
  kind: 'face' | 'edge' | 'vertex'
  /** Engine-neutral kernel handle for identity comparison (not part of the public surface). */
  _handle: BrepHandle
  /** Kernel handle box-identity hash (stable key across narrowing). */
  hash(): number
  /** Kernel handle `isSame(...)` equality predicate. */
  same(other: EntityGeom): boolean
  /** CadQuery `Shape.Center()` for this entity kind. */
  center(): P3
  /**
   * The direction used by direction-motivated selectors: the outward normal for
   * a face (requires the owning shape for orientation) or the mid-parameter
   * tangent for an edge. Null for vertices (no usable direction, upstream
   * `BaseSelector` drops them).
   */
  direction(owner: BrepHandle): P3 | null
  /** Face/Edge geometry type (upcased LUT name), or undefined for vertices. */
  geomType(): string | undefined
}

/**
 * Project a face handle into its `EntityGeom`.
 *
 * @param face - The engine face handle to project.
 * @returns The lazily-evaluable face geometry (normal oriented on demand).
 */
export function faceGeom(face: BrepHandle): EntityGeom {
  const k = getBrepApi()
  return {
    kind: 'face',
    _handle: face,
    hash: () => k.hashCode(face, 1e9),
    same: (other: EntityGeom) => k.isSame(face, other._handle),
    center: () => v(k.surfaceCenterOfMass(face)),
    direction: (owner: BrepHandle) => orientedFaceNormal(k, face, owner),
    geomType: () => faceGeomType(k.surfaceType(face)),
  }
}

/**
 * Orient a parametric face normal outward: offset probe → inside ⇒ flip.
 *
 * @param k - The active engine instance used for surface/containment queries.
 * @param face - The engine face handle whose normal is oriented.
 * @param owner - The owning shape handle used for the containment probe.
 * @returns The outward-facing unit normal of `face`.
 */
export function orientedFaceNormal(
  k: BrepEngineApi,
  face: BrepHandle,
  owner: BrepHandle,
): P3 {
  const uv = k.uvBounds(face)
  const u = (uv.uMin + uv.uMax) / 2
  const vv = (uv.vMin + uv.vMax) / 2
  const n = k.surfaceNormal(face, u, vv)
  const db = k.getBoundingBox(face)
  const ext = [db.xmax - db.xmin, db.ymax - db.ymin, db.zmax - db.zmin]
  const minExt = Math.min(...ext, 1)
  const eps = minExt * 1e-3 + 1e-6
  const center = k.pointOnSurface(face, u, vv)
  const probe = { x: center.x + n.x * eps, y: center.y + n.y * eps, z: center.z + n.z * eps }
  // inside owner ⇒ the candidate normal points inward, so flip it.
  if (k.containsPoint(owner, probe, 1e-9)) {
    return { x: -n.x, y: -n.y, z: -n.z }
  }
  return v(n)
}

/**
 * Project an edge handle into its `EntityGeom`.
 *
 * @param edge - The engine edge handle to project.
 * @returns The lazily-evaluable edge geometry (mid-parameter tangent).
 */
export function edgeGeom(edge: BrepHandle): EntityGeom {
  const k = getBrepApi()
  const midParams = () => {
    const cp = k.curveParameters(edge)
    return (cp.first + cp.last) / 2
  }
  return {
    kind: 'edge',
    _handle: edge,
    hash: () => k.hashCode(edge, 1e9),
    same: (other: EntityGeom) => k.isSame(edge, other._handle),
    center: () => v(k.curvePointAtParam(edge, midParams())),
    direction: () => v(k.curveTangent(edge, midParams())),
    geomType: () => edgeGeomType(k.curveType(edge)),
  }
}

/**
 * Project a vertex handle into its `EntityGeom`.
 *
 * @param vertex - The engine vertex handle to project.
 * @returns The lazily-evaluable vertex geometry (no direction / type).
 */
export function vertexGeom(vertex: BrepHandle): EntityGeom {
  const k = getBrepApi()
  const p = k.vertexPosition(vertex)
  return {
    kind: 'vertex',
    _handle: vertex,
    hash: () => k.hashCode(vertex, 1e9),
    same: (other: EntityGeom) => k.isSame(vertex, other._handle),
    center: () => v(p),
    direction: () => null,
    geomType: () => undefined,
  }
}

/**
 * Get the sub-entity handles of the given topological type from a shape.
 *
 * @param shape - The engine handle to query.
 * @param type - The topological type to enumerate.
 * @returns The ordered engine sub-shape handles of that type.
 */
export function subShapeHandles(shape: BrepHandle, type: 'face' | 'edge' | 'vertex'): BrepHandle[] {
  return getBrepApi().getSubShapes(shape, type)
}