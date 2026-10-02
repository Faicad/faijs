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
 * @platform occt — the projection resolves occt-wasm `ShapeHandle`s via the
 * native kernel (`getKernel()`: getSubShapes / hashCode / isSame / bounds /
 * surface & curve queries), so this module is occt-coupled by nature.
 */

import { getKernel } from '../../occt-kernel/occtKernel'
import type { OcctKernel, ShapeHandle, Vec3 } from 'occt-wasm'

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
 * @param kind - The kernel surface kind (e.g. `plane`, `cylinder`, `torus`).
 * @returns The uppercased CadQuery geometry name, or `OTHER` when unmapped.
 */
export function faceGeomType(kind: string): string {
  return NAMED_GEOM.surface[kind] ?? 'OTHER'
}

/**
 * Map a kernel curve-kind string to the CadQuery `geomType()` name.
 *
 * @param kind - The kernel curve kind (e.g. `line`, `circle`, `bspline`).
 * @returns The uppercased CadQuery geometry name, or `OTHER` when unmapped.
 */
export function edgeGeomType(kind: string): string {
  return NAMED_GEOM.curve[kind] ?? 'OTHER'
}

/** World-space cartesian coordinates of an entity center point. */
export interface EntityCenter {
  x: number
  y: number
  z: number
}

/** Plain 3-D vector in faijs' internal convention. */
export type P3 = { x: number; y: number; z: number }

export type { ShapeHandle }

function v(v: Vec3 | P3): P3 {
  return { x: v.x, y: v.y, z: v.z }
}

/**
 * The lazily-evaluable geometry of one candidate entity. Predicates only access
 * the fields they need so the heavy computation (surface normal, etc.) is only
 * paid for when a direction/parallel filter is actually applied.
 */
export interface EntityGeom {
  kind: 'face' | 'edge' | 'vertex'
  /** Internal kernel handle for identity comparison (not part of the public surface). */
  _handle: ShapeHandle
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
  direction(owner: ShapeHandle): P3 | null
  /** Face/Edge geometry type (upcased LUT name), or undefined for vertices. */
  geomType(): string | undefined
}

const kern = (): OcctKernel => getKernel() as unknown as OcctKernel

/**
 * Project a face handle into its `EntityGeom`.
 *
 * @param face - The kernel face handle to project.
 * @returns The lazily-evaluable face geometry (normal oriented on demand).
 */
export function faceGeom(face: ShapeHandle): EntityGeom {
  const k = kern()
  return {
    kind: 'face',
    _handle: face,
    hash: () => k.hashCode(face, 1e9),
    same: (other: EntityGeom) => k.isSame(face, other._handle),
    center: () => v(k.getSurfaceCenterOfMass(face)),
    direction: (owner: ShapeHandle) => orientedFaceNormal(k, face, owner),
    geomType: () => faceGeomType(k.surfaceType(face)),
  }
}

/**
 * Orient a parametric face normal outward: offset probe → inside ⇒ flip.
 *
 * @param k - The active kernel instance used for surface/containment queries.
 * @param face - The kernel face handle whose normal is oriented.
 * @param owner - The owning shape handle used for the containment probe.
 * @returns The outward-facing unit normal of `face`.
 */
export function orientedFaceNormal(
  k: OcctKernel,
  face: ShapeHandle,
  owner: ShapeHandle,
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
 * @param edge - The kernel edge handle to project.
 * @returns The lazily-evaluable edge geometry (mid-parameter tangent).
 */
export function edgeGeom(edge: ShapeHandle): EntityGeom {
  const k = kern()
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
 * @param vertex - The kernel vertex handle to project.
 * @returns The lazily-evaluable vertex geometry (no direction / type).
 */
export function vertexGeom(vertex: ShapeHandle): EntityGeom {
  const k = kern()
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
 * @param shape - The kernel handle to query.
 * @param type - The topological type to enumerate.
 * @returns The ordered kernel sub-shape handles of that type.
 */
export function subShapeHandles(shape: ShapeHandle, type: 'face' | 'edge' | 'vertex'): ShapeHandle[] {
  const k = kern()
  return k.getSubShapes(shape, type) as ShapeHandle[]
}