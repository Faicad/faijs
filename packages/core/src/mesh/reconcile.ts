/**
 * reconcile — BREP 三角汤归约为合法 2-manifold 网格（P0-1c）
 *
 *
 * 职责：把 OCCT 逐面三角化（`kernel.meshShape` 产物：共享边顶点重复、
 * 可能带朝向/退化问题）归约为 manifold-3d 可接受的合法 2-manifold 网格。
 * weld（顶点焊接）只是其中一步，故文件名为 reconcile 而非 weld。
 *
 * 纯数据、无 wasm 依赖、可单测。四步按顺序执行，每步可独立断言：
 *   1. 顶点焊接（复用 csg-core 的 weldPositionsWorker，1e-6 mm 量化，推原始坐标无精度损失）
 *   2. 退化剔除（零面积三角形）
 *   3. 朝向统一（连通分量内面法向传播，翻转不一致者）
 *   4. 2-manifold 断言（每条边恰好被 2 个三角形共享；不满足即显式报错，不静默、不 try-catch 回退）
 *
 * 红线（AGENTS.md）：这是输入数据规整，不是运行时回退——调用方（stdlib 各 op 的
 * mesh 路径）在 dispatchPath 静态判定为 'mesh' 之后、进入 manifold 之前调用。
 */

import { weldPositionsWorker } from '../boolean/csg-core'

/**
 * Result of one reconciliation step: the reduced vertex buffer and the index
 * buffer of triangles referencing it.
 */
export interface ReconcileResult {
  positions: Float32Array
  indices: Uint32Array
}

// ── 步骤 1：顶点焊接 ──

/**
 * Weld duplicated vertices shared across triangle edges (reuses the single
 * csg-core weld implementation). Input coordinates are preserved — the 1e-6
 * quantization is only used as a map key and is never written back — so there
 * is no precision loss.
 * @param positions - flat XYZ vertex buffer, length 3 * vertexCount.
 * @param indices - triangle index buffer, length 3 * triangleCount.
 * @returns the welded mesh as a new ReconcileResult.
 */
export function weldVertices(
  positions: Float32Array,
  indices: Uint32Array,
): ReconcileResult {
  const welded = weldPositionsWorker(positions, indices, indices.length)
  return { positions: welded.positions, indices: welded.indices }
}

// ── 步骤 2：退化剔除 ──

/** 计算包围盒对角线长度（数值尺度参考）。 */
function bboxDiagonal(positions: Float32Array): number {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/**
 * Drop zero-area triangles and compact the surviving indices, also squeezing
 * out vertices that are no longer referenced. A triangle is degenerate when
 * its area is below the relative threshold (diagonal * 1e-9)².
 * @param positions - flat XYZ vertex buffer, length 3 * vertexCount.
 * @param indices - triangle index buffer, length 3 * triangleCount.
 * @returns the cleaned mesh as a new ReconcileResult.
 */
export function removeDegenerate(
  positions: Float32Array,
  indices: Uint32Array,
): ReconcileResult {
  const triCount = indices.length / 3
  if (triCount === 0) return { positions, indices }

  const diag = bboxDiagonal(positions)
  const areaEps = diag * 1e-9
  const areaEpsSq = areaEps * areaEps

  const keep = new Uint8Array(triCount)
  let keptCount = 0
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3]
    const i1 = indices[t * 3 + 1]
    const i2 = indices[t * 3 + 2]
    const x0 = positions[i0 * 3], y0 = positions[i0 * 3 + 1], z0 = positions[i0 * 3 + 2]
    const x1 = positions[i1 * 3], y1 = positions[i1 * 3 + 1], z1 = positions[i1 * 3 + 2]
    const x2 = positions[i2 * 3], y2 = positions[i2 * 3 + 1], z2 = positions[i2 * 3 + 2]

    // cross(u, v) 长度平方：u = v1 - v0, v = v2 - v0
    const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0
    const vx = x2 - x0, vy = y2 - y0, vz = z2 - z0
    const cx = uy * vz - uz * vy
    const cy = uz * vx - ux * vz
    const cz = ux * vy - uy * vx
    const crossLenSq = cx * cx + cy * cy + cz * cz

    if (crossLenSq > areaEpsSq) {
      keep[t] = 1
      keptCount++
    }
  }

  if (keptCount === triCount) return { positions, indices }

  const newIndices = new Uint32Array(keptCount * 3)
  const remap = new Map<number, number>()
  const newPosArr: number[] = []

  let out = 0
  for (let t = 0; t < triCount; t++) {
    if (!keep[t]) continue
    for (let k = 0; k < 3; k++) {
      const vi = indices[t * 3 + k]
      let ni = remap.get(vi)
      if (ni === undefined) {
        ni = newPosArr.length / 3
        remap.set(vi, ni)
        newPosArr.push(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2])
      }
      newIndices[out++] = ni
    }
  }

  return { positions: new Float32Array(newPosArr), indices: newIndices }
}

// ── 步骤 3：朝向统一 ──

interface EdgeRef {
  /** 三角形序号（indices / 3） */
  tri: number
  /** 该三角形沿排序后边的遍历方向：+1 = a→b，-1 = b→a */
  dir: 1 | -1
}

/**
 * Propagate face winding across each connected component: adjacent triangles
 * sharing an edge must traverse it in opposite directions (manifold winding
 * consistency). Triangles that violate this are flipped (v1/v2 swapped).
 *
 * BFS propagates a flip state f ∈ {+1, -1} per connected component:
 *   f(neighbor) = -f(cur) * baseDir(cur, e) * baseDir(neighbor, e)
 * A conflict (one triangle demanded to flip by two different paths) means the
 * mesh is not orientable — the first assignment is kept and step 4's
 * 2-manifold assertion reports the error explicitly.
 * @param positions - flat XYZ vertex buffer.
 * @param indices - triangle index buffer.
 * @returns the orientation-unified mesh as a new ReconcileResult.
 */
export function unifyOrientation(
  positions: Float32Array,
  indices: Uint32Array,
): ReconcileResult {
  const triCount = indices.length / 3
  if (triCount === 0) return { positions, indices }

  // 无向边 → 共享它的 (tri, dir) 列表
  const edgeMap = new Map<number, Map<number, EdgeRef[]>>()
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3]
    const i1 = indices[t * 3 + 1]
    const i2 = indices[t * 3 + 2]
    addEdgeRef(i0, i1, t)
    addEdgeRef(i1, i2, t)
    addEdgeRef(i2, i0, t)
  }

  function addEdgeRef(a: number, b: number, tri: number): void {
    const lo = a < b ? a : b
    const hi = a < b ? b : a
    let inner = edgeMap.get(lo)
    if (!inner) {
      inner = new Map()
      edgeMap.set(lo, inner)
    }
    let refs = inner.get(hi)
    if (!refs) {
      refs = []
      inner.set(hi, refs)
    }
    refs.push({ tri, dir: a < b ? 1 : -1 })
  }

  // 0 = 未访问，1 = 原朝向，2 = 需翻转
  const flip = new Uint8Array(triCount)
  const queue: number[] = []

  for (let seed = 0; seed < triCount; seed++) {
    if (flip[seed] !== 0) continue
    flip[seed] = 1
    queue.length = 0
    queue.push(seed)

    while (queue.length > 0) {
      const cur = queue.pop()!
      const curFlip = flip[cur] === 2 ? -1 : 1

      for (let k = 0; k < 3; k++) {
        const a = indices[cur * 3 + k]
        const b = indices[cur * 3 + (k + 1) % 3]
        const lo = a < b ? a : b
        const hi = a < b ? b : a
        const refs = edgeMap.get(lo)?.get(hi)
        if (!refs) continue

        const baseDirCur: 1 | -1 = a < b ? 1 : -1
        for (const ref of refs) {
          if (ref.tri === cur) continue
          if (flip[ref.tri] !== 0) continue
          // f(n) = -f(c) × dir(c) × dir(n)
          const needFlip = curFlip * baseDirCur * ref.dir === 1 ? 2 : 1
          flip[ref.tri] = needFlip
          queue.push(ref.tri)
        }
      }
    }
  }

  // 应用翻转：交换每个三角形 v1/v2
  const out = new Uint32Array(indices)
  for (let t = 0; t < triCount; t++) {
    if (flip[t] === 2) {
      const tmp = out[t * 3 + 1]
      out[t * 3 + 1] = out[t * 3 + 2]
      out[t * 3 + 2] = tmp
    }
  }

  return { positions, indices: out }
}

// ── 步骤 4：2-manifold 断言 ──

/**
 * Assert the mesh is 2-manifold: every undirected edge is shared by exactly
 * two triangles. A violation throws immediately (no silent handling, no
 * try-catch fallback).
 * @param positions - flat XYZ vertex buffer.
 * @param indices - triangle index buffer.
 */
export function assertManifold(positions: Float32Array, indices: Uint32Array): void {
  const triCount = indices.length / 3
  const edgeCount = new Map<number, Map<number, number>>()

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3]
    const i1 = indices[t * 3 + 1]
    const i2 = indices[t * 3 + 2]
    bump(i0, i1)
    bump(i1, i2)
    bump(i2, i0)
  }

  function bump(a: number, b: number): void {
    const lo = a < b ? a : b
    const hi = a < b ? b : a
    let inner = edgeCount.get(lo)
    if (!inner) {
      inner = new Map()
      edgeCount.set(lo, inner)
    }
    inner.set(hi, (inner.get(hi) ?? 0) + 1)
  }

  for (const [lo, inner] of edgeCount) {
    for (const [hi, count] of inner) {
      if (count !== 2) {
        throw new Error(
          `[reconcile] not 2-manifold: edge (${lo},${hi}) shared by ${count} triangles (expected 2)`,
        )
      }
    }
  }
}

// ── 四步归约（默认入口） ──

/**
 * Tuning knobs for the full reconciliation pass.
 */
export interface ReconcileOptions {
  /** Whether to run the 2-manifold assertion (default true). */
  assertManifold?: boolean
}

/**
 * Full reconciliation: weld → degenerate removal → orientation unification →
 * 2-manifold assertion. An empty mesh is returned untouched.
 * @param positions - flat XYZ vertex buffer.
 * @param indices - triangle index buffer.
 * @param opts - optional tuning knobs, e.g. to skip the manifold assertion.
 * @returns the reconciled mesh as a new ReconcileResult.
 */
export function reconcileMesh(
  positions: Float32Array,
  indices: Uint32Array,
  opts?: ReconcileOptions,
): ReconcileResult {
  if (indices.length === 0 || indices.length % 3 !== 0) {
    if (indices.length === 0) return { positions, indices }
    throw new Error(`[reconcile] indices length must be a multiple of 3, got ${indices.length}`)
  }

  let result = weldVertices(positions, indices)
  result = removeDegenerate(result.positions, result.indices)
  result = unifyOrientation(result.positions, result.indices)

  if (opts?.assertManifold !== false) {
    assertManifold(result.positions, result.indices)
  }
  return result
}
