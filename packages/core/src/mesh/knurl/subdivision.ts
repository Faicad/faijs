/**
 * subdivision.ts — 自适应边细分，从 stlTexturizer/js/subdivision.js 移植为 TS。
 *
 * 细分直到每条边 ≤ maxEdgeLength。
 *
 * 关键特性：
 *   - toIndexed (export path): 锐边分裂 — 同位置但法线夹角 > 30° 的顶点分开存储
 *   - 确保水密性
 *
 * 管线：
 *   toIndexed(geometry) → 索引化 + 顶点去重 + 锐边分裂
 *   循环细分：标记长边 → 按标记数量分裂三角形
 *   toNonIndexed(verts, indices) → 输出 non-indexed BufferGeometry
 *
 * Bug 修复记录 (2026-07-22):
 *   问题： 检测到 knurl 后的 mesh 出现 NaN 值和错误 bounds
 *         (bounds 从 [-0.5, 0.5] 变成 [-17, 17]，且 hasNaN: true)
 *
 *   根因分析：
 *     1. box_boss.3mf 是 indexed geometry (530 vertices, 1548 indices)
 *     2. toIndexed() 函数假设输入是 non-indexed (flat triangles)
 *     3. 当传入 indexed geometry 时，toIndexed() 错误处理顶点数据：
 *        - n = posAttr.count = 530 (顶点数)
 *        - 但代码按 triangle count = n/3 = 176 处理
 *        - 导致顶点索引越界，读取错误位置的数据
 *     4. 细分后顶点位置完全错误，进而导致 displacement 计算产生 NaN
 *
 *   修复方案：
 *     在 subdivide() 入口添加 indexed → non-indexed 转换：
 *       if (geometry.index) { workingGeo = geometry.toNonIndexed() }
 *
 *   验证：
 *     - E2E 测试通过：hasNaN: false, bounds 正确
 *     - 原始 bounds [0,0,0]~[150,120,90] → knurl 后 [-0.5,-0.5,0]~[150.5,120.5,90.5]
 */

import * as THREE from 'three'
import { QuantizedPointMap } from './meshIndex'

// 10μm 顶点去重网格
const QUANTISE = 1e5
// 安全上限
const SAFETY_CAP =
  typeof navigator !== 'undefined' &&
  (navigator as Navigator & { deviceMemory?: number }).deviceMemory !== undefined &&
  (navigator as Navigator & { deviceMemory?: number }).deviceMemory! >= 8
    ? 32_000_000
    : 16_000_000

// 锐边角度阈值（度）— 法线夹角超过此值的顶点在索引化时分裂
const SHARP_ANGLE_DEG = 30
const SHARP_COS = Math.cos(SHARP_ANGLE_DEG * Math.PI / 180)

// ── 可增长类型化顶点存储 ──

interface VertStore {
  cap: number
  count: number
  pos: Float64Array
  nrm: Float64Array
  wgt: Float64Array | null
  canon: Int32Array | null // 规范位置 ID（准确模式）
  grow(): void
}

function makeVertStore(initialCap: number, hasWeights: boolean, hasCanon: boolean): VertStore {
  return {
    cap: initialCap,
    count: 0,
    pos: new Float64Array(initialCap * 3),
    nrm: new Float64Array(initialCap * 3),
    wgt: hasWeights ? new Float64Array(initialCap) : null,
    canon: hasCanon ? new Int32Array(initialCap) : null,
    grow() {
      this.cap *= 2
      const np = new Float64Array(this.cap * 3)
      np.set(this.pos)
      this.pos = np
      const nn = new Float64Array(this.cap * 3)
      nn.set(this.nrm)
      this.nrm = nn
      if (this.wgt) {
        const nw = new Float64Array(this.cap)
        nw.set(this.wgt)
        this.wgt = nw
      }
      if (this.canon) {
        const nc = new Int32Array(this.cap)
        nc.set(this.canon)
        this.canon = nc
      }
    },
  }
}

// ── 公共入口 ──

/**
 * Adaptively subdivide a geometry until every edge is ≤ maxEdgeLength.
 * Indexed inputs are expanded to non-indexed form first; sharp edges are
 * split at vertices whose face-normal angle exceeds the threshold so each
 * surface keeps its own normal direction and the result stays watertight.
 * Faces marked by `faceWeights` are excluded from refinement.
 *
 * @param geometry - the source geometry (position attribute; may be indexed).
 * @param maxEdgeLength - maximum allowed edge length in millimeters.
 * @param onProgress - optional callback receiving progress, triangle count, and longest edge.
 * @param faceWeights - optional per-face exclusion weights (non-indexed triangle soup layout).
 * @returns the subdivided non-indexed geometry and whether the safety cap was reached.
 */
export async function subdivide(
  geometry: THREE.BufferGeometry,
  maxEdgeLength: number,
  onProgress?: (p: number, triCount: number, longestEdge: number) => void,
  faceWeights: Float32Array | null = null,
): Promise<{
  geometry: THREE.BufferGeometry
  safetyCapHit: boolean
}> {
  // 确保 geometry 是 non-indexed（toIndexed 假设输入是 flat 的）
  let workingGeo = geometry
  if (geometry.index) {
    workingGeo = geometry.toNonIndexed()
  }

  // 在 toIndexed 之前推导每面排除标记
  let initialFaceExcluded: Uint8Array | null = null
  if (faceWeights) {
    const triCount = faceWeights.length / 3
    initialFaceExcluded = new Uint8Array(triCount)
    for (let i = 0; i < triCount; i++) {
      if (faceWeights[i * 3] > 0.99) initialFaceExcluded[i] = 1
    }
  }

  // 使用准确模式（带锐边分裂的 toIndexed）
  const { verts, indices, posCanonMap } = toIndexed(workingGeo, faceWeights)

  const maxIterations = 12
  let currentIndices = indices
  let currentFaceExcluded = initialFaceExcluded
  let safetyCapHit = false

  for (let iter = 0; iter < maxIterations; iter++) {
    const triCount = currentIndices.length / 3
    if (triCount >= SAFETY_CAP) {
      safetyCapHit = true
      break
    }

    const { newIndices, newFaceExcluded, changed, capped } = subdividePass(
      verts,
      currentIndices,
      maxEdgeLength,
      SAFETY_CAP,
      currentFaceExcluded,
      posCanonMap,
    )
    currentIndices = newIndices
    if (newFaceExcluded) currentFaceExcluded = newFaceExcluded

    if (capped || newIndices.length / 3 >= SAFETY_CAP) safetyCapHit = true

    const positions = verts.pos
    let maxEdgeLenSq = 0
    for (let t = 0; t < currentIndices.length; t += 3) {
      const a = currentIndices[t],
        b = currentIndices[t + 1],
        c = currentIndices[t + 2]
      const ab = edgeLenSq(positions, a, b)
      const bc = edgeLenSq(positions, b, c)
      const ca = edgeLenSq(positions, c, a)
      if (ab > maxEdgeLenSq) maxEdgeLenSq = ab
      if (bc > maxEdgeLenSq) maxEdgeLenSq = bc
      if (ca > maxEdgeLenSq) maxEdgeLenSq = ca
    }
    const longestEdge = Math.sqrt(maxEdgeLenSq)

    const newTriCount = newIndices.length / 3
    if (onProgress) onProgress(Math.min(0.95, (iter + 1) / maxIterations), newTriCount, longestEdge)
    await new Promise((r) => setTimeout(r, 0))
    if (!changed || safetyCapHit) break
  }

  return {
    geometry: toNonIndexed(verts, currentIndices, currentFaceExcluded),
    safetyCapHit,
  }
}

// ── 一次细分 pass ──

function subdividePass(
  verts: VertStore,
  indices: Uint32Array,
  maxEdgeLength: number,
  safetyCap: number,
  faceExcluded: Uint8Array | null = null,
  posCanonMap: QuantizedPointMap | null = null,
): {
  newIndices: Uint32Array
  newFaceExcluded: Uint8Array | null
  changed: boolean
  capped?: boolean
} {
  const maxSq = maxEdgeLength * maxEdgeLength
  const midCache = new QuantizedPointMap(1, 1 << 16)
  const positions = verts.pos
  const canonIdx = verts.canon

  const splitEdges = new QuantizedPointMap(1, 1 << 16)
  const markEdge = (a: number, b: number) => {
    const u = canonIdx ? canonIdx[a] : a,
      v = canonIdx ? canonIdx[b] : b
    if (u < v) splitEdges.getOrSet(u, v, 0, 1)
    else splitEdges.getOrSet(v, u, 0, 1)
  }
  const isMarked = (a: number, b: number) => {
    const u = canonIdx ? canonIdx[a] : a,
      v = canonIdx ? canonIdx[b] : b
    return (u < v ? splitEdges.get(u, v, 0) : splitEdges.get(v, u, 0)) !== -1
  }

  // Step 1: 标记需要分裂的边
  for (let t = 0; t < indices.length; t += 3) {
    if (faceExcluded && faceExcluded[t / 3]) continue
    const a = indices[t],
      b = indices[t + 1],
      c = indices[t + 2]
    if (edgeLenSq(positions, a, b) > maxSq) markEdge(a, b)
    if (edgeLenSq(positions, b, c) > maxSq) markEdge(b, c)
    if (edgeLenSq(positions, c, a) > maxSq) markEdge(c, a)
  }

  if (splitEdges.size === 0)
    return { newIndices: indices, newFaceExcluded: faceExcluded, changed: false }

  // Step 1.5: 预测分裂后三角形数量
  let predictedTris = 0
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t],
      b = indices[t + 1],
      c = indices[t + 2]
    const sAB = isMarked(a, b)
    const sBC = isMarked(b, c)
    const sCA = isMarked(c, a)
    const n = (sAB ? 1 : 0) + (sBC ? 1 : 0) + (sCA ? 1 : 0)
    predictedTris += n === 0 ? 1 : n + 1
  }
  if (predictedTris > safetyCap) {
    return { newIndices: indices, newFaceExcluded: faceExcluded, changed: false, capped: true }
  }

  // Step 2: 重建索引列表
  const nextIndices = new Uint32Array(predictedTris * 3)
  const nextFaceExcluded = faceExcluded ? new Uint8Array(predictedTris) : null
  let wi = 0
  let fi = 0

  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t],
      b = indices[t + 1],
      c = indices[t + 2]
    const fIdx = t / 3
    const excl = faceExcluded ? faceExcluded[fIdx] : 0
    const sAB = isMarked(a, b)
    const sBC = isMarked(b, c)
    const sCA = isMarked(c, a)
    const n = (sAB ? 1 : 0) + (sBC ? 1 : 0) + (sCA ? 1 : 0)

    if (n === 0) {
      nextIndices[wi++] = a
      nextIndices[wi++] = b
      nextIndices[wi++] = c
      if (nextFaceExcluded) nextFaceExcluded[fi] = excl
      fi++
    } else if (n === 3) {
      const mAB = getMidpoint(verts, midCache, a, b, posCanonMap)
      const mBC = getMidpoint(verts, midCache, b, c, posCanonMap)
      const mCA = getMidpoint(verts, midCache, c, a, posCanonMap)
      nextIndices[wi++] = a
      nextIndices[wi++] = mAB
      nextIndices[wi++] = mCA
      nextIndices[wi++] = mAB
      nextIndices[wi++] = b
      nextIndices[wi++] = mBC
      nextIndices[wi++] = mCA
      nextIndices[wi++] = mBC
      nextIndices[wi++] = c
      nextIndices[wi++] = mAB
      nextIndices[wi++] = mBC
      nextIndices[wi++] = mCA
      for (let k = 0; k < 4; k++) {
        if (nextFaceExcluded) nextFaceExcluded[fi] = excl
        fi++
      }
    } else if (n === 1) {
      if (sAB) {
        const m = getMidpoint(verts, midCache, a, b, posCanonMap)
        nextIndices[wi++] = a
        nextIndices[wi++] = m
        nextIndices[wi++] = c
        nextIndices[wi++] = m
        nextIndices[wi++] = b
        nextIndices[wi++] = c
      } else if (sBC) {
        const m = getMidpoint(verts, midCache, b, c, posCanonMap)
        nextIndices[wi++] = a
        nextIndices[wi++] = b
        nextIndices[wi++] = m
        nextIndices[wi++] = a
        nextIndices[wi++] = m
        nextIndices[wi++] = c
      } else {
        const m = getMidpoint(verts, midCache, c, a, posCanonMap)
        nextIndices[wi++] = a
        nextIndices[wi++] = b
        nextIndices[wi++] = m
        nextIndices[wi++] = m
        nextIndices[wi++] = b
        nextIndices[wi++] = c
      }
      for (let k = 0; k < 2; k++) {
        if (nextFaceExcluded) nextFaceExcluded[fi] = excl
        fi++
      }
    } else {
      // n === 2: 3 sub-triangles, fan from the untouched-edge vertex
      if (!sAB) {
        // sBC + sCA: fan from C
        const mBC = getMidpoint(verts, midCache, b, c, posCanonMap)
        const mCA = getMidpoint(verts, midCache, c, a, posCanonMap)
        nextIndices[wi++] = a
        nextIndices[wi++] = b
        nextIndices[wi++] = mBC
        nextIndices[wi++] = a
        nextIndices[wi++] = mBC
        nextIndices[wi++] = mCA
        nextIndices[wi++] = c
        nextIndices[wi++] = mCA
        nextIndices[wi++] = mBC
      } else if (!sBC) {
        // sAB + sCA: fan from A
        const mAB = getMidpoint(verts, midCache, a, b, posCanonMap)
        const mCA = getMidpoint(verts, midCache, c, a, posCanonMap)
        nextIndices[wi++] = a
        nextIndices[wi++] = mAB
        nextIndices[wi++] = mCA
        nextIndices[wi++] = mAB
        nextIndices[wi++] = b
        nextIndices[wi++] = c
        nextIndices[wi++] = mAB
        nextIndices[wi++] = c
        nextIndices[wi++] = mCA
      } else {
        // sAB + sBC: fan from B
        const mAB = getMidpoint(verts, midCache, a, b, posCanonMap)
        const mBC = getMidpoint(verts, midCache, b, c, posCanonMap)
        nextIndices[wi++] = b
        nextIndices[wi++] = mBC
        nextIndices[wi++] = mAB
        nextIndices[wi++] = a
        nextIndices[wi++] = mAB
        nextIndices[wi++] = mBC
        nextIndices[wi++] = a
        nextIndices[wi++] = mBC
        nextIndices[wi++] = c
      }
      for (let k = 0; k < 3; k++) {
        if (nextFaceExcluded) nextFaceExcluded[fi] = excl
        fi++
      }
    }
  }

  return { newIndices: nextIndices, newFaceExcluded: nextFaceExcluded, changed: true }
}

// ── 辅助函数 ──

function edgeLenSq(pos: Float64Array, a: number, b: number): number {
  const dx = pos[a * 3] - pos[b * 3]
  const dy = pos[a * 3 + 1] - pos[b * 3 + 1]
  const dz = pos[a * 3 + 2] - pos[b * 3 + 2]
  return dx * dx + dy * dy + dz * dz
}

function getMidpoint(
  verts: VertStore,
  cache: QuantizedPointMap,
  a: number,
  b: number,
  posCanonMap: QuantizedPointMap | null,
): number {
  const lo = a < b ? a : b,
    hi = a < b ? b : a
  const cached = cache.get(lo, hi, 0)
  if (cached !== -1) return cached

  const pos = verts.pos,
    nrm = verts.nrm

  const mx = (pos[a * 3] + pos[b * 3]) / 2
  const my = (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2
  const mz = (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2

  const nx = nrm[a * 3] + nrm[b * 3]
  const ny = nrm[a * 3 + 1] + nrm[b * 3 + 1]
  const nz = nrm[a * 3 + 2] + nrm[b * 3 + 2]
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1

  const idx = verts.count
  if (idx === verts.cap) verts.grow()
  verts.pos[idx * 3] = mx
  verts.pos[idx * 3 + 1] = my
  verts.pos[idx * 3 + 2] = mz
  verts.nrm[idx * 3] = nx / nl
  verts.nrm[idx * 3 + 1] = ny / nl
  verts.nrm[idx * 3 + 2] = nz / nl
  if (verts.wgt) verts.wgt[idx] = (verts.wgt[a] + verts.wgt[b]) / 2
  // 维护规范位置 ID
  if (verts.canon && posCanonMap) {
    verts.canon[idx] = posCanonMap.getOrSet(mx, my, mz, idx)
  }
  verts.count = idx + 1

  cache.getOrSet(lo, hi, 0, idx)
  return idx
}

// ── 准确模式：非 indexed → indexed（带锐边分裂） ──
//
// 关键：同一位置但法线夹角 > SHARP_ANGLE_DEG 的顶点会被分裂成不同的 indexed vertex。
// 这确保立方体的每个面保持独立的法线方向，位移后不会产生破面。

interface ClusterInfo {
  idx: number
  fnU: [number, number, number] // 面法线单位向量（运行平均值）
}

function toIndexed(
  geometry: THREE.BufferGeometry,
  nonIndexedWeights: Float32Array | null = null,
): { verts: VertStore; indices: Uint32Array; posCanonMap: QuantizedPointMap } {
  const posAttr = geometry.attributes.position
  const n = posAttr.count

  // 预计算每个面的法线（单位 + 原始叉积）
  const faceNrmUnit = new Float32Array(n * 3)
  const faceNrmRaw = new Float32Array(n * 3)
  for (let t = 0; t < n; t += 3) {
    const ax = posAttr.getX(t),
      ay = posAttr.getY(t),
      az = posAttr.getZ(t)
    const bx = posAttr.getX(t + 1),
      by = posAttr.getY(t + 1),
      bz = posAttr.getZ(t + 1)
    const cx = posAttr.getX(t + 2),
      cy = posAttr.getY(t + 2),
      cz = posAttr.getZ(t + 2)
    const e1x = bx - ax,
      e1y = by - ay,
      e1z = bz - az
    const e2x = cx - ax,
      e2y = cy - ay,
      e2z = cz - az
    const rx = e1y * e2z - e1z * e2y
    const ry = e1z * e2x - e1x * e2z
    const rz = e1x * e2y - e1y * e2x
    const len = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1
    const ux = rx / len,
      uy = ry / len,
      uz = rz / len
    for (let v = 0; v < 3; v++) {
      faceNrmUnit[(t + v) * 3] = ux
      faceNrmUnit[(t + v) * 3 + 1] = uy
      faceNrmUnit[(t + v) * 3 + 2] = uz
      faceNrmRaw[(t + v) * 3] = rx
      faceNrmRaw[(t + v) * 3 + 1] = ry
      faceNrmRaw[(t + v) * 3 + 2] = rz
    }
  }

  const indices = new Uint32Array(n)
  const verts = makeVertStore(Math.max(16, Math.min(1 << 16, n)), !!nonIndexedWeights, true)
  // position → first vertex idx at that position (canonical ID)
  const posCanonMap = new QuantizedPointMap(QUANTISE, Math.min(n, 1 << 22))
  // canonical ID → cluster list at that position
  const clustersByCanon = new Map<number, ClusterInfo[]>()

  for (let i = 0; i < n; i++) {
    const px = posAttr.getX(i)
    const py = posAttr.getY(i)
    const pz = posAttr.getZ(i)
    const fnUx = faceNrmUnit[i * 3],
      fnUy = faceNrmUnit[i * 3 + 1],
      fnUz = faceNrmUnit[i * 3 + 2]
    const fnRx = faceNrmRaw[i * 3],
      fnRy = faceNrmRaw[i * 3 + 1],
      fnRz = faceNrmRaw[i * 3 + 2]

    // 第一个到达此位置的顶点成为 canonical ID
    const canonId = posCanonMap.getOrSet(px, py, pz, verts.count)
    const clusters = posCanonMap.inserted ? undefined : clustersByCanon.get(canonId)

    if (clusters) {
      let matched = false
      for (const cl of clusters) {
        const dot = cl.fnU[0] * fnUx + cl.fnU[1] * fnUy + cl.fnU[2] * fnUz
        if (dot >= SHARP_COS) {
          // 同一 smooth group — 累加面积加权法线
          const idx = cl.idx
          verts.nrm[idx * 3] += fnRx
          verts.nrm[idx * 3 + 1] += fnRy
          verts.nrm[idx * 3 + 2] += fnRz
          if (verts.wgt && nonIndexedWeights && nonIndexedWeights[i] > verts.wgt[idx]) {
            verts.wgt[idx] = nonIndexedWeights[i]
          }
          // 更新 cluster 代表法线为运行平均值
          cl.fnU[0] += fnUx
          cl.fnU[1] += fnUy
          cl.fnU[2] += fnUz
          const rl =
            Math.sqrt(cl.fnU[0] * cl.fnU[0] + cl.fnU[1] * cl.fnU[1] + cl.fnU[2] * cl.fnU[2]) || 1
          cl.fnU[0] /= rl
          cl.fnU[1] /= rl
          cl.fnU[2] /= rl
          indices[i] = idx
          matched = true
          break
        }
      }
      if (!matched) {
        // 此位置的新 cluster（锐边分裂）
        const idx = verts.count
        if (idx === verts.cap) verts.grow()
        verts.pos[idx * 3] = px
        verts.pos[idx * 3 + 1] = py
        verts.pos[idx * 3 + 2] = pz
        verts.nrm[idx * 3] = fnRx
        verts.nrm[idx * 3 + 1] = fnRy
        verts.nrm[idx * 3 + 2] = fnRz
        if (verts.wgt && nonIndexedWeights) verts.wgt[idx] = nonIndexedWeights[i]
        if (verts.canon) verts.canon[idx] = canonId
        verts.count++
        clusters.push({ idx, fnU: [fnUx, fnUy, fnUz] })
        indices[i] = idx
      }
    } else {
      // 此位置的第一个顶点
      const idx = verts.count // === canonId
      if (idx === verts.cap) verts.grow()
      verts.pos[idx * 3] = px
      verts.pos[idx * 3 + 1] = py
      verts.pos[idx * 3 + 2] = pz
      verts.nrm[idx * 3] = fnRx
      verts.nrm[idx * 3 + 1] = fnRy
      verts.nrm[idx * 3 + 2] = fnRz
      if (verts.wgt && nonIndexedWeights) verts.wgt[idx] = nonIndexedWeights[i]
      if (verts.canon) verts.canon[idx] = canonId
      verts.count++
      clustersByCanon.set(canonId, [{ idx, fnU: [fnUx, fnUy, fnUz] }])
      indices[i] = idx
    }
  }

  normalizeStoreNormals(verts)
  return { verts, indices, posCanonMap }
}

function normalizeStoreNormals(verts: VertStore): void {
  const nrm = verts.nrm
  for (let i = 0; i < verts.count; i++) {
    const nx = nrm[i * 3]
    const ny = nrm[i * 3 + 1]
    const nz = nrm[i * 3 + 2]
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    nrm[i * 3] = nx / len
    nrm[i * 3 + 1] = ny / len
    nrm[i * 3 + 2] = nz / len
  }
}

// ── Indexed → non-indexed ──

function toNonIndexed(
  verts: VertStore,
  indices: Uint32Array,
  faceExcluded: Uint8Array | null = null,
): THREE.BufferGeometry {
  const positions = verts.pos,
    normals = verts.nrm,
    weights = verts.wgt
  const triCount = indices.length / 3
  const posArray = new Float32Array(triCount * 9)
  const nrmArray = new Float32Array(triCount * 9)
  const wgtArray = faceExcluded || weights ? new Float32Array(triCount * 3) : null

  for (let t = 0; t < triCount; t++) {
    const faceW = faceExcluded ? (faceExcluded[t] ? 1.0 : 0.0) : null
    for (let v = 0; v < 3; v++) {
      const vidx = indices[t * 3 + v]
      posArray[t * 9 + v * 3] = positions[vidx * 3]
      posArray[t * 9 + v * 3 + 1] = positions[vidx * 3 + 1]
      posArray[t * 9 + v * 3 + 2] = positions[vidx * 3 + 2]

      nrmArray[t * 9 + v * 3] = normals[vidx * 3]
      nrmArray[t * 9 + v * 3 + 1] = normals[vidx * 3 + 1]
      nrmArray[t * 9 + v * 3 + 2] = normals[vidx * 3 + 2]

      if (wgtArray) wgtArray[t * 3 + v] = faceW !== null ? faceW : weights![vidx]
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(posArray, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(nrmArray, 3))
  if (wgtArray) geo.setAttribute('excludeWeight', new THREE.BufferAttribute(wgtArray, 1))
  return geo
}
