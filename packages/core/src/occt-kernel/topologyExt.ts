import type { BrepHandle, BrepMeshResult, BrepBoundingBox, BrepVec3 } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { asEdgeId, asFaceId, asOccurrenceId, asShapeId } from '../identity'

/**
 * Safe getBoundingBox wrapper: tries useTriangulation=false first,
 * falls back to true, then finally computes from mesh positions.
 * This handles compound shapes from boolean operations where OCCT's
 * getBoundingBox may fail in the browser WASM environment.
 */
function tryGetBoundingBox(
  kernel: { getBoundingBox(s: BrepHandle, t: boolean): BrepBoundingBox },
  shape: BrepHandle,
  meshPositions?: Float32Array,
): BrepBoundingBox {
  try {
    return kernel.getBoundingBox(shape, false)
  } catch {
    // try with triangulation
  }
  try {
    return kernel.getBoundingBox(shape, true)
  } catch {
    // fall through to mesh-based computation
  }
  // Final fallback: compute bbox from mesh vertex positions
  if (meshPositions && meshPositions.length >= 3) {
    let xmin = Infinity, ymin = Infinity, zmin = Infinity
    let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity
    for (let i = 0; i < meshPositions.length; i += 3) {
      const x = meshPositions[i], y = meshPositions[i + 1], z = meshPositions[i + 2]
      if (x < xmin) xmin = x
      if (y < ymin) ymin = y
      if (z < zmin) zmin = z
      if (x > xmax) xmax = x
      if (y > ymax) ymax = y
      if (z > zmax) zmax = z
    }
    return { xmin, ymin, zmin, xmax, ymax, zmax }
  }
  // Last resort: return a default bbox
  return { xmin: -100, ymin: -100, zmin: -100, xmax: 100, ymax: 100, zmax: 100 }
}

// Topology data stays in mm — the viewer's buildSelectorRuntime is called
// with scale:1 (scene base unit is mm), so no conversion needed.

// OCCT's TopTools_ShapeMapHasher returns a hash that the C++ facade
// reduces modulo 2147483647 (INT32_MAX). All kernel-generated hashes
// (faceGroups, edgeGroups, edgeToFaceMap) use this same bound, so we
// must pass 2147483647 to hashCode() for the hashes to match.
const HASH_BOUND = 2147483647
// Python SelectorOptions(digits=6) — 所有浮点值输出前舍入到 6 位小数
const ROUND_DIGITS = 6

const OCCURRENCE_COLUMNS = [
  'id', 'path', 'name', 'sourceName', 'parentId', 'transform',
  'bbox', 'shapeStart', 'shapeCount', 'faceStart', 'faceCount',
  'edgeStart', 'edgeCount',
]

const SHAPE_COLUMNS = [
  'id', 'occurrenceId', 'ordinal', 'kind', 'bbox', 'center',
  'area', 'volume', 'faceStart', 'faceCount', 'edgeStart', 'edgeCount',
]

const FACE_COLUMNS = [
  'id', 'occurrenceId', 'shapeId', 'ordinal', 'surfaceType',
  'area', 'center', 'normal', 'bbox', 'edgeStart', 'edgeCount',
  'relevance', 'flags', 'params', 'triangleStart', 'triangleCount',
]

const EDGE_COLUMNS = [
  'id', 'occurrenceId', 'shapeId', 'ordinal', 'curveType',
  'length', 'center', 'bbox', 'faceStart', 'faceCount',
  'relevance', 'flags', 'params', 'segmentStart', 'segmentCount',
]

const IDENTITY_16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

interface SelectorManifestOptions {
  stepHash?: string
  cadPath?: string
}

interface BBox {
  min: number[]
  max: number[]
}

export interface SelectorManifestInput {
  shapeHandle: BrepHandle
  meshWithGroups: BrepMeshResult
}

function bboxFromOcc(bb: BrepBoundingBox): BBox {
  return { min: [bb.xmin, bb.ymin, bb.zmin], max: [bb.xmax, bb.ymax, bb.zmax] }
}

function bboxCenter(bbox: BBox): number[] {
  return [
    (bbox.min[0] + bbox.max[0]) / 2,
    (bbox.min[1] + bbox.max[1]) / 2,
    (bbox.min[2] + bbox.max[2]) / 2,
  ]
}

function bboxArray(bbox: BBox): Record<string, number[]> {
  return { min: roundPoint(bbox.min), max: roundPoint(bbox.max) }
}

function vec3ToArray(v: BrepVec3): number[] {
  return [v.x, v.y, v.z]
}

// ── Rounding helpers (match Python _round_value / _round_point with digits=6) ──
function roundVal(v: number, digits: number = ROUND_DIGITS): number {
  if (!Number.isFinite(v)) return v
  const p = Math.pow(10, digits)
  return Math.round(v * p) / p
}

function roundPoint(p: number[], digits: number = ROUND_DIGITS): number[] {
  return [roundVal(p[0], digits), roundVal(p[1], digits), roundVal(p[2], digits)]
}

function mergeBboxes(bboxes: BBox[]): BBox {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const b of bboxes) {
    if (b.min[0] < min[0]) min[0] = b.min[0]
    if (b.min[1] < min[1]) min[1] = b.min[1]
    if (b.min[2] < min[2]) min[2] = b.min[2]
    if (b.max[0] > max[0]) max[0] = b.max[0]
    if (b.max[1] > max[1]) max[1] = b.max[1]
    if (b.max[2] > max[2]) max[2] = b.max[2]
  }
  return { min, max }
}

// ── BBox with center/size/diag (matches Python _bbox_from_points) ──
interface FullBBox {
  min: number[]
  max: number[]
  center: number[]
  size: number[]
  diag: number
}

function fullBBoxFromPoints(points: number[][]): FullBBox {
  if (points.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], size: [0, 0, 0], diag: 0 }
  }
  let minX = points[0][0], maxX = points[0][0]
  let minY = points[0][1], maxY = points[0][1]
  let minZ = points[0][2], maxZ = points[0][2]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    if (p[0] < minX) minX = p[0]
    if (p[0] > maxX) maxX = p[0]
    if (p[1] < minY) minY = p[1]
    if (p[1] > maxY) maxY = p[1]
    if (p[2] < minZ) minZ = p[2]
    if (p[2] > maxZ) maxZ = p[2]
  }
  const sizeX = maxX - minX
  const sizeY = maxY - minY
  const sizeZ = maxZ - minZ
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [minX + sizeX * 0.5, minY + sizeY * 0.5, minZ + sizeZ * 0.5],
    size: [sizeX, sizeY, sizeZ],
    diag: Math.sqrt(sizeX * sizeX + sizeY * sizeY + sizeZ * sizeZ),
  }
}

// ── Cross product of AB x AC ──
function cross(a: number[], b: number[], c: number[]): [number, number, number] {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const abz = b[2] - a[2]
  const acx = c[0] - a[0]
  const acy = c[1] - a[1]
  const acz = c[2] - a[2]
  return [
    aby * acz - abz * acy,
    abz * acx - abx * acz,
    abx * acy - aby * acx,
  ]
}

function normalize(v: number[]): number[] | null {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
  if (len <= 1e-12) return null
  return [v[0] / len, v[1] / len, v[2] / len]
}

function distance(a: number[], b: number[]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// ── Polyline helpers (matches Python _dedupe_consecutive, _decimate_polyline, _polyline_length, _polyline_center) ──

function dedupeConsecutive(points: number[][], tolerance: number): number[][] {
  if (points.length === 0) return points
  const deduped = [points[0]]
  for (let i = 1; i < points.length; i++) {
    if (distance(deduped[deduped.length - 1], points[i]) > tolerance) {
      deduped.push(points[i])
    }
  }
  return deduped
}

function decimatePolyline(points: number[][], maxPoints: number): number[][] {
  if (maxPoints <= 1 || points.length <= maxPoints) return points
  const stride = (points.length - 1) / (maxPoints - 1)
  const result: number[][] = []
  let lastIndex = -1
  for (let i = 0; i < maxPoints; i++) {
    let index = Math.round(i * stride)
    if (index >= points.length) index = points.length - 1
    if (index !== lastIndex) {
      result.push(points[index])
      lastIndex = index
    }
  }
  if (result.length > 0 && result[result.length - 1] !== points[points.length - 1]) {
    result[result.length - 1] = points[points.length - 1]
  }
  return result
}

function polylineLength(points: number[][], closed: boolean): number {
  if (points.length < 2) return 0
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    total += distance(points[i], points[i + 1])
  }
  if (closed && distance(points[0], points[points.length - 1]) > 1e-9) {
    total += distance(points[points.length - 1], points[0])
  }
  return total
}

function polylineCenter(points: number[][]): number[] {
  if (points.length === 0) return [0, 0, 0]
  let tx = 0, ty = 0, tz = 0
  for (const p of points) {
    tx += p[0]
    ty += p[1]
    tz += p[2]
  }
  const inv = 1 / points.length
  return [tx * inv, ty * inv, tz * inv]
}

// ── Edge polyline extraction from wireframe with dedup/decimation ──
// wireframe().edgeGroups format: [pointStart_float, pointCount_float, edgeHash]
// pointStart is a float offset into edgeData.points; pointCount is the number
// of floats (not points) for this edge.
function extractEdgePolylineFromWireframe(
  edgePoints: Float32Array,
  pointStart: number,
  pointCount: number,
  maxEdgePoints: number,
): number[][] {
  if (pointCount < 6) return []  // need at least 2 points (6 floats)
  const numPoints = Math.floor(pointCount / 3)
  const raw: number[][] = []
  for (let p = 0; p < numPoints; p++) {
    const off = pointStart + p * 3
    raw.push([edgePoints[off], edgePoints[off + 1], edgePoints[off + 2]])
  }
  let points = dedupeConsecutive(raw, 1e-9)
  if (points.length > 1 && maxEdgePoints > 1) {
    points = decimatePolyline(points, maxEdgePoints)
  }
  return points
}

// ── Compute geometric axis from surface tangents (unoriented by face) ──
// For a parametric surface S(u,v):
//   dS/du ≈ (S(u+du,v) - S(u,v))/du
//   dS/dv ≈ (S(u,v+dv) - S(u,v))/dv
//   axis = normalize(cross(dS/du, dS/dv))
function geometricNormal(
  kernel: BrepEngineApi,
  face: BrepHandle,
  u: number,
  v: number,
): number[] | null {
  const du = 1e-4
  const dv = 1e-4
  const p00 = vec3ToArray(kernel.pointOnSurface(face, u, v))
  const p10 = vec3ToArray(kernel.pointOnSurface(face, u + du, v))
  const p01 = vec3ToArray(kernel.pointOnSurface(face, u, v + dv))
  const dSu: number[] = [p10[0] - p00[0], p10[1] - p00[1], p10[2] - p00[2]]
  const dSv: number[] = [p01[0] - p00[0], p01[1] - p00[1], p01[2] - p00[2]]
  const crossVec: number[] = [
    dSu[1] * dSv[2] - dSu[2] * dSv[1],
    dSu[2] * dSv[0] - dSu[0] * dSv[2],
    dSu[0] * dSv[1] - dSu[1] * dSv[0],
  ]
  return normalize(crossVec)
}

// ── Surface params (matches Python _surface_params exactly) ──
function getSurfaceParams(kernel: BrepEngineApi, face: BrepHandle): Record<string, unknown> | null {
  const surfaceType = kernel.surfaceType(face)
  const params: Record<string, unknown> = {}
  const uv = kernel.uvBounds(face)
  const uMin = uv.uMin, vMin = uv.vMin

  if (surfaceType === 'plane') {
    // Python: plane.Location() = origin, plane.Axis().Direction() = axis
    // S(u,v) = O + u*XDir + v*YDir, so S(0,0) = O = origin
    params.origin = roundPoint(vec3ToArray(kernel.pointOnSurface(face, 0, 0)))
    const axis = geometricNormal(kernel, face, uMin, vMin)
    if (axis) params.axis = roundPoint(axis)
  } else if (surfaceType === 'cylinder') {
    // Python: cylinder.Location() = point on axis, cylinder.Axis().Direction() = axis direction
    // Key order: origin, axis, radius (matches Python output)
    const cyl = kernel.getFaceCylinderData(face)

    // Compute axis direction from V-direction: S(u,v+1) - S(u,v) = Axis direction
    const p0 = vec3ToArray(kernel.pointOnSurface(face, uMin, vMin))
    const p1 = vec3ToArray(kernel.pointOnSurface(face, uMin, vMin + 1))
    const axisDir = normalize([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]])
    if (axisDir && cyl) {
      // Compute axis origin using surfaceNormal API (exact, no finite-difference error).
      // surfaceNormal includes face orientation, so correct for reversed faces.
      let sn = kernel.surfaceNormal(face, uMin, vMin)
      if (kernel.shapeOrientation(face) === 'reversed') {
        sn = { x: -sn.x, y: -sn.y, z: -sn.z }
      }
      // P - R * outward_geometric_normal = point on cylinder axis
      const origin: number[] = [
        p0[0] - cyl.radius * sn.x,
        p0[1] - cyl.radius * sn.y,
        p0[2] - cyl.radius * sn.z,
      ]
      params.origin = roundPoint(origin)
      params.axis = roundPoint(axisDir)
      params.radius = roundVal(cyl.radius)
    }
  } else if (surfaceType === 'cone') {
    const p0 = vec3ToArray(kernel.pointOnSurface(face, uMin, vMin))
    const p1 = vec3ToArray(kernel.pointOnSurface(face, uMin, vMin + 1))
    const axisDir = normalize([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]])
    if (axisDir) {
      params.origin = roundPoint(p0)
      params.axis = roundPoint(axisDir)
    }
  } else if (surfaceType === 'sphere') {
    // Python: sphere.Location() = center
    const center = kernel.getSurfaceCenterOfMass(face)
    params.center = roundPoint(vec3ToArray(center))
  } else if (surfaceType === 'torus') {
    // Python: torus.Location() = center on axis
    const center = kernel.getSurfaceCenterOfMass(face)
    params.center = roundPoint(vec3ToArray(center))
    const gn = geometricNormal(kernel, face, uMin, vMin)
    if (gn) params.axis = roundPoint(gn)
  }

  return Object.keys(params).length > 0 ? params : null
}

// ── Curve params (matches Python _curve_params) ──
function getCurveParams(kernel: BrepEngineApi, edge: BrepHandle): Record<string, unknown> | null {
  const curveType = kernel.curveType(edge)
  const params: Record<string, unknown> = {}

  if (curveType === 'line') {
    const { first } = kernel.curveParameters(edge)
    params.origin = roundPoint(vec3ToArray(kernel.curvePointAtParam(edge, first)))
    params.direction = roundPoint(vec3ToArray(kernel.curveTangent(edge, first)))
  } else if (curveType === 'circle') {
    const { first, last } = kernel.curveParameters(edge)
    const mid = (first + last) / 2
    const p0 = kernel.curvePointAtParam(edge, first)
    const pm = kernel.curvePointAtParam(edge, mid)
    params.center = roundPoint([(p0.x + pm.x) / 2, (p0.y + pm.y) / 2, (p0.z + pm.z) / 2])
    const quarter = (first * 3 + last) / 4
    const tA = kernel.curveTangent(edge, first)
    const tQ = kernel.curveTangent(edge, quarter)
    const crossVec: number[] = [
      tA.y * tQ.z - tA.z * tQ.y,
      tA.z * tQ.x - tA.x * tQ.z,
      tA.x * tQ.y - tA.y * tQ.x,
    ]
    const norm = normalize(crossVec)
    if (norm) params.axis = roundPoint(norm)
    const c = params.center as number[]
    const dx = p0.x - c[0], dy = p0.y - c[1], dz = p0.z - c[2]
    params.radius = roundVal(Math.sqrt(dx * dx + dy * dy + dz * dz))
  } else if (curveType === 'ellipse') {
    const { first, last } = kernel.curveParameters(edge)
    const mid = (first + last) / 2
    params.center = roundPoint(vec3ToArray(kernel.curvePointAtParam(edge, mid)))
  } else if (curveType === 'hyperbola') {
    const { first, last } = kernel.curveParameters(edge)
    const mid = (first + last) / 2
    params.center = roundPoint(vec3ToArray(kernel.curvePointAtParam(edge, mid)))
  } else if (curveType === 'parabola') {
    const { first, last } = kernel.curveParameters(edge)
    const mid = (first + last) / 2
    params.center = roundPoint(vec3ToArray(kernel.curvePointAtParam(edge, mid)))
  } else if (curveType === 'bezier' || curveType === 'bspline') {
    try {
      const nc = kernel.getNurbsCurveData(edge)
      if (nc) {
        params.degree = nc.degree
        params.periodic = nc.periodic
        params.rational = nc.rational
      }
    } catch {
      // getNurbsCurveData may fail for non-NURBS edges
    }
  }

  return Object.keys(params).length > 0 ? params : null
}

// ── Face flags (matches Python _face_flags) ──
function faceFlags(referenceable: boolean): number {
  return referenceable ? 0 : 1
}

// ── Edge flags (matches Python _edge_flags) ──
function edgeFlags(closed: boolean, degenerated: boolean, seam: boolean, referenceable: boolean): number {
  let flags = 0
  if (closed) flags |= 1
  if (degenerated) flags |= 2
  if (seam) flags |= 4
  if (!referenceable) flags |= 8
  return flags
}

// ── Extract face geometry from mesh data (matches Python _extract_face_geometry) ──
interface FaceGeometry {
  area: number
  center: number[]
  normal: number[] | null
  bbox: BBox
  triangleCount: number
}

function extractFaceGeometry(
  positions: Float32Array,
  indices: Uint32Array,
  triStart: number,
  triCount: number,
): FaceGeometry {
  if (triCount === 0) {
    return { area: 0, center: [0, 0, 0], normal: null, bbox: { min: [0, 0, 0], max: [0, 0, 0] }, triangleCount: 0 }
  }

  let areaSum = 0
  const centroidSum = [0, 0, 0]
  const normalSum = [0, 0, 0]
  const allNodes: number[][] = []
  const nodeSet = new Set<number>()

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[(triStart + t) * 3]
    const i1 = indices[(triStart + t) * 3 + 1]
    const i2 = indices[(triStart + t) * 3 + 2]
    nodeSet.add(i0)
    nodeSet.add(i1)
    nodeSet.add(i2)

    const p0: number[] = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]]
    const p1: number[] = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]]
    const p2: number[] = [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]]

    const [nx, ny, nz] = cross(p0, p1, p2)
    const twiceArea = Math.sqrt(nx * nx + ny * ny + nz * nz)
    // Python uses twiceArea <= 1e-9 to skip degenerate triangles
    if (twiceArea <= 1e-9) continue

    const area = twiceArea * 0.5
    centroidSum[0] += (p0[0] + p1[0] + p2[0]) * area / 3
    centroidSum[1] += (p0[1] + p1[1] + p2[1]) * area / 3
    centroidSum[2] += (p0[2] + p1[2] + p2[2]) * area / 3
    areaSum += area

    // Area-weighted normal sum (matches Python: raw cross products, not unit vectors).
    // Python sums the raw cross products (proportional to triangle area) and
    // normalizes at the end. This gives the area-weighted face normal.
    normalSum[0] += nx
    normalSum[1] += ny
    normalSum[2] += nz
  }

  for (const ni of nodeSet) {
    allNodes.push([positions[ni * 3], positions[ni * 3 + 1], positions[ni * 3 + 2]])
  }

  let center: number[]
  if (allNodes.length === 0) {
    center = [0, 0, 0]
  } else if (areaSum > 1e-12) {
    center = [centroidSum[0] / areaSum, centroidSum[1] / areaSum, centroidSum[2] / areaSum]
  } else {
    center = fullBBoxFromPoints(allNodes).center
  }

  const normal = normalize([normalSum[0], normalSum[1], normalSum[2]])
  const b = fullBBoxFromPoints(allNodes)
  const bbox: BBox = { min: b.min, max: b.max }

  return { area: areaSum, center, normal, bbox, triangleCount: areaSum > 0 ? 1 : 0 }
}

// ── Build a hash→ordinal lookup for fast edge matching ──
// Uses the same TopTools_ShapeMapHasher as the C++ facade, so hashes
// are consistent across getSubShapes, wireframe, meshShape, and hashCode.
// Collisions (extremely rare with HASH_BOUND=INT32_MAX) are resolved by
// isSame() — the OCCT identity check.
function buildEdgeOrdLookup(
  kernel: BrepEngineApi,
  edgeHandles: BrepHandle[],
): Map<number, number[]> {
  const lookup = new Map<number, number[]>()
  for (let ei = 0; ei < edgeHandles.length; ei++) {
    const h = kernel.hashCode(edgeHandles[ei], HASH_BOUND)
    const list = lookup.get(h)
    if (list) list.push(ei + 1)
    else lookup.set(h, [ei + 1])
  }
  return lookup
}

function buildFaceOrdLookup(
  kernel: BrepEngineApi,
  faceHandles: BrepHandle[],
): Map<number, number[]> {
  const lookup = new Map<number, number[]>()
  for (let fi = 0; fi < faceHandles.length; fi++) {
    const h = kernel.hashCode(faceHandles[fi], HASH_BOUND)
    const list = lookup.get(h)
    if (list) list.push(fi + 1)
    else lookup.set(h, [fi + 1])
  }
  return lookup
}

// Find the global ordinal of a sub-shape by hash lookup + isSame collision resolution
function findOrdinal(
  kernel: BrepEngineApi,
  subShape: BrepHandle,
  globalHandles: BrepHandle[],
  lookup: Map<number, number[]>,
): number | undefined {
  const h = kernel.hashCode(subShape, HASH_BOUND)
  const candidates = lookup.get(h)
  if (!candidates) return undefined
  for (const ord of candidates) {
    if (kernel.isSame(subShape, globalHandles[ord - 1])) return ord
  }
  return undefined
}

export function buildSelectorManifest(
  kernel: BrepEngineApi,
  input: SelectorManifestInput,
  { stepHash, cadPath }: SelectorManifestOptions,
  occurrenceId: string = 'o1',
): { manifest: Record<string, unknown>; buffers: Record<string, Float32Array | Uint32Array> } {
  const shape = input.shapeHandle
  const mesh = input.meshWithGroups
  const posArr = mesh.positions
  const normArr = mesh.normals
  const idxArr = mesh.indices
  const faceGroups = mesh.faceGroups ?? new Int32Array(0)

  // ── 1. Enumerate faces and edges ──
  // getSubShapes uses TopExp::MapShapes + NCollection_IndexedMap — the same
  // enumeration method as wireframe() and meshShape(), so ordinals are
  // consistent with kernel-generated faceGroups/edgeGroups.
  const faceHandles = kernel.getSubShapes(shape, 'face')
  const edgeHandles = kernel.getSubShapes(shape, 'edge')
  const faceCount = faceHandles.length
  const edgeCount = edgeHandles.length

  // ── 2. Build hash→data maps from kernel-generated buffers ──

  // Face hash → {triStart, triCount} from mesh.faceGroups.
  // faceGroups format: [triStart_idx, triCount_idx, faceHash] — values are in
  // index units (3 per triangle). Faces without triangulation are skipped by
  // the C++ side, so faceGroups may have fewer entries than faceCount.
  const faceGroupByHash = new Map<number, { triStart: number; triCount: number }>()
  for (let gi = 0; gi * 3 + 2 < faceGroups.length; gi++) {
    const triStartIdx = faceGroups[gi * 3]       // index offset
    const triCountIdx = faceGroups[gi * 3 + 1]    // index count
    const faceHash = faceGroups[gi * 3 + 2]
    // Convert from index units to triangle units
    faceGroupByHash.set(faceHash, { triStart: triStartIdx / 3, triCount: triCountIdx / 3 })
  }

  // Edge hash → {pointStart, pointCount} from wireframe().edgeGroups.
  // wireframe() uses TopExp::MapShapes + IndexedMap (same as getSubShapes),
  // so edge ordinals match. edgeGroups format: [pointStart_float,
  // pointCount_float, edgeHash] — values are in float units (3 per point).
  // Each edge gets its own independent polyline (NOT connected chains).
  const shapeBbox = tryGetBoundingBox(kernel, shape, posArr)
  const shapeDiag = Math.sqrt(
    (shapeBbox.xmax - shapeBbox.xmin) ** 2 +
    (shapeBbox.ymax - shapeBbox.ymin) ** 2 +
    (shapeBbox.zmax - shapeBbox.zmin) ** 2,
  )
  // Deflection proportional to shape size: 0.1% of diagonal, min 0.01mm.
  // GCPnts_TangentialDeflection adapts to curvature automatically.
  const wireframeDeflection = Math.max(shapeDiag * 0.001, 0.01)
  const wfData = kernel.wireframe(shape, wireframeDeflection)
  const edgeGroupByHash = new Map<number, { pointStart: number; pointCount: number }>()
  for (let ei = 0; ei * 3 + 2 < wfData.edgeGroups.length; ei++) {
    const pointStart = wfData.edgeGroups[ei * 3]      // float offset
    const pointCount = wfData.edgeGroups[ei * 3 + 1]    // float count
    const edgeHash = wfData.edgeGroups[ei * 3 + 2]
    edgeGroupByHash.set(edgeHash, { pointStart, pointCount })
  }

  // ── 3. Build face→edge and edge→face ordinals via isSame() ──
  // For each face, enumerate its edges (getSubShapes deduplicates via
  // IndexedMap, so seam edges appear once). Match each face edge to its
  // global ordinal by hash lookup + isSame() collision resolution.
  const edgeOrdLookup = buildEdgeOrdLookup(kernel, edgeHandles)
  const faceEdgeOrdinals: number[][] = []
  const edgeFaceOrdinals: number[][] = []
  for (let ei = 0; ei < edgeCount; ei++) edgeFaceOrdinals.push([])

  for (let fi = 0; fi < faceCount; fi++) {
    const faceEdges = kernel.getSubShapes(faceHandles[fi], 'edge')
    const ords: number[] = []
    const seen = new Set<number>()
    for (const fe of faceEdges) {
      const ord = findOrdinal(kernel, fe, edgeHandles, edgeOrdLookup)
      if (ord !== undefined && !seen.has(ord)) {
        seen.add(ord)
        ords.push(ord)
        edgeFaceOrdinals[ord - 1].push(fi + 1)
      }
    }
    faceEdgeOrdinals.push(ords)
  }

  // ── 4. Detect seam edges ──
  // Real gap: no BRep_Tool.IsClosed(edge, face) API. Heuristic: in a closed
  // solid, every edge should be shared by exactly 2 faces. An edge with only 1
  // adjacent face means it appears twice in that face's wire (once for each
  // parametric direction) — IndexedMap deduplicates, so faceCount=1.
  // This applies to ALL edge types (line, circle, etc.), not just closed curves.
  // In an open shell, boundary edges also have faceCount=1, so we check isSolid.
  const isSolid = kernel.getSubShapes(shape, 'solid').length > 0
  const seamEdgeSet = new Set<number>()
  for (let ei = 0; ei < edgeCount; ei++) {
    if (isSolid && edgeFaceOrdinals[ei].length === 1) {
      seamEdgeSet.add(ei + 1)
    }
  }

  // ── 5. Build shape entries (SOLID/SHELL/compound) ──
  const solidHandles = kernel.getSubShapes(shape, 'solid')
  const shellHandles = kernel.getSubShapes(shape, 'shell')
  type ShapeEntry = { ordinal: number; shape: BrepHandle; kind: string }
  let shapeEntries: ShapeEntry[]
  if (solidHandles.length > 0) {
    shapeEntries = solidHandles.map((s, i) => ({ ordinal: i + 1, shape: s, kind: 'solid' }))
  } else if (shellHandles.length > 0) {
    shapeEntries = shellHandles.map((s, i) => ({ ordinal: i + 1, shape: s, kind: 'shell' }))
  } else {
    shapeEntries = [{ ordinal: 1, shape, kind: 'compound' }]
  }
  if (shapeEntries.length === 0 && (faceCount > 0 || edgeCount > 0)) {
    shapeEntries = [{ ordinal: 1, shape, kind: 'compound' }]
  }

  // Build shape→face and shape→edge ordinals via isSame()
  const faceOrdLookup = buildFaceOrdLookup(kernel, faceHandles)
  const shapeEntriesWithOrdinals = shapeEntries.map(entry => {
    const faceOrds: number[] = []
    const edgeOrds: number[] = []
    const faceSeen = new Set<number>()
    const edgeSeen = new Set<number>()
    const entryFaces = kernel.getSubShapes(entry.shape, 'face')
    for (const f of entryFaces) {
      const ord = findOrdinal(kernel, f, faceHandles, faceOrdLookup)
      if (ord !== undefined && !faceSeen.has(ord)) { faceOrds.push(ord); faceSeen.add(ord) }
    }
    const entryEdges = kernel.getSubShapes(entry.shape, 'edge')
    for (const e of entryEdges) {
      const ord = findOrdinal(kernel, e, edgeHandles, edgeOrdLookup)
      if (ord !== undefined && !edgeSeen.has(ord)) { edgeOrds.push(ord); edgeSeen.add(ord) }
    }
    return { ...entry, faceOrdinals: faceOrds, edgeOrdinals: edgeOrds }
  })

  const occId = asOccurrenceId(occurrenceId)
  const shapeId = asShapeId(`${occId}.s1`)

  // ── 6. Build edge rows — wireframe polyline per edge ──
  // Each edge's polyline comes from kernel.wireframe() (GCPnts_TangentialDeflection),
  // looked up by edge hash. Line edges use exactly 2 endpoints for 1 segment.
  const edgeRows: unknown[][] = []
  const edgePositionsData: number[] = []
  const edgeIndicesData: number[] = []
  const edgeIdsData: number[] = []
  let totalEdgeLength = 0
  const edgeBboxes: BBox[] = []
  const maxEdgePoints = 30

  for (let ei = 0; ei < edgeCount; ei++) {
    const edge = edgeHandles[ei]
    const ordinal = ei + 1
    const curveType = kernel.curveType(edge)
    const curveLen = kernel.curveLength(edge)

    // Look up edge polyline from wireframe data by hash
    const edgeHash = kernel.hashCode(edge, HASH_BOUND)
    const egEntry = edgeGroupByHash.get(edgeHash)

    let polyline: number[][]
    if (curveType === 'line') {
      // Line edges: exactly 2 endpoints → 1 segment (wireframe also produces
      // 2 points for lines, but this guarantees it)
      const { first, last } = kernel.curveParameters(edge)
      const pt0 = kernel.curvePointAtParam(edge, first)
      const pt1 = kernel.curvePointAtParam(edge, last)
      polyline = [[pt0.x, pt0.y, pt0.z], [pt1.x, pt1.y, pt1.z]]
    } else if (egEntry) {
      // Curved edges: extract polyline from wireframe data
      polyline = extractEdgePolylineFromWireframe(
        wfData.points, egEntry.pointStart, egEntry.pointCount, maxEdgePoints,
      )
      // Fallback to curve sampling if wireframe gave too few points
      if (polyline.length < 2) {
        const { first, last } = kernel.curveParameters(edge)
        const numPts = Math.min(maxEdgePoints, Math.max(2, Math.ceil(curveLen / 7.5) + 1))
        polyline = []
        for (let p = 0; p < numPts; p++) {
          const t = numPts > 1 ? first + (last - first) * p / (numPts - 1) : first
          const pt = kernel.curvePointAtParam(edge, t)
          polyline.push([pt.x, pt.y, pt.z])
        }
      }
    } else {
      // No wireframe match — fall back to curve sampling
      const { first, last } = kernel.curveParameters(edge)
      const numPts = Math.min(maxEdgePoints, Math.max(2, Math.ceil(curveLen / 7.5) + 1))
      polyline = []
      for (let p = 0; p < numPts; p++) {
        const t = numPts > 1 ? first + (last - first) * p / (numPts - 1) : first
        const pt = kernel.curvePointAtParam(edge, t)
        polyline.push([pt.x, pt.y, pt.z])
      }
    }

    // Edge bbox from polyline points (matches Python _bbox_from_points).
    const edgeBBoxPts = polyline.length >= 2 ? polyline : []
    const efbb = fullBBoxFromPoints(edgeBBoxPts)
    const bb: BBox = { min: efbb.min, max: efbb.max }
    edgeBboxes.push(bb)

    // Edge properties
    const closed = kernel.curveIsClosed(edge)

    // Edge length: polyline chord length (matches Python _polyline_length)
    const edgeLen = polyline.length >= 2 ? polylineLength(polyline, closed) : curveLen
    totalEdgeLength += edgeLen

    // Edge center: arithmetic mean of polyline points (matches Python _polyline_center)
    const center = polyline.length >= 2 ? polylineCenter(polyline) : [0, 0, 0]

    const segmentStart = edgeIdsData.length

    // Build edge proxy data from polyline
    if (polyline.length >= 2) {
      const vertexOffset = edgePositionsData.length / 3
      for (const pt of polyline) {
        edgePositionsData.push(pt[0], pt[1], pt[2])
      }
      for (let s = 0; s < polyline.length - 1; s++) {
        edgeIndicesData.push(vertexOffset + s, vertexOffset + s + 1)
        edgeIdsData.push(ei)
      }
      // Closed edge closing segment (matches Python)
      if (closed && distance(polyline[0], polyline[polyline.length - 1]) > 1e-9) {
        edgeIndicesData.push(vertexOffset + polyline.length - 1, vertexOffset)
        edgeIdsData.push(ei)
      }
    }

    const params = getCurveParams(kernel, edge)
    const segmentCountFinal = edgeIdsData.length - segmentStart

    edgeRows.push([
      asEdgeId(`${occId}.e${ordinal}`), occId, shapeId, ordinal, curveType, roundVal(edgeLen),
      roundPoint(center), bboxArray(bb),
      0, 0, // faceStart, faceCount — filled later
      0, 0, // relevance, flags
      params, segmentStart, segmentCountFinal,
    ])
  }

  // ── 7. Build face rows — hash-based triangle lookup ──
  const faceRows: unknown[][] = []
  const faceRunData: number[] = []
  let totalFaceArea = 0
  const faceBboxes: BBox[] = []

  for (let fi = 0; fi < faceCount; fi++) {
    const face = faceHandles[fi]
    const ordinal = fi + 1

    // Look up triangle data by face hash (pure hash Map, no index fallback).
    // No match (face without triangulation) → triStart/triCount = 0.
    const fh = kernel.hashCode(face, HASH_BOUND)
    const fgEntry = faceGroupByHash.get(fh)
    const triStart = fgEntry ? fgEntry.triStart : 0
    const triCount = fgEntry ? fgEntry.triCount : 0

    // Extract face geometry with degenerate triangle filtering
    const geom = extractFaceGeometry(posArr, idxArr, triStart, triCount)

    const surfaceType = kernel.surfaceType(face)
    const area = geom.area
    totalFaceArea += area
    const center = geom.center
    const bb = geom.bbox
    faceBboxes.push(bb)

    // Face normal: for planar faces, use mesh-based area-weighted cross products.
    // For non-planar faces, use per-vertex normals from mesh.normals (computed
    // by OCCT's own normal estimator) averaged over the face's triangles.
    let normal = geom.normal
    if (surfaceType !== 'plane' && triCount > 0) {
      const ns = [0, 0, 0]
      for (let t = 0; t < triCount; t++) {
        for (let vi = 0; vi < 3; vi++) {
          const idx = idxArr[(triStart + t) * 3 + vi]
          ns[0] += normArr[idx * 3]
          ns[1] += normArr[idx * 3 + 1]
          ns[2] += normArr[idx * 3 + 2]
        }
      }
      const meshNormal = normalize(ns)
      if (meshNormal) normal = meshNormal
    }
    if (!normal) normal = [0, 0, 1]

    const params = getSurfaceParams(kernel, face)

    faceRows.push([
      asFaceId(`${occId}.f${ordinal}`), occId, shapeId, ordinal, surfaceType, roundVal(area),
      roundPoint(center), normal ? roundPoint(normal) : null, bboxArray(bb),
      0, 0, // edgeStart, edgeCount — filled later
      0, 0, // relevance, flags
      params, triStart, triCount,
    ])

    if (triCount > 0) {
      faceRunData.push(0, 0, triStart, triCount, fi)
    }
  }

  // ── 8. Build face→edge and edge→face relation tables ──
  const faceEdgeRowsData: number[] = []
  const edgeFaceRowsData: number[] = []

  for (let fi = 0; fi < faceCount; fi++) {
    const edgeOrds = faceEdgeOrdinals[fi]
    const edgeStart = faceEdgeRowsData.length
    ;(faceRows[fi] as unknown[])[9] = edgeStart
    ;(faceRows[fi] as unknown[])[10] = edgeOrds.length
    for (const eo of edgeOrds) {
      faceEdgeRowsData.push(eo - 1)
    }
  }

  for (let ei = 0; ei < edgeCount; ei++) {
    const faceOrds = edgeFaceOrdinals[ei]
    const faceStart = edgeFaceRowsData.length
    ;(edgeRows[ei] as unknown[])[8] = faceStart
    ;(edgeRows[ei] as unknown[])[9] = faceOrds.length
    for (const fo of faceOrds) {
      edgeFaceRowsData.push(fo - 1)
    }
  }

  // ── 9. Compute relevance scores (matches Python) ──
  const mergedBbox = faceBboxes.length > 0 ? mergeBboxes(faceBboxes) : { min: [0, 0, 0], max: [0, 0, 0] }
  const mergedDiag = Math.sqrt(
    (mergedBbox.max[0] - mergedBbox.min[0]) ** 2 +
    (mergedBbox.max[1] - mergedBbox.min[1]) ** 2 +
    (mergedBbox.max[2] - mergedBbox.min[2]) ** 2,
  )
  const totalArea = Math.max(totalFaceArea, 1e-12)
  const totalLength = Math.max(totalEdgeLength, 1e-12)
  const sizeFloor = Math.max(mergedDiag * mergedDiag * 1e-6, 1e-12)
  const lengthFloor = Math.max(mergedDiag * 1e-5, 1e-12)

  for (let fi = 0; fi < faceRows.length; fi++) {
    const area = faceRows[fi][5] as number
    const surfaceType = faceRows[fi][4] as string
    let score = 100 * Math.sqrt(Math.max(area, 0) / totalArea)
    if (['plane', 'cylinder', 'cone', 'sphere', 'torus'].includes(surfaceType)) score += 8
    if (area < sizeFloor) score -= 45
    const triCount = faceRows[fi][15] as number
    const ref = triCount > 0 && area > 1e-12
    if (!ref) score = 0
    ;(faceRows[fi] as unknown[])[11] = Math.max(0, Math.min(100, Math.round(score)))
    ;(faceRows[fi] as unknown[])[12] = faceFlags(ref)
  }

  for (let ei = 0; ei < edgeRows.length; ei++) {
    const length = edgeRows[ei][5] as number
    const curveType = edgeRows[ei][4] as string
    const edge = edgeHandles[ei]
    const closed = kernel.curveIsClosed(edge)
    const degenerated = kernel.curveLength(edge) < 1e-12
    const seam = seamEdgeSet.has(ei + 1)
    const segmentCount = edgeRows[ei][14] as number
    const ref = !degenerated && segmentCount > 0

    let score = 100 * Math.sqrt(Math.max(length, 0) / totalLength)
    if (['line', 'circle', 'ellipse'].includes(curveType)) score += 10
    if (seam) score -= 30
    if (degenerated) score -= 80
    if (length < lengthFloor) score -= 35
    if (!ref) score = 0
    ;(edgeRows[ei] as unknown[])[10] = Math.max(0, Math.min(100, Math.round(score)))
    ;(edgeRows[ei] as unknown[])[11] = edgeFlags(closed, degenerated, seam, ref)
  }

  // ── 11. Build shape rows (matches Python emit_leaf) ──
  const shapeRows: unknown[][] = []
  for (const entry of shapeEntriesWithOrdinals) {
    const bboxes: BBox[] = entry.faceOrdinals
      .map(fo => faceBboxes[fo - 1])
      .filter((b): b is BBox => !!b)
    const entryBbox = bboxes.length > 0 ? mergeBboxes(bboxes) : bboxFromOcc(tryGetBoundingBox(kernel, entry.shape, posArr))
    const entryArea = entry.faceOrdinals.reduce((sum, fo) => sum + (faceRows[fo - 1][5] as number), 0)
    let entryVolume: number | null = null
    let entryCenter: number[]
    if (entry.kind === 'solid') {
      entryVolume = kernel.getVolume(entry.shape)
      const cm = kernel.getCenterOfMass(entry.shape)
      entryCenter = [cm.x, cm.y, cm.z]
    } else {
      entryCenter = bboxCenter(entryBbox)
    }

    const firstFaceGlobal = entry.faceOrdinals.length > 0 ? entry.faceOrdinals[0] - 1 : faceRows.length
    const firstEdgeGlobal = entry.edgeOrdinals.length > 0 ? entry.edgeOrdinals[0] - 1 : edgeRows.length

    shapeRows.push([
      asShapeId(`${occId}.s${entry.ordinal}`), occId, entry.ordinal, entry.kind,
      bboxArray(entryBbox), roundPoint(entryCenter), roundVal(entryArea), entryVolume !== null ? roundVal(entryVolume) : null,
      firstFaceGlobal, entry.faceOrdinals.length,
      firstEdgeGlobal, entry.edgeOrdinals.length,
    ])
  }

  // ── 12. Build occurrence rows ──
  const meshBbox = faceBboxes.length > 0 ? mergedBbox : { min: [0, 0, 0], max: [0, 0, 0] }
  const occurrenceRows: unknown[][] = [[
    occId, '1', null, null, null, IDENTITY_16, bboxArray(meshBbox),
    0, shapeRows.length, 0, faceRows.length, 0, edgeRows.length,
  ]]

  // ── 13. Build manifest ──
  const manifest: Record<string, unknown> = {
    schemaVersion: 2,
    profile: 'selector',
    cadRef: cadPath,
    stepPath: cadPath ? `${cadPath}.step` : undefined,
    stepHash,
    bbox: bboxArray(meshBbox),
    stats: {
      occurrenceCount: occurrenceRows.length,
      leafOccurrenceCount: occurrenceRows.length,
      shapeCount: shapeRows.length,
      faceCount: faceRows.length,
      edgeCount: edgeRows.length,
      faceProxyRunCount: faceRunData.length / 5,
      edgeProxyPointCount: edgePositionsData.length / 3,
      edgeProxySegmentCount: edgeIdsData.length,
    },
    tables: {
      occurrenceColumns: OCCURRENCE_COLUMNS,
      shapeColumns: SHAPE_COLUMNS,
      faceColumns: FACE_COLUMNS,
      edgeColumns: EDGE_COLUMNS,
    },
    occurrences: occurrenceRows,
    shapes: shapeRows,
    faces: faceRows,
    edges: edgeRows,
    faceProxy: {
      source: cadPath ? `.${cadPath.split(/[/\\]/).pop()!}.step.3mf` : undefined,
      runsView: 'faceRuns',
      runColumns: ['occurrenceRow', 'primitiveIndex', 'triangleStart', 'triangleCount', 'faceRow'],
    },
    edgeProxy: {
      positionsView: 'edgePositions',
      indicesView: 'edgeIndices',
      edgeIdsView: 'edgeIds',
    },
    relations: {
      faceEdgeRowsView: 'faceEdgeRows',
      edgeFaceRowsView: 'edgeFaceRows',
    },
  }

  const buffers: Record<string, Float32Array | Uint32Array> = {
    faceRuns: new Uint32Array(faceRunData),
    edgePositions: new Float32Array(edgePositionsData),
    edgeIndices: new Uint32Array(edgeIndicesData),
    edgeIds: new Uint32Array(edgeIdsData),
    faceEdgeRows: new Uint32Array(faceEdgeRowsData),
    edgeFaceRows: new Uint32Array(edgeFaceRowsData),
  }

  return { manifest, buffers }
}

// ── Assembly-level topology ──

/** Input for per-part topology identification in an assembly. */
export interface PartTopologyInput {
  labelPath: string
  shapeHandle: BrepHandle
  meshWithGroups: BrepMeshResult
}

/** Result of assembly-level topology identification. */
export interface AssemblyTopologyResult {
  manifest: Record<string, unknown>
  buffers: Record<string, Float32Array | Uint32Array>
}

/**
 * Build a selector manifest for an assembly (multi-part) topology.
 *
 * For each part, runs the per-part topology identification (face/edge enumeration,
 * wireframe, relations) and merges into a single assembly manifest.
 *
 * Occurrence IDs use the part's labelPath (e.g., "o0", "o0.o1").
 *
 * Face/edge triangle ranges are per-mesh (each part has its own mesh),
 * identified by the occurrenceRow index in faceRuns.
 */
export function buildAssemblySelectorManifest(
  kernel: BrepEngineApi,
  parts: PartTopologyInput[],
  opts: SelectorManifestOptions = {},
): AssemblyTopologyResult {
  const { stepHash, cadPath } = opts

  // Accumulated data
  const allOccurrences: unknown[][] = []
  const allShapes: unknown[][] = []
  const allFaces: unknown[][] = []
  const allEdges: unknown[][] = []

  // Buffer accumulators
  const faceRunData: number[] = []
  const edgePositionsData: number[] = []
  const edgeIndicesData: number[] = []
  const edgeIdsData: number[] = []
  const faceEdgeRowsData: number[] = []
  const edgeFaceRowsData: number[] = []

  let totalFaceArea = 0
  let totalEdgeLength = 0
  const allFaceBboxes: BBox[] = []
  const allEdgeBboxes: BBox[] = []

  // Process each part
  for (let partIdx = 0; partIdx < parts.length; partIdx++) {
    const part = parts[partIdx]
    const occId = asOccurrenceId(part.labelPath)

    // Run per-part manifest (uses the existing buildSelectorManifest logic)
    const partResult = buildSelectorManifest(
      kernel,
      { shapeHandle: part.shapeHandle, meshWithGroups: part.meshWithGroups },
      { stepHash, cadPath },
      occId,
    )
    const partManifest = partResult.manifest
    const partBuffers = partResult.buffers

    // Extract per-part data
    const partOcc = (partManifest.occurrences as unknown[][]) ?? []
    const partShapes = (partManifest.shapes as unknown[][]) ?? []
    const partFaces = (partManifest.faces as unknown[][]) ?? []
    const partEdges = (partManifest.edges as unknown[][]) ?? []

    const occRowIdx = allOccurrences.length // 0-based occurrence index for this part

    // Occurrence row: use labelPath as id, parentId null (flat for now)
    // CRITICAL: update shapeStart/faceStart/edgeStart to GLOBAL indices.
    // buildSelectorManifest sets them to 0 (local), so without this fix
    // every part's occurrence points to part 0's shapes/faces/edges.
    const globalShapeStart = allShapes.length
    const globalFaceStart = allFaces.length
    const globalEdgeStart = allEdges.length
    for (const occ of partOcc) {
      const row = [...occ] as unknown[]
      row[0] = occId       // id
      row[1] = occId       // path
      row[2] = ''          // name (from XCAF, not available here)
      row[3] = ''          // sourceName
      row[4] = null        // parentId (flat for now)
      row[7] = globalShapeStart  // shapeStart (global)
      // row[8] shapeCount — already correct (local count = global count for this part)
      row[9] = globalFaceStart   // faceStart (global)
      // row[10] faceCount — already correct
      row[11] = globalEdgeStart  // edgeStart (global)
      // row[12] edgeCount — already correct
      allOccurrences.push(row)
    }

    // Shape rows: replace occurrenceId
    for (const shape of partShapes) {
      const row = [...shape] as unknown[]
      row[1] = occId  // occurrenceId
      // Update faceStart/faceCount/edgeStart/edgeCount to global indices
      const faceCount = row[9] as number
      const edgeCount = row[11] as number
      row[8] = allFaces.length  // global faceStart
      row[9] = faceCount
      row[10] = allEdges.length  // global edgeStart
      row[11] = edgeCount
      allShapes.push(row)
    }

    // Face rows: replace occurrenceId/shapeId, update triangleStart (per-mesh,
    // keep local), update edgeStart/edgeCount to global indices
    const partFaceEdgeStart = faceEdgeRowsData.length
    for (let fi = 0; fi < partFaces.length; fi++) {
      const face = [...partFaces[fi]] as unknown[]
      face[1] = occId  // occurrenceId
      face[2] = asShapeId(`${occId}.s1`)  // shapeId
      // Update edgeStart/edgeCount to global indices
      const edgeStart = face[9] as number
      const edgeCount = face[10] as number
      face[9] = partFaceEdgeStart + edgeStart  // global faceEdgeRows offset
      face[10] = edgeCount
      // triangleStart/triangleCount stay local (per-mesh)
      allFaces.push(face)
      totalFaceArea += (face[5] as number)
      // Collect bbox for global merge
      const fb = face[8] as Record<string, number[]>
      if (fb?.min && fb?.max) {
        allFaceBboxes.push({ min: fb.min, max: fb.max })
      }
    }

    // Edge rows: replace occurrenceId/shapeId, update faceStart/faceCount
    const partEdgeFaceStart = edgeFaceRowsData.length
    for (let ei = 0; ei < partEdges.length; ei++) {
      const edge = [...partEdges[ei]] as unknown[]
      edge[1] = occId  // occurrenceId
      edge[2] = asShapeId(`${occId}.s1`)  // shapeId
      // Update faceStart/faceCount to global indices
      const faceStart = edge[8] as number
      const edgeCount = edge[9] as number
      edge[8] = partEdgeFaceStart + faceStart  // global edgeFaceRows offset
      edge[9] = edgeCount
      // Update segmentStart to global offset
      const segCount = edge[14] as number
      edge[13] = edgeIdsData.length  // global segmentStart (will be set below)
      edge[14] = segCount
      allEdges.push(edge)
      totalEdgeLength += (edge[5] as number)
      // Collect bbox
      const eb = edge[7] as Record<string, number[]>
      if (eb?.min && eb?.max) {
        allEdgeBboxes.push({ min: eb.min, max: eb.max })
      }
    }

    // Merge faceRuns: update occurrenceRow to global index
    const partFaceRuns = (partBuffers.faceRuns as Uint32Array) ?? new Uint32Array(0)
    for (let ri = 0; ri < partFaceRuns.length; ri += 5) {
      faceRunData.push(
        occRowIdx,                          // occurrenceRow (global)
        partFaceRuns[ri + 1],               // primitiveIndex
        partFaceRuns[ri + 2],               // triangleStart (local to mesh)
        partFaceRuns[ri + 3],               // triangleCount
        allFaces.length - partFaces.length + partFaceRuns[ri + 4], // faceRow (global)
      )
    }

    // Merge edge proxy buffers
    const partEdgePos = (partBuffers.edgePositions as Float32Array) ?? new Float32Array(0)
    const partEdgeIdx = (partBuffers.edgeIndices as Uint32Array) ?? new Uint32Array(0)
    const partEdgeIds = (partBuffers.edgeIds as Uint32Array) ?? new Uint32Array(0)

    // Edge positions: concatenate (vertex offset = current length / 3)
    const vertexOffset = edgePositionsData.length / 3
    for (let p = 0; p < partEdgePos.length; p++) {
      edgePositionsData.push(partEdgePos[p])
    }
    // Edge indices: add vertex offset to each index (indices reference edgePositions)
    for (let p = 0; p < partEdgeIdx.length; p++) {
      edgeIndicesData.push(partEdgeIdx[p] + vertexOffset)
    }
    // Edge IDs: offset by global edge index base
    const edgeIdBase = allEdges.length - partEdges.length
    for (let p = 0; p < partEdgeIds.length; p++) {
      edgeIdsData.push(partEdgeIds[p] + edgeIdBase)
    }

    // Merge relation buffers
    const partFaceEdgeRows = (partBuffers.faceEdgeRows as Uint32Array) ?? new Uint32Array(0)
    for (let p = 0; p < partFaceEdgeRows.length; p++) {
      faceEdgeRowsData.push(partFaceEdgeRows[p])
    }

    const partEdgeFaceRows = (partBuffers.edgeFaceRows as Uint32Array) ?? new Uint32Array(0)
    for (let p = 0; p < partEdgeFaceRows.length; p++) {
      edgeFaceRowsData.push(partEdgeFaceRows[p])
    }

    // Fix edge segmentStart (now that we know the global offset)
    const segBase = edgeIdsData.length - partEdgeIds.length
    for (let ei = 0; ei < partEdges.length; ei++) {
      const globalEdgeIdx = allEdges.length - partEdges.length + ei
      const origSegStart = partEdges[ei][13] as number
      ;(allEdges[globalEdgeIdx] as unknown[])[13] = segBase + origSegStart
    }
  }

  // Compute merged bbox
  const mergedBbox = allFaceBboxes.length > 0
    ? mergeBboxes(allFaceBboxes)
    : { min: [0, 0, 0], max: [0, 0, 0] }

  // Recompute relevance scores for assembly (global scale)
  const mergedDiag = Math.sqrt(
    (mergedBbox.max[0] - mergedBbox.min[0]) ** 2 +
    (mergedBbox.max[1] - mergedBbox.min[1]) ** 2 +
    (mergedBbox.max[2] - mergedBbox.min[2]) ** 2,
  )
  const totalArea = Math.max(totalFaceArea, 1e-12)
  const totalLength = Math.max(totalEdgeLength, 1e-12)
  const sizeFloor = Math.max(mergedDiag * mergedDiag * 1e-6, 1e-12)
  const lengthFloor = Math.max(mergedDiag * 1e-5, 1e-12)

  for (let fi = 0; fi < allFaces.length; fi++) {
    const area = allFaces[fi][5] as number
    const surfaceType = allFaces[fi][4] as string
    let score = 100 * Math.sqrt(Math.max(area, 0) / totalArea)
    if (['plane', 'cylinder', 'cone', 'sphere', 'torus'].includes(surfaceType)) score += 8
    if (area < sizeFloor) score -= 45
    const triCount = allFaces[fi][15] as number
    const ref = triCount > 0 && area > 1e-12
    if (!ref) score = 0
    ;(allFaces[fi] as unknown[])[11] = Math.max(0, Math.min(100, Math.round(score)))
    ;(allFaces[fi] as unknown[])[12] = faceFlags(ref)
  }

  for (let ei = 0; ei < allEdges.length; ei++) {
    const length = allEdges[ei][5] as number
    const curveType = allEdges[ei][4] as string
    const segCount = allEdges[ei][14] as number
    const ref = segCount > 0 && length > 1e-12
    let score = 100 * Math.sqrt(Math.max(length, 0) / totalLength)
    if (['line', 'circle', 'ellipse'].includes(curveType)) score += 10
    if (length < lengthFloor) score -= 35
    if (!ref) score = 0
    ;(allEdges[ei] as unknown[])[10] = Math.max(0, Math.min(100, Math.round(score)))
    // flags already set per-part
  }

  // Build assembly manifest
  const manifest: Record<string, unknown> = {
    schemaVersion: 2,
    profile: 'selector',
    cadRef: cadPath,
    stepPath: cadPath ? `${cadPath}.step` : undefined,
    stepHash,
    bbox: bboxArray(mergedBbox),
    stats: {
      occurrenceCount: allOccurrences.length,
      leafOccurrenceCount: allOccurrences.length,
      shapeCount: allShapes.length,
      faceCount: allFaces.length,
      edgeCount: allEdges.length,
      faceProxyRunCount: faceRunData.length / 5,
      edgeProxyPointCount: edgePositionsData.length / 3,
      edgeProxySegmentCount: edgeIdsData.length,
    },
    tables: {
      occurrenceColumns: OCCURRENCE_COLUMNS,
      shapeColumns: SHAPE_COLUMNS,
      faceColumns: FACE_COLUMNS,
      edgeColumns: EDGE_COLUMNS,
    },
    occurrences: allOccurrences,
    shapes: allShapes,
    faces: allFaces,
    edges: allEdges,
    faceProxy: {
      source: cadPath ? `.${cadPath.split(/[/\\]/).pop()!}.step.3mf` : undefined,
      runsView: 'faceRuns',
      runColumns: ['occurrenceRow', 'primitiveIndex', 'triangleStart', 'triangleCount', 'faceRow'],
    },
    edgeProxy: {
      positionsView: 'edgePositions',
      indicesView: 'edgeIndices',
      edgeIdsView: 'edgeIds',
    },
    relations: {
      faceEdgeRowsView: 'faceEdgeRows',
      edgeFaceRowsView: 'edgeFaceRows',
    },
  }

  const buffers: Record<string, Float32Array | Uint32Array> = {
    faceRuns: new Uint32Array(faceRunData),
    edgePositions: new Float32Array(edgePositionsData),
    edgeIndices: new Uint32Array(edgeIndicesData),
    edgeIds: new Uint32Array(edgeIdsData),
    faceEdgeRows: new Uint32Array(faceEdgeRowsData),
    edgeFaceRows: new Uint32Array(edgeFaceRowsData),
  }

  return { manifest, buffers }
}
