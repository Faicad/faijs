/**
 * csg-core — CSG 纯计算函数（从 csg-worker.ts 提取）
 *
 * 设计文档：docs/faijs-engine-refactor-design.md §5.1
 *
 * 这些函数不依赖 Worker 环境（无 self.onmessage / postMessage），
 * 可被 WorkerCsgBackend（经 csg-worker.ts）和 InlineCsgBackend（主线程直跑）共用。
 *
 * 依赖：manifold-3d/manifoldCAD（Manifold / Mesh 构造器）、dovetail-math、joinery-shapes
 */

import type { Manifold as ManifoldInstance } from 'manifold-3d/manifold'
import {
  vec3Cross, vec3Normalize,
  type Vec3,
} from './dovetail-math'
import {
  buildWedgeGeometry,
  buildDowelGeometry,
  buildStraightTenonGeometry,
} from './joinery-shapes'

// ── 类型别名 ──

type ManifoldCtor = typeof import('manifold-3d/manifoldCAD').Manifold
type MeshCtor = typeof import('manifold-3d/manifoldCAD').Mesh

// ── Manifold → MeshData 转换 ──

/**
 * 从 Manifold 提取 {positions, indices}。
 * 处理 numProp > 3 的情况（manifold 可能含额外属性通道）。
 */
export function manifoldToMeshData(manifold: ManifoldInstance): {
  positions: Float32Array; indices: Uint32Array
} {
  const resultMesh = manifold.getMesh()
  const numProp = resultMesh.numProp || 3
  const vertPropsLen = resultMesh.vertProperties ? resultMesh.vertProperties.length : 0
  const vertCount = numProp > 0 ? Math.floor(vertPropsLen / numProp) : 0
  const positions = new Float32Array(vertCount * 3)
  for (let i = 0; i < vertCount; i++) {
    const base = i * numProp
    positions[i * 3] = resultMesh.vertProperties[base]
    positions[i * 3 + 1] = resultMesh.vertProperties[base + 1]
    positions[i * 3 + 2] = resultMesh.vertProperties[base + 2]
  }
  const triVerts = resultMesh.triVerts
  const indices = triVerts ? new Uint32Array(triVerts) : new Uint32Array(0)
  return { positions, indices }
}

// ── 顶点焊接 ──

/**
 * Weld duplicate vertices using quantized 1 µm grid.
 * Uses three nested numeric Maps (no string allocation).
 */
export function weldPositionsWorker(
  positions: Float32Array,
  indices: Uint32Array,
  count: number,
): { positions: Float32Array; indices: Uint32Array } {
  const mapX = new Map<number, Map<number, Map<number, number>>>()
  const weldedPosArr: number[] = []
  const weldedIdxArr: number[] = []

  for (let i = 0; i < count; i++) {
    const vi = indices[i]
    const x = positions[vi * 3]
    const y = positions[vi * 3 + 1]
    const z = positions[vi * 3 + 2]
    const qx = Math.round(x * 1e6)
    const qy = Math.round(y * 1e6)
    const qz = Math.round(z * 1e6)

    let mapY = mapX.get(qx)
    if (mapY === undefined) {
      mapY = new Map<number, Map<number, number>>()
      mapX.set(qx, mapY)
    }
    let mapZ = mapY.get(qy)
    if (mapZ === undefined) {
      mapZ = new Map<number, number>()
      mapY.set(qy, mapZ)
    }
    let ni = mapZ.get(qz)
    if (ni === undefined) {
      ni = weldedPosArr.length / 3
      mapZ.set(qz, ni)
      weldedPosArr.push(x, y, z)
    }
    weldedIdxArr.push(ni)
  }

  return {
    positions: new Float32Array(weldedPosArr),
    indices: new Uint32Array(weldedIdxArr),
  }
}

// ── Union-Find ──

/** Simple union-find for clustering cap triangles by shared edges. */
export class SimpleUnionFind {
  private parent: number[]
  private rank: number[]

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
    this.rank = new Array(n).fill(0)
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x])
    }
    return this.parent[x]
  }

  union(x: number, y: number): void {
    const px = this.find(x)
    const py = this.find(y)
    if (px === py) return
    if (this.rank[px] < this.rank[py]) {
      this.parent[px] = py
    } else if (this.rank[px] > this.rank[py]) {
      this.parent[py] = px
    } else {
      this.parent[py] = px
      this.rank[px]++
    }
  }
}

// ── Wedge (trapezoidal prism) creation ──

/**
 * Create a wedge (trapezoidal prism) Manifold from cutting-plane parameters.
 */
export function createWedge(
  Manifold: ManifoldCtor,
  Mesh: MeshCtor,
  planeCenter: Vec3,
  normal: Vec3,
  widthDir: Vec3,
  depth: number,
  width: number,
  angleDeg: number,
  extrudeLength: number,
): ManifoldInstance {
  const { positions, indices } = buildWedgeGeometry(
    planeCenter, normal, widthDir, depth, width, angleDeg, extrudeLength,
  )
  const mesh = new Mesh({
    numProp: 3,
    vertProperties: positions,
    triVerts: indices,
  })
  return Manifold.ofMesh(mesh)
}

// ── Cap component detection ──

/**
 * Detect connected components of cap faces on the cutting plane.
 *
 * Returns an array of components, each being a Set of vertex indices.
 */
export function detectCapComponents(
  upper: ManifoldInstance,
  normal: Vec3,
  originOffset: number,
): Set<number>[] {
  const mesh = upper.getMesh()
  const eps = 0.001
  const numProp = mesh.numProp || 3
  const vertCount = Math.floor(mesh.vertProperties.length / numProp)
  const triVerts = mesh.triVerts
  if (!triVerts || triVerts.length === 0) return []

  const capVertSet = new Set<number>()
  interface CapTri { v0: number; v1: number; v2: number }
  const capTris: CapTri[] = []
  const triCount = triVerts.length / 3
  for (let t = 0; t < triCount; t++) {
    const i0 = triVerts[t * 3]
    const i1 = triVerts[t * 3 + 1]
    const i2 = triVerts[t * 3 + 2]
    const d0 = Math.abs(
      mesh.vertProperties[i0 * numProp] * normal[0] +
      mesh.vertProperties[i0 * numProp + 1] * normal[1] +
      mesh.vertProperties[i0 * numProp + 2] * normal[2] - originOffset)
    const d1 = Math.abs(
      mesh.vertProperties[i1 * numProp] * normal[0] +
      mesh.vertProperties[i1 * numProp + 1] * normal[1] +
      mesh.vertProperties[i1 * numProp + 2] * normal[2] - originOffset)
    const d2 = Math.abs(
      mesh.vertProperties[i2 * numProp] * normal[0] +
      mesh.vertProperties[i2 * numProp + 1] * normal[1] +
      mesh.vertProperties[i2 * numProp + 2] * normal[2] - originOffset)
    if (d0 < eps && d1 < eps && d2 < eps) {
      capTris.push({ v0: i0, v1: i1, v2: i2 })
      capVertSet.add(i0); capVertSet.add(i1); capVertSet.add(i2)
    }
  }
  if (capTris.length === 0) return []

  const uf = new SimpleUnionFind(vertCount)
  for (const tri of capTris) {
    uf.union(tri.v0, tri.v1)
    uf.union(tri.v1, tri.v2)
    uf.union(tri.v0, tri.v2)
  }

  const compMap = new Map<number, Set<number>>()
  for (const vi of capVertSet) {
    const root = uf.find(vi)
    if (!compMap.has(root)) compMap.set(root, new Set<number>())
    compMap.get(root)!.add(vi)
  }

  return Array.from(compMap.values())
}

// ── Cross-section width computation ──

/**
 * Compute the actual extent of the model's cross-section at the cutting plane
 * along the width direction.
 */
export function computeCrossSectionWidth(
  upper: ManifoldInstance,
  normal: Vec3,
  originOffset: number,
  widthDir: Vec3,
  comp?: Set<number>,
): number {
  const mesh = upper.getMesh()
  const eps = 0.001
  let minProj = Infinity
  let maxProj = -Infinity
  let found = false

  const numProp = mesh.numProp || 3
  const vertCount = Math.floor(mesh.vertProperties.length / numProp)
  for (let i = 0; i < vertCount; i++) {
    if (comp && !comp.has(i)) continue

    const base = i * numProp
    const x = mesh.vertProperties[base]
    const y = mesh.vertProperties[base + 1]
    const z = mesh.vertProperties[base + 2]

    const dist = x * normal[0] + y * normal[1] + z * normal[2] - originOffset
    if (Math.abs(dist) < eps) {
      const proj = x * widthDir[0] + y * widthDir[1] + z * widthDir[2]
      if (proj < minProj) minProj = proj
      if (proj > maxProj) maxProj = proj
      found = true
    }
  }

  if (!found) return 0
  return maxProj - minProj
}

// ── Cross-section centroid computation ──

/**
 * Compute the centroid of vertices lying on the cutting plane.
 */
export function computeCrossSectionCentroid(
  upper: ManifoldInstance,
  normal: Vec3,
  originOffset: number,
  fallback: Vec3,
  comp?: Set<number>,
): Vec3 {
  const mesh = upper.getMesh()
  const eps = 0.001
  let cx = 0, cy = 0, cz = 0
  let count = 0

  const numProp = mesh.numProp || 3
  const vertCount = Math.floor(mesh.vertProperties.length / numProp)
  for (let i = 0; i < vertCount; i++) {
    if (comp && !comp.has(i)) continue

    const base = i * numProp
    const x = mesh.vertProperties[base]
    const y = mesh.vertProperties[base + 1]
    const z = mesh.vertProperties[base + 2]

    const dist = x * normal[0] + y * normal[1] + z * normal[2] - originOffset
    if (Math.abs(dist) < eps) {
      cx += x
      cy += y
      cz += z
      count++
    }
  }

  if (count === 0) return fallback
  return [cx / count, cy / count, cz / count]
}

// ── Dovetail boolean split ──

/**
 * Perform the dovetail split using boolean operations.
 */
export function dovetailBooleanSplit(
  Manifold: ManifoldCtor,
  Mesh: MeshCtor,
  original: ManifoldInstance,
  normal: Vec3,
  originOffset: number,
  planeCenter: Vec3,
  widthDirInput: Vec3,
  bboxWidthOnWidthDir: number,
  groove: {
    depth: number
    depthTolerance: number
    width: number
    widthTolerance: number
    flapsAngle: number
  },
  keepOriginal: boolean = false,
): [ManifoldInstance, ManifoldInstance,
  { positions: Float32Array; indices: Uint32Array } | null] {
  const widthDir = vec3Normalize(widthDirInput)

  // Step 1: Split by plane → upper + lower
  const [upper, lower] = original.splitByPlane(normal, originOffset)
  if (!keepOriginal) original.delete()

  // Step 2: Compute actual cross-section width at the cutting plane
  let crossSectionWidth = computeCrossSectionWidth(upper, normal, originOffset, widthDir)
  if (crossSectionWidth <= 0) {
    crossSectionWidth = bboxWidthOnWidthDir
  }
  const extrudeLength = crossSectionWidth + 0.2

  // Step 3: Create wedge W with generous overhang along widthDir
  const overhang = 20

  const wedgeW = createWedge(
    Manifold, Mesh,
    planeCenter, normal, widthDir,
    groove.depth, groove.width, groove.flapsAngle,
    extrudeLength + overhang,
  )

  // Trim the wedge to the model by intersecting with lower.
  let wedgeForUnion: ManifoldInstance
  let wedgeMeshData: { positions: Float32Array; indices: Uint32Array } | null
  let lowerForSubtract: ManifoldInstance

  if (!wedgeW.isEmpty() && !lower.isEmpty()) {
    const lowerMeshData = manifoldToMeshData(lower)

    const trimmedWedge = wedgeW.intersect(lower)
    wedgeW.delete()
    lower.delete()

    wedgeMeshData = trimmedWedge.isEmpty() ? null : manifoldToMeshData(trimmedWedge)
    wedgeForUnion = trimmedWedge

    lowerForSubtract = Manifold.ofMesh(new Mesh({
      numProp: 3,
      vertProperties: lowerMeshData.positions,
      triVerts: lowerMeshData.indices,
    }))
  } else {
    wedgeMeshData = null
    wedgeForUnion = wedgeW
    lowerForSubtract = lower
  }

  // Step 5: union(upper, wedgeForUnion) → upper'
  let upperResult: ManifoldInstance
  if (upper.isEmpty()) {
    upper.delete()
    upperResult = wedgeForUnion
  } else if (wedgeForUnion.isEmpty()) {
    wedgeForUnion.delete()
    upperResult = upper
  } else {
    upperResult = upper.add(wedgeForUnion)
    upper.delete()
    wedgeForUnion.delete()
  }

  // Step 6: Create tolerance wedge W_tol
  const wedgeTol = createWedge(
    Manifold, Mesh,
    planeCenter, normal, widthDir,
    groove.depth + groove.depthTolerance,
    groove.width + groove.widthTolerance,
    groove.flapsAngle,
    extrudeLength + overhang,
  )

  // Step 7: lower.subtract(wedgeTol) → lower'
  let lowerResult: ManifoldInstance
  if (lowerForSubtract.isEmpty()) {
    wedgeTol.delete()
    lowerResult = lowerForSubtract
  } else if (wedgeTol.isEmpty()) {
    wedgeTol.delete()
    lowerResult = lowerForSubtract
  } else {
    lowerResult = lowerForSubtract.subtract(wedgeTol)
    lowerForSubtract.delete()
    wedgeTol.delete()
  }

  return [upperResult, lowerResult, wedgeMeshData]
}

// ── Dowel (cylinder) creation ──

/**
 * Create a cylindrical Manifold for the dowel tenon.
 */
export function createDowel(
  Manifold: ManifoldCtor,
  Mesh: MeshCtor,
  centroid: Vec3,
  normal: Vec3,
  widthDir: Vec3,
  depthDir: Vec3,
  diameter: number,
  height: number,
  segments: number = 32,
): ManifoldInstance {
  const { positions, indices } = buildDowelGeometry(
    centroid, normal, widthDir, depthDir, diameter, height, segments,
  )
  const mesh = new Mesh({
    numProp: 3,
    vertProperties: positions,
    triVerts: indices,
  })
  return Manifold.ofMesh(mesh)
}

// ── Straight tenon (box) creation ──

/**
 * Create a box-shaped Manifold for the straight tenon.
 */
export function createStraightTenon(
  Manifold: ManifoldCtor,
  Mesh: MeshCtor,
  centroid: Vec3,
  normal: Vec3,
  widthDir: Vec3,
  depthDir: Vec3,
  sideLength: number,
  height: number,
): ManifoldInstance {
  const { positions, indices } = buildStraightTenonGeometry(
    centroid, normal, widthDir, depthDir, sideLength, height,
  )
  const mesh = new Mesh({
    numProp: 3,
    vertProperties: positions,
    triVerts: indices,
  })
  return Manifold.ofMesh(mesh)
}

// ── Dowel / Straight-tenon boolean split ──

/**
 * Perform the dowel (or straight-tenon) split using boolean operations.
 */
export function dowelOrTenonBooleanSplit(
  Manifold: ManifoldCtor,
  Mesh: MeshCtor,
  original: ManifoldInstance,
  normal: Vec3,
  originOffset: number,
  planeCenter: Vec3,
  widthDirInput: Vec3,
  shape: 'dowel' | 'tenon',
  params: {
    size: number
    sizeTolerance: number
    height: number
    heightTolerance: number
  },
  keepOriginal: boolean = false,
  selectedSections?: number[] | null,
): [ManifoldInstance, ManifoldInstance,
    { positions: Float32Array; indices: Uint32Array } | null] {
  const widthDir = vec3Normalize(widthDirInput)
  const depthDir = vec3Normalize(vec3Cross(normal, widthDir))

  // Step 1: Split by plane → upper + lower
  const [upper, lower] = original.splitByPlane(normal, originOffset)
  if (!keepOriginal) original.delete()

  // Step 2: Detect cap components (multi-section support)
  const components = detectCapComponents(upper, normal, originOffset)

  // Build the list of joinery placements: one per selected section
  interface JoineryPlacement { centroid: Vec3 }
  let placements: JoineryPlacement[]

  if (components.length <= 1 || !selectedSections || selectedSections.length === 0) {
    const centroid = computeCrossSectionCentroid(upper, normal, originOffset, planeCenter)
    placements = [{ centroid }]
  } else {
    const compInfo = components.map((comp, idx) => {
      const compWidth = computeCrossSectionWidth(upper, normal, originOffset, widthDir, comp)
      const compCentroid = computeCrossSectionCentroid(upper, normal, originOffset, planeCenter, comp)
      const compDepth = computeCrossSectionWidth(upper, normal, originOffset, depthDir, comp)
      const area = compWidth * compDepth
      return { idx, comp, area, centroid: compCentroid }
    })
    compInfo.sort((a, b) => b.area - a.area)

    placements = []
    for (const selId of selectedSections) {
      if (selId < compInfo.length) {
        placements.push({ centroid: compInfo[selId].centroid })
      }
    }
    if (placements.length === 0) {
      const centroid = computeCrossSectionCentroid(upper, normal, originOffset, planeCenter)
      placements = [{ centroid }]
    }
  }

  // Step 3: For each placement, create shape C (no tolerance) and union into upper
  let shapeMeshData: { positions: Float32Array; indices: Uint32Array } | null = null

  let upperResult = upper
  let upperOwned = true

  for (let pIdx = 0; pIdx < placements.length; pIdx++) {
    const { centroid } = placements[pIdx]
    let shapeC: ManifoldInstance
    if (shape === 'dowel') {
      shapeC = createDowel(Manifold, Mesh, centroid, normal, widthDir, depthDir,
        params.size, params.height, 32)
    } else {
      shapeC = createStraightTenon(Manifold, Mesh, centroid, normal, widthDir, depthDir,
        params.size, params.height)
    }

    if (pIdx === 0) {
      shapeMeshData = shapeC.isEmpty() ? null : manifoldToMeshData(shapeC)
    }

    if (upperResult.isEmpty()) {
      if (upperOwned) upperResult.delete()
      upperResult = shapeC
      upperOwned = true
    } else if (shapeC.isEmpty()) {
      shapeC.delete()
    } else {
      const newUpper = upperResult.add(shapeC)
      if (upperOwned) upperResult.delete()
      upperResult = newUpper
      shapeC.delete()
      upperOwned = true
    }
  }

  // Step 4: For each placement, create shape C_tol (with tolerance) and subtract from lower
  const tolSize = params.size + params.sizeTolerance
  const tolHeight = params.height + params.heightTolerance

  let lowerResult = lower
  let lowerOwned = true

  for (const { centroid } of placements) {
    let shapeCTol: ManifoldInstance
    if (shape === 'dowel') {
      shapeCTol = createDowel(Manifold, Mesh, centroid, normal, widthDir, depthDir,
        tolSize, tolHeight, 32)
    } else {
      shapeCTol = createStraightTenon(Manifold, Mesh, centroid, normal, widthDir, depthDir,
        tolSize, tolHeight)
    }

    if (lowerResult.isEmpty()) {
      shapeCTol.delete()
    } else if (shapeCTol.isEmpty()) {
      shapeCTol.delete()
    } else {
      const newLower = lowerResult.subtract(shapeCTol)
      if (lowerOwned) lowerResult.delete()
      lowerResult = newLower
      shapeCTol.delete()
      lowerOwned = true
    }
  }

  return [upperResult, lowerResult, shapeMeshData]
}
