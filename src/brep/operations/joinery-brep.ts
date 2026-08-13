/**
 * BREP 榫卯结构操作 — 用 OCCT 精确实体复刻 mesh 路径的榫卯布尔序列
 *
 * 设计文档：docs/plans/2026-08-11-split-joinery-brep-plan.md
 *
 * 与 mesh 路径（joinery-shapes.ts + csg-worker.ts）对照：
 * - mesh 路径：buildWedgeGeometry/buildDowelGeometry/buildStraightTenonGeometry → Manifold CSG
 * - BREP 路径：buildWedgeSolid/buildDowelSolid/buildTenonSolid → OCCT fuse/cut/common
 *
 * 坐标框架与 mesh 路径完全一致：
 * - normal: 切割平面法线（单位向量，指向上方）
 * - widthDir: 挤出方向（单位向量）
 * - depthDir = normalize(cross(normal, widthDir))
 * - planeCenter: 切割平面中心
 *
 * 所有函数都是纯函数，输入输出均为 OCCT ShapeHandle，调用方负责句柄生命周期。
 */

import * as THREE from 'three'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import type { Vec3 } from '../../mesh-ops/types'
import { getSolidBoundingBox } from '../brep-utils'
import { splitBrep, matrixToArray } from '../brep-ops'

// ─── 坐标框架 ───

/** 榫卯操作的坐标框架（与 joinery-shapes.ts 一致） */
export interface JoineryBasis {
  /** 切割平面法线（单位向量） */
  normal: Vec3
  /** 宽度/挤出方向（单位向量） */
  widthDir: Vec3
  /** 深度方向 = normalize(cross(normal, widthDir)) */
  depthDir: Vec3
  /** 切割平面中心 */
  planeCenter: Vec3
  /** 平面原点偏移 = dot(normal, planeCenter) */
  originOffset: number
}

// ─── Union-Find（与 csg-worker.ts SimpleUnionFind 一致） ───

class SimpleUnionFind {
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

// ─── 截面分析（从 mesh 三角化提取截面信息，与 csg-worker.ts 算法一致） ───

interface MeshData {
  positions: Float32Array
  indices: Uint32Array
}

/**
 * 检测切割平面上的帽面连通分量。
 *
 * 与 csg-worker.ts detectCapComponents 算法一致：
 * 1. 找到所有顶点在切割平面上的三角形
 * 2. 用 union-find 按共享顶点分组
 * 3. 返回每分量的顶点索引集合
 */
function detectCapComponentsFromMesh(
  mesh: MeshData,
  normal: Vec3,
  originOffset: number,
): Set<number>[] {
  const eps = 0.001
  const { positions, indices } = mesh
  const vertCount = positions.length / 3
  if (indices.length === 0) return []

  // 找到所有帽面三角形
  const capVertSet = new Set<number>()
  interface CapTri { v0: number; v1: number; v2: number }
  const capTris: CapTri[] = []
  const triCount = indices.length / 3
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3]
    const i1 = indices[t * 3 + 1]
    const i2 = indices[t * 3 + 2]
    const d0 = Math.abs(
      positions[i0 * 3] * normal[0] +
      positions[i0 * 3 + 1] * normal[1] +
      positions[i0 * 3 + 2] * normal[2] - originOffset,
    )
    const d1 = Math.abs(
      positions[i1 * 3] * normal[0] +
      positions[i1 * 3 + 1] * normal[1] +
      positions[i1 * 3 + 2] * normal[2] - originOffset,
    )
    const d2 = Math.abs(
      positions[i2 * 3] * normal[0] +
      positions[i2 * 3 + 1] * normal[1] +
      positions[i2 * 3 + 2] * normal[2] - originOffset,
    )
    if (d0 < eps && d1 < eps && d2 < eps) {
      capTris.push({ v0: i0, v1: i1, v2: i2 })
      capVertSet.add(i0); capVertSet.add(i1); capVertSet.add(i2)
    }
  }
  if (capTris.length === 0) return []

  // Union-find 按共享顶点分组
  const uf = new SimpleUnionFind(vertCount)
  for (const tri of capTris) {
    uf.union(tri.v0, tri.v1)
    uf.union(tri.v1, tri.v2)
    uf.union(tri.v0, tri.v2)
  }

  // 按根节点分组
  const compMap = new Map<number, Set<number>>()
  for (const vi of capVertSet) {
    const root = uf.find(vi)
    if (!compMap.has(root)) compMap.set(root, new Set<number>())
    compMap.get(root)!.add(vi)
  }

  return Array.from(compMap.values())
}

/**
 * 计算切割平面上截面顶点的质心。
 *
 * 与 csg-worker.ts computeCrossSectionCentroid 算法一致。
 */
function computeCrossSectionCentroidFromMesh(
  mesh: MeshData,
  normal: Vec3,
  originOffset: number,
  fallback: Vec3,
  comp?: Set<number>,
): Vec3 {
  const eps = 0.001
  const { positions } = mesh
  let cx = 0, cy = 0, cz = 0
  let count = 0

  const vertCount = positions.length / 3
  for (let i = 0; i < vertCount; i++) {
    if (comp && !comp.has(i)) continue

    const x = positions[i * 3]
    const y = positions[i * 3 + 1]
    const z = positions[i * 3 + 2]

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

/**
 * 计算切割平面上截面沿指定方向的宽度。
 *
 * 与 csg-worker.ts computeCrossSectionWidth 算法一致。
 */
function computeCrossSectionWidthFromMesh(
  mesh: MeshData,
  normal: Vec3,
  originOffset: number,
  widthDir: Vec3,
  comp?: Set<number>,
): number {
  const eps = 0.001
  const { positions } = mesh
  let minProj = Infinity
  let maxProj = -Infinity
  let found = false

  const vertCount = positions.length / 3
  for (let i = 0; i < vertCount; i++) {
    if (comp && !comp.has(i)) continue

    const x = positions[i * 3]
    const y = positions[i * 3 + 1]
    const z = positions[i * 3 + 2]

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

/** 将 OCCT solid 三角化为 MeshData（用于截面分析） */
function solidToMeshData(kernel: OcctKernel, solid: ShapeHandle): MeshData {
  const mesh = kernel.meshShape(solid, {
    linearDeflection: 0.1,
    angularDeflection: (2 * Math.PI) / 32,
  })
  return {
    positions: new Float32Array(mesh.positions),
    indices: new Uint32Array(mesh.indices),
  }
}

// ─── 基本体构造（BREP 等价物） ───

/**
 * 构造局部的变换矩阵：local X → widthDir, Y → depthDir, Z → normal，再平移到 origin。
 */
function makeBasisTransform(basis: JoineryBasis, origin: Vec3): THREE.Matrix4 {
  const basisMatrix = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...basis.widthDir),
    new THREE.Vector3(...basis.depthDir),
    new THREE.Vector3(...basis.normal),
  )
  const transMatrix = new THREE.Matrix4().makeTranslation(origin[0], origin[1], origin[2])
  return new THREE.Matrix4().multiplyMatrices(transMatrix, basisMatrix)
}

/**
 * 梯形棱柱（燕尾楔）— BREP 等价物。
 *
 * 复刻 joinery-shapes.ts buildWedgeGeometry 的 8 顶点拓扑：
 * - 梯形截面在 normal-depthDir 平面
 * - 底边（宽）在 planeCenter - normal*depth
 * - 顶边（窄）在 planeCenter
 * - 沿 widthDir 拉伸 extrudeLength，居中于 planeCenter
 *
 * 用 kernel.makeLineEdge + makeWire + makeFace + extrude 构造实体，
 * 然后用 transform 对齐到世界坐标系。
 */
export function buildWedgeSolid(
  kernel: OcctKernel,
  basis: JoineryBasis,
  depth: number,
  width: number,
  angleDeg: number,
  extrudeLength: number,
): ShapeHandle {
  const { planeCenter } = basis
  const angleRad = (angleDeg * Math.PI) / 180

  const halfWidth = width / 2
  const halfTopWidth = Math.max(0, halfWidth - depth / Math.tan(angleRad))
  const halfExtrude = extrudeLength / 2

  // 在局部坐标系中构造梯形面（YZ 平面，X = -halfExtrude）
  // 局部: X → widthDir, Y → depthDir, Z → normal
  const xLocal = -halfExtrude
  const v0 = { x: xLocal, y: -halfWidth, z: -depth }    // bottomLeft
  const v1 = { x: xLocal, y:  halfWidth, z: -depth }    // bottomRight
  const v2 = { x: xLocal, y:  halfTopWidth, z: 0 }      // topRight
  const v3 = { x: xLocal, y: -halfTopWidth, z: 0 }      // topLeft

  // 构建梯形 wire
  const edges: ShapeHandle[] = []
  edges.push(kernel.makeLineEdge(v0, v1))
  edges.push(kernel.makeLineEdge(v1, v2))
  edges.push(kernel.makeLineEdge(v2, v3))
  edges.push(kernel.makeLineEdge(v3, v0))

  const wire = kernel.makeWire(edges)
  const face = kernel.makeFace(wire)

  // 沿 X 轴（= widthDir）拉伸 extrudeLength
  const extruded = kernel.extrude(face, extrudeLength, 0, 0)

  // 释放中间句柄
  for (const e of edges) kernel.release(e)
  kernel.release(wire)
  kernel.release(face)

  // 变换到世界坐标系
  const fullMatrix = makeBasisTransform(basis, planeCenter)
  const result = kernel.transform(extruded, matrixToArray(fullMatrix))
  kernel.release(extruded)

  return result
}

/**
 * 圆柱（定位销）— BREP 等价物。
 *
 * 复刻 joinery-shapes.ts buildDowelGeometry：
 * - 圆截面在 widthDir-depthDir 平面，中心在 centroid
 * - 从切割平面向下延伸 height（沿 -normal）
 *
 * 用 kernel.makeCylinder + transform 对齐方向。
 */
export function buildDowelSolid(
  kernel: OcctKernel,
  centroid: Vec3,
  basis: JoineryBasis,
  diameter: number,
  height: number,
): ShapeHandle {
  const radius = diameter / 2
  const { normal } = basis

  // OCCT makeCylinder 创建 Z 轴方向圆柱（Z=0 → Z=height）
  // 需要旋转使 Z 轴对齐 -normal（圆柱向下延伸），且顶部在 centroid
  const cyl = kernel.makeCylinder(radius, height)

  // 旋转 Z → -normal
  const zAxis = new THREE.Vector3(0, 0, 1)
  const negNormal = new THREE.Vector3(-normal[0], -normal[1], -normal[2]).normalize()
  const quat = new THREE.Quaternion().setFromUnitVectors(zAxis, negNormal)
  const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(quat)

  // 平移到 centroid（旋转后 Z=0 对应 centroid，即切割平面上的顶面）
  const transMatrix = new THREE.Matrix4().makeTranslation(centroid[0], centroid[1], centroid[2])
  const fullMatrix = new THREE.Matrix4().multiplyMatrices(transMatrix, rotMatrix)

  const result = kernel.transform(cyl, matrixToArray(fullMatrix))
  kernel.release(cyl)

  return result
}

/**
 * 长方体（直榫）— BREP 等价物。
 *
 * 复刻 joinery-shapes.ts buildStraightTenonGeometry：
 * - 方截面在 widthDir-depthDir 平面，中心在 centroid
 * - 从切割平面向下延伸 height（沿 -normal）
 *
 * 用 kernel.makeBoxFromCorners + transform 对齐方向。
 */
export function buildTenonSolid(
  kernel: OcctKernel,
  centroid: Vec3,
  basis: JoineryBasis,
  sideLength: number,
  height: number,
): ShapeHandle {
  const half = sideLength / 2

  // 在局部坐标系中创建盒子：X ∈ [-half, half], Y ∈ [-half, half], Z ∈ [-height, 0]
  // 局部: X → widthDir, Y → depthDir, Z → normal
  const localBox = kernel.makeBoxFromCorners(
    { x: -half, y: -half, z: -height },
    { x: half, y: half, z: 0 },
  )

  // 变换到世界坐标系
  const fullMatrix = makeBasisTransform(basis, centroid)
  const result = kernel.transform(localBox, matrixToArray(fullMatrix))
  kernel.release(localBox)

  return result
}

// ─── 截面质心 / 多截面检测 ───

/** 截面分量信息 */
export interface CrossSectionComponent {
  /** 分量质心 */
  centroid: Vec3
  /** 分量面积（近似，用于排序） */
  area: number
}

/**
 * 检测上部实体在切割平面上的截面连通分量。
 *
 * BREP 等价物：将 upper solid 三角化后，用与 mesh 路径 detectCapComponents
 * 完全相同的算法（找帽面三角形 → union-find）检测连通分量。
 *
 * 与 csg-worker.ts detectCapComponents + computeCrossSectionCentroid 一致。
 */
export function detectCrossSectionComponents(
  kernel: OcctKernel,
  upper: ShapeHandle,
  basis: JoineryBasis,
): CrossSectionComponent[] {
  const { normal, originOffset, widthDir, depthDir, planeCenter } = basis
  const mesh = solidToMeshData(kernel, upper)
  const components = detectCapComponentsFromMesh(mesh, normal, originOffset)

  if (components.length === 0) {
    // 无帽面 → 返回单个全局质心（planeCenter）作为回退
    return [{ centroid: planeCenter, area: 0 }]
  }

  return components.map(comp => {
    const centroid = computeCrossSectionCentroidFromMesh(mesh, normal, originOffset, planeCenter, comp)
    const compWidth = computeCrossSectionWidthFromMesh(mesh, normal, originOffset, widthDir, comp)
    const compDepth = computeCrossSectionWidthFromMesh(mesh, normal, originOffset, depthDir, comp)
    return { centroid, area: compWidth * compDepth }
  })
}

// ─── 布尔序列（1:1 复刻 csg-worker.ts） ───

/** dovetail 布尔分割的结果 */
export interface DovetailSplitBrepResult {
  /** 上部 + 楔（法线正方向半部分加燕尾榫） */
  front: ShapeHandle
  /** 下部 - 凹腔（法线负方向半部分减燕尾槽） */
  back: ShapeHandle
}

/** dowel/tenon 布尔分割的结果 */
export interface DowelOrTenonSplitBrepResult {
  /** 上部 + 销/榫（法线正方向半部分加圆柱/方柱） */
  front: ShapeHandle
  /** 下部 - 孔（法线负方向半部分减圆柱/方柱） */
  back: ShapeHandle
}

/** groove 参数 */
export interface GrooveParams {
  depth: number
  depthTolerance: number
  width: number
  widthTolerance: number
  flapsAngle: number
}

/**
 * Dovetail（燕尾）布尔分割 — BREP 等价物。
 *
 * 1:1 复刻 csg-worker.ts dovetailBooleanSplit：
 * 1. splitBrep → upper + lower
 * 2. 计算 crossSectionWidth（bbox 投影近似）
 * 3. buildWedgeSolid（overhang=20）→ common(wedge, lower) 裁剪贴合
 * 4. fuse(upper, wedgeTrimmed) → upper'
 * 5. buildWedgeSolid（公差）→ cut(lower, wedgeTol) → lower'
 */
export function dovetailBooleanSplitBrep(
  kernel: OcctKernel,
  original: ShapeHandle,
  basis: JoineryBasis,
  groove: GrooveParams,
): DovetailSplitBrepResult {
  const { normal, widthDir, planeCenter, originOffset } = basis

  // Step 1: 平面分割 → upper + lower
  const splitResult = splitBrep(kernel, original, { normal, originOffset, planeCenter })
  let upper = splitResult.front
  let lower = splitResult.back

  // Step 2: 计算截面宽度（bbox 投影近似，后续 common 会裁回真实边界）
  const upperBbox = getSolidBoundingBox(kernel, upper)
  const upperSize: Vec3 = [
    upperBbox.max[0] - upperBbox.min[0],
    upperBbox.max[1] - upperBbox.min[1],
    upperBbox.max[2] - upperBbox.min[2],
  ]
  let crossSectionWidth =
    Math.abs(upperSize[0] * widthDir[0]) +
    Math.abs(upperSize[1] * widthDir[1]) +
    Math.abs(upperSize[2] * widthDir[2])
  if (crossSectionWidth <= 0) crossSectionWidth = 10 // 安全回退
  const extrudeLength = crossSectionWidth + 0.2
  const overhang = 20

  // Step 3: 构造楔（带 overhang）
  const wedgeW = buildWedgeSolid(kernel, basis, groove.depth, groove.width, groove.flapsAngle, extrudeLength + overhang)

  // Step 4: common(wedge, lower) → 裁剪楔贴合模型边界
  const wedgeTrimmed = kernel.common(wedgeW, lower)
  kernel.release(wedgeW)

  // Step 5: fuse(upper, wedgeTrimmed) → upper'
  const newUpper = kernel.fuse(upper, wedgeTrimmed)
  kernel.release(upper)
  kernel.release(wedgeTrimmed)
  upper = newUpper

  // Step 6: 构造公差楔
  const wedgeTol = buildWedgeSolid(
    kernel, basis,
    groove.depth + groove.depthTolerance,
    groove.width + groove.widthTolerance,
    groove.flapsAngle,
    extrudeLength + overhang,
  )

  // Step 7: cut(lower, wedgeTol) → lower'
  const newLower = kernel.cut(lower, wedgeTol)
  kernel.release(lower)
  kernel.release(wedgeTol)
  lower = newLower

  return { front: upper, back: lower }
}

/** dowel/tenon 参数 */
export interface DowelOrTenonParams {
  /** 直径（dowel）或边长（tenon） */
  size: number
  /** 尺寸公差 */
  sizeTolerance: number
  /** 高度 */
  height: number
  /** 高度公差 */
  heightTolerance: number
}

/**
 * Dowel（定位销）/ Tenon（直榫）布尔分割 — BREP 等价物。
 *
 * 1:1 复刻 csg-worker.ts dowelOrTenonBooleanSplit：
 * 1. splitBrep → upper + lower
 * 2. detectCrossSectionComponents → 截面质心列表
 * 3. 对每个质心：buildShapeSolid → fuse(upper, shape) → upper'
 * 4. 对每个质心：buildShapeSolid（公差）→ cut(lower, shapeTol) → lower'
 */
export function dowelOrTenonBooleanSplitBrep(
  kernel: OcctKernel,
  original: ShapeHandle,
  basis: JoineryBasis,
  shape: 'dowel' | 'tenon',
  params: DowelOrTenonParams,
  selectedSections?: number[] | null,
): DowelOrTenonSplitBrepResult {
  const { normal, planeCenter, originOffset } = basis

  // Step 1: 平面分割 → upper + lower
  const splitResult = splitBrep(kernel, original, { normal, originOffset, planeCenter })
  let upper = splitResult.front
  let lower = splitResult.back

  // Step 2: 检测截面分量
  const components = detectCrossSectionComponents(kernel, upper, basis)

  // 构建放置位置列表
  interface Placement { centroid: Vec3 }
  let placements: Placement[]

  if (components.length <= 1 || !selectedSections || selectedSections.length === 0) {
    // 单截面或无选择 → 全局质心（向后兼容）
    const mesh = solidToMeshData(kernel, upper)
    const centroid = computeCrossSectionCentroidFromMesh(mesh, normal, originOffset, planeCenter)
    placements = [{ centroid }]
  } else {
    // 多截面：按面积降序排，取选择的分量
    const sorted = [...components].sort((a, b) => b.area - a.area)
    placements = []
    for (const selId of selectedSections) {
      if (selId < sorted.length) {
        placements.push({ centroid: sorted[selId].centroid })
      }
    }
    if (placements.length === 0) {
      const mesh = solidToMeshData(kernel, upper)
      const centroid = computeCrossSectionCentroidFromMesh(mesh, normal, originOffset, planeCenter)
      placements = [{ centroid }]
    }
  }

  // Step 3: 对每个质心构造基本体并 fuse 到 upper
  for (const { centroid } of placements) {
    let shapeC: ShapeHandle
    if (shape === 'dowel') {
      shapeC = buildDowelSolid(kernel, centroid, basis, params.size, params.height)
    } else {
      shapeC = buildTenonSolid(kernel, centroid, basis, params.size, params.height)
    }

    const newUpper = kernel.fuse(upper, shapeC)
    kernel.release(upper)
    kernel.release(shapeC)
    upper = newUpper
  }

  // Step 4: 对每个质心构造公差体并 cut 从 lower
  const tolSize = params.size + params.sizeTolerance
  const tolHeight = params.height + params.heightTolerance

  for (const { centroid } of placements) {
    let shapeCTol: ShapeHandle
    if (shape === 'dowel') {
      shapeCTol = buildDowelSolid(kernel, centroid, basis, tolSize, tolHeight)
    } else {
      shapeCTol = buildTenonSolid(kernel, centroid, basis, tolSize, tolHeight)
    }

    const newLower = kernel.cut(lower, shapeCTol)
    kernel.release(lower)
    kernel.release(shapeCTol)
    lower = newLower
  }

  return { front: upper, back: lower }
}
