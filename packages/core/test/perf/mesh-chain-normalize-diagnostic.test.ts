/**
 * mesh-chain-normalize-diagnostic — meshBoolean 输出过不了 normalize 的诊断（2026-10-22）。
 *
 * 现象：mesh 链里 subtract 结果能 normalize（E_MESH_SOLID_UNWELDABLE 没触发），但
 * union(carved, ebL, ebR, pL, pR, nose) 在 normalize 收尾抛 E_MESH_SOLID_UNWELDABLE
 * （weld tolerance = bbox 对角 ×1e-6 ≈ 3.5e-5 mm）。
 *
 * 本探针直接走裸 brepkit kernel，复现同一链，打印：
 * - 每步 meshBoolean 输出的 welded_health（1e-6/1e-5/1e-4 三档网格下的边界边与
 *   非流形边计数——近似 Rust 侧 SELF_CHECK_GRID 的自检语义）；
 * - normalize 各 weld tolerance 下 isValid 是否通过（定位是"输出真开洞"还是
 *   "weld 容差太紧"）。
 *
 * 用法（packages/core 目录）：
 *   npx vitest run --config vitest.perf.config.ts mesh-chain-normalize-diagnostic
 */
import { describe, expect, it } from 'vitest'
import { createBrepkitPrimitives, getBrepKitKernel } from '@faicad/faijs/brepkit-kernel/brepkitKernel'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import type { BrepHandle } from '../../src/brep/engine/types'

const bh = (n: number): BrepHandle => n as unknown as BrepHandle

type Raw = {
  meshBoolean(a: Float64Array, ia: Uint32Array, b: Float64Array, ib: Uint32Array, op: string, tol: number): { positions: Float64Array; indices: Uint32Array }
}

/** UV 球（Z-up，极向 m × 方位向 n 网格）。 */
function uvSphere(radius: number, n: number, m: number, cx = 0, cy = 0, cz = 0): { positions: Float32Array; indices: Uint32Array } {
  const positions: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= m; i++) {
    const theta = (i / m) * Math.PI
    for (let j = 0; j <= n; j++) {
      const phi = (j / n) * 2 * Math.PI
      positions.push(
        cx + radius * Math.sin(theta) * Math.cos(phi),
        cy + radius * Math.cos(theta),
        cz + radius * Math.sin(theta) * Math.sin(phi),
      )
    }
  }
  const row = n + 1
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * row + j
      const b = a + 1
      const c = (i + 1) * row + j
      const d = c + 1
      indices.push(a, b, c, b, d, c)
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
}

/** 变形球（scale3d 语义：绕原点三轴缩放）。 */
function scaledSphere(radius: number, sx: number, sy: number, sz: number, cx = 0, cy = 0, cz = 0): { positions: Float32Array; indices: Uint32Array } {
  const s = uvSphere(radius, 32, 16)
  const p = new Float32Array(s.positions.length)
  for (let i = 0; i < s.positions.length; i += 3) {
    p[i] = s.positions[i] * sx + cx
    p[i + 1] = s.positions[i + 1] * sy + cy
    p[i + 2] = s.positions[i + 2] * sz + cz
  }
  return { positions: p, indices: s.indices }
}

/** 圆柱（Z 轴，底面在原点）。 */
function cylinder(radius: number, height: number, cx = 0, cy = 0, cz = 0): { positions: Float32Array; indices: Uint32Array } {
  const positions: number[] = []
  const indices: number[] = []
  const n = 32
  for (let i = 0; i <= n; i++) {
    const phi = (i / n) * 2 * Math.PI
    positions.push(cx + radius * Math.cos(phi), cy + radius * Math.sin(phi), cz)
    positions.push(cx + radius * Math.cos(phi), cy + radius * Math.sin(phi), cz + height)
  }
  const idx = (a: number, b: number, c: number) => indices.push(a, b, c)
  for (let i = 0; i < n; i++) {
    const a = i * 2
    const b = i * 2 + 1
    const c = (i + 1) * 2
    const d = (i + 1) * 2 + 1
    idx(a, b, c); idx(b, d, c) // 侧面
    idx(a, c, 0); idx(b, 1, d) // 端盖（原点扇 / 顶扇——不精确但闭合即可）
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
}

/** 焊接到网格后的健康计数（Rust welded_health 的 JS 等价：边界边 / 非流形边）。 */
function weldedHealth(pos: ArrayLike<number>, idx: ArrayLike<number>, grid: number): { boundary: number; nonManifold: number } {
  const s = 1 / grid
  const q = (v: number): [number, number, number] => [Math.round((pos[v] as number) * s), Math.round((pos[v + 1] as number) * s), Math.round((pos[v + 2] as number) * s)]
  const occ = new Map<string, number>()
  const keyOf = (a: [number, number, number], b: [number, number, number]) => (a[0] <= b[0] ? `${a[0]},${a[1]},${a[2]}|${b[0]},${b[1]},${b[2]}` : `${b[0]},${b[1]},${b[2]}|${a[0]},${a[1]},${a[2]}`)
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = q((idx[t] as number) * 3)
    const b = q((idx[t + 1] as number) * 3)
    const c = q((idx[t + 2] as number) * 3)
    if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) continue
    if (b[0] === c[0] && b[1] === c[1] && b[2] === c[2]) continue
    if (c[0] === a[0] && c[1] === a[1] && c[2] === a[2]) continue
    for (const [p, r] of [[a, b], [b, c], [c, a]] as const) {
      const k = keyOf(p, r)
      occ.set(k, (occ.get(k) ?? 0) + 1)
    }
  }
  let boundary = 0
  let nonManifold = 0
  for (const c of occ.values()) {
    if (c === 1) boundary++
    else if (c > 2) nonManifold++
  }
  return { boundary, nonManifold }
}

/** 返回带自由边的三角形样例：每样例打印三角形的三个顶点坐标。 */
function boundaryTriangleSamples(pos: ArrayLike<number>, idx: ArrayLike<number>, grid: number, maxSamples = 6): void {
  const s = 1 / grid
  const q = (v: number): [number, number, number] => [Math.round((pos[v] as number) * s), Math.round((pos[v + 1] as number) * s), Math.round((pos[v + 2] as number) * s)]
  const keyOf = (a: [number, number, number], b: [number, number, number]) => (a[0] <= b[0] ? `${a[0]},${a[1]},${a[2]}|${b[0]},${b[1]},${b[2]}` : `${b[0]},${b[1]},${b[2]}|${a[0]},${a[1]},${a[2]}`)
  const occ = new Map<string, number>()
  const edgeTri = new Map<string, number[]>()
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const i0 = (idx[t] as number) * 3
    const i1 = (idx[t + 1] as number) * 3
    const i2 = (idx[t + 2] as number) * 3
    const a = q(i0); const b = q(i1); const c = q(i2)
    for (const [p, r] of [[a, b, t], [b, c, t], [c, a, t]] as const) {
      const k = keyOf(p as [number, number, number], r as [number, number, number])
      occ.set(k, (occ.get(k) ?? 0) + 1)
      if (!edgeTri.has(k)) edgeTri.set(k, [t])
    }
  }
  let printed = 0
  for (const [k, cnt] of occ) {
    if (cnt === 1 && printed < maxSamples) {
      const t = edgeTri.get(k)![0]
      const a = (idx[t] as number) * 3
      const b = (idx[t + 1] as number) * 3
      const c = (idx[t + 2] as number) * 3
      // eslint-disable-next-line no-console
      console.log(`    鳍样例 tri#${t}: A(${pos[a]!.toFixed(4)},${pos[a + 1]!.toFixed(4)},${pos[a + 2]!.toFixed(4)}) B(${pos[b]!.toFixed(4)},${pos[b + 1]!.toFixed(4)},${pos[b + 2]!.toFixed(4)}) C(${pos[c]!.toFixed(4)},${pos[c + 1]!.toFixed(4)},${pos[c + 2]!.toFixed(4)})`)
      printed++
    }
  }
}

/** 找出边界边（仅出现一次的边），返回端点距离分布。 */
function boundaryEdgeGaps(pos: ArrayLike<number>, idx: ArrayLike<number>, grid: number): { count: number; dist: number[]; maxDist: number; minDist: number } {  const s = 1 / grid
  const q = (v: number): [number, number, number] => [Math.round((pos[v] as number) * s), Math.round((pos[v + 1] as number) * s), Math.round((pos[v + 2] as number) * s)]
  const keyOf = (a: [number, number, number], b: [number, number, number]) => (a[0] <= b[0] ? `${a[0]},${a[1]},${a[2]}|${b[0]},${b[1]},${b[2]}` : `${b[0]},${b[1]},${b[2]}|${a[0]},${a[1]},${a[2]}`)
  const occ = new Map<string, [number, number, number, number, number, number, number]>()
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const i0 = (idx[t] as number) * 3
    const i1 = (idx[t + 1] as number) * 3
    const i2 = (idx[t + 2] as number) * 3
    const a = q(i0); const b = q(i1); const c = q(i2)
    for (const [p, r] of [[a, b, i0, i1], [b, c, i1, i2], [c, a, i2, i0]] as const) {
      const k = keyOf(p as [number, number, number], r as [number, number, number])
      const v = occ.get(k)
      if (v) v[0]++
      else occ.set(k, [1, p[0] / s, p[1] / s, p[2] / s, r[0] / s, r[1] / s, r[2] / s])
    }
  }
  const dist: number[] = []
  for (const [cnt, x1, y1, z1, x2, y2, z2] of occ.values()) {
    if (cnt === 1) dist.push(Math.hypot(x1 - x2, y1 - y2, z1 - z2))
  }
  dist.sort((a, b) => a - b)
  return { count: dist.length, dist, maxDist: dist.length ? dist[dist.length - 1] : 0, minDist: dist.length ? dist[0] : 0 }
}

/** JS 侧位置焊接：按容差网格合并重复顶点 → 共享索引（与 weldedHealth 同一网格语义）。 */function jsWeld(mesh: { positions: Float64Array | Float32Array; indices: Uint32Array }, tol: number): { positions: Float64Array; indices: Uint32Array; boundary: number } {
  const s = 1 / tol
  const pos = mesh.positions
  const n = pos.length / 3
  const cell = new Map<string, number>()
  const remap = new Int32Array(n)
  const outPos: number[] = []
  for (let i = 0; i < n; i++) {
    const k = `${Math.round((pos[i * 3] as number) * s)},${Math.round((pos[i * 3 + 1] as number) * s)},${Math.round((pos[i * 3 + 2] as number) * s)}`
    const hit = cell.get(k)
    if (hit === undefined) {
      cell.set(k, outPos.length / 3)
      outPos.push(pos[i * 3] as number, pos[i * 3 + 1] as number, pos[i * 3 + 2] as number)
    }
    remap[i] = cell.get(k)!
  }
  const outIdx: number[] = []
  let dropped = 0
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const a = remap[mesh.indices[t] as number]
    const b = remap[mesh.indices[t + 1] as number]
    const c = remap[mesh.indices[t + 2] as number]
    if (a === b || b === c || c === a) { dropped++; continue }
    outIdx.push(a, b, c)
  }
  const out = { positions: new Float64Array(outPos), indices: new Uint32Array(outIdx) }
  // eslint-disable-next-line no-console
  if (dropped > 0) console.log(`  jsWeld: merged ${n}→${outPos.length / 3} verts, dropped ${dropped} degenerate tris`)
  return { ...out, boundary: weldedHealth(out.positions, out.indices, tol).boundary }
}

describe('meshBoolean 输出健康度诊断（face 链 union 复现）', () => {
  it('复现 union(carved, ebL, ebR, pL, pR, nose) 并在三档网格下看 welded health', async () => {
    const k = await createBrepkitPrimitives()
    const raw = getBrepKitKernel() as unknown as Raw
    expect(k).toBeTruthy()

    // 基线：两个干净 UV 球 fuse 的输出健康度（探针原案例——曾"成功"只做了 meshShape）
    const a = uvSphere(10, 32, 16)
    const b = uvSphere(4, 32, 16, 8, 0, 0)
    const tol0 = Math.max(1e-6, Math.hypot(20, 20, 23) * 1e-6)
    const simpleFuse = raw.meshBoolean(new Float64Array(a.positions), a.indices, new Float64Array(b.positions), b.indices, 'fuse', tol0)
    // eslint-disable-next-line no-console
    console.log(`simpleFuse: tris=${simpleFuse.indices.length / 3}, verts=${simpleFuse.positions.length / 3}`)
    for (const g of [1e-6, 1e-4]) {
      // eslint-disable-next-line no-console
      console.log(`  simpleFuse health@${g.toExponential(1)}: ${JSON.stringify(weldedHealth(simpleFuse.positions, simpleFuse.indices, g))}`)
    }
    // 基线 normalize：简单 fuse 输出能否过 importMesh→weld→unify→isValid
    for (const wt of [1e-6, 1e-5, 1e-4, 1e-3]) {
      try {
        const rawSolid = k.meshSolid.importMesh(new Float32Array(simpleFuse.positions), new Uint32Array(simpleFuse.indices))
        const faces = k.getSubShapes(bh(rawSolid), 'face')
        const welded = k.meshSolid.weld(faces, wt)
        const merged = k.meshSolid.unify(welded)
        const valid = k.isValid(welded)
        k.release(bh(rawSolid))
        // eslint-disable-next-line no-console
        console.log(`  simpleFuse normalize weldTol=${wt.toExponential(1)}: isValid=${valid} mergedFaces=${merged}`)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.log(`  simpleFuse normalize weldTol=${wt.toExponential(1)}: threw ${(err as Error).message.slice(0, 120)}`)
      }
    }

    // 与 face 链同构的输入（**统一 32 段**：meshShape(2π/32) 的 head 与 meshPrimitives
    // DEFAULT_SEGMENTS=32 的部件——真实脚本的密度配置）
    const head = scaledSphere(10, 0.9, 1, 1.15)
    const eL = scaledSphere(2.4, 1, 0.7, 1, -3.6, 8.0, 3.2)
    const eR = scaledSphere(2.4, 1, 0.7, 1, 3.6, 8.0, 3.2)
    const mouth = scaledSphere(1.6, 2.2, 1.4, 0.55, 0, 8.2, -3.6)
    const ebL = uvSphere(1.5, 32, 16, -3.6, 8.2, 3.2)
    const ebR = uvSphere(1.5, 32, 16, 3.6, 8.2, 3.2)
    const pL = uvSphere(0.55, 32, 16, -3.6, 9.6, 3.2)
    const pR = uvSphere(0.55, 32, 16, 3.6, 9.6, 3.2)
    const nose = cylinder(0.5, 3.2, 0, 9.0, 0.5)

    const tol = Math.max(1e-6, Math.hypot(20, 20, 23) * 1e-6) // ≈3.5e-5（当前 faijs 口径）
    // eslint-disable-next-line no-console
    console.log(`tolerance = ${tol.toExponential(2)}`)

    // carved = head − eL − eR − mouth
    let carved = raw.meshBoolean(new Float64Array(head.positions), head.indices, new Float64Array(eL.positions), eL.indices, 'cut', tol)
    carved = raw.meshBoolean(new Float64Array(carved.positions), carved.indices, new Float64Array(eR.positions), eR.indices, 'cut', tol)
    carved = raw.meshBoolean(new Float64Array(carved.positions), carved.indices, new Float64Array(mouth.positions), mouth.indices, 'cut', tol)
    // eslint-disable-next-line no-console
    console.log(`carved: tris=${(carved.indices.length / 3)}, health@1e-6=${JSON.stringify(weldedHealth(carved.positions, carved.indices, 1e-6))}`)

    // face = carved ∪ ebL ∪ ebR ∪ pL ∪ pR ∪ nose（每步 JS 回焊 → 下一步输入是水密网格）
    const w0 = Math.max(1e-6, Math.hypot(20, 20, 23) * 1e-6)
    let f1 = raw.meshBoolean(new Float64Array(carved.positions), carved.indices, new Float64Array(ebL.positions), ebL.indices, 'fuse', tol)
    f1 = { positions: f1.positions, indices: f1.indices }
    // eslint-disable-next-line no-console
    console.log(`  step1 fuse(carved,ebL) health@1e-6=${JSON.stringify(weldedHealth(f1.positions, f1.indices, 1e-6))} → jsWeld@${w0.toExponential(1)}`)
    f1 = jsWeld(f1, w0)
    // eslint-disable-next-line no-console
    console.log(`    after jsWeld: boundary@${w0.toExponential(1)}=${(f1 as { boundary?: number }).boundary}`)
    let f2 = raw.meshBoolean(new Float64Array(f1.positions), f1.indices, new Float64Array(ebR.positions), ebR.indices, 'fuse', tol)
    f2 = { positions: f2.positions, indices: f2.indices }
    // eslint-disable-next-line no-console
    console.log(`  step2 fuse(..,ebR) health@1e-6=${JSON.stringify(weldedHealth(f2.positions, f2.indices, 1e-6))} → jsWeld`)
    f2 = jsWeld(f2, w0)
    let f3 = raw.meshBoolean(new Float64Array(f2.positions), f2.indices, new Float64Array(pL.positions), pL.indices, 'fuse', tol)
    f3 = { positions: f3.positions, indices: f3.indices }
    f3 = jsWeld(f3, w0)
    let f4 = raw.meshBoolean(new Float64Array(f3.positions), f3.indices, new Float64Array(pR.positions), pR.indices, 'fuse', tol)
    f4 = { positions: f4.positions, indices: f4.indices }
    f4 = jsWeld(f4, w0)
    let f5 = raw.meshBoolean(new Float64Array(f4.positions), f4.indices, new Float64Array(nose.positions), nose.indices, 'fuse', tol)
    f5 = { positions: f5.positions, indices: f5.indices }
    // eslint-disable-next-line no-console
    console.log(`  step5 fuse(..,nose) health@1e-6=${JSON.stringify(weldedHealth(f5.positions, f5.indices, 1e-6))}`)

    // 收尾 normalize（当前 faijs 的 importMesh→weld→unify→isValid）
    for (const wt of [1e-6, 1e-5, 1e-4]) {
      try {
        const rawSolid = k.meshSolid.importMesh(new Float32Array(f5.positions), new Uint32Array(f5.indices))
        const faces = k.getSubShapes(bh(rawSolid), 'face')
        const welded = k.meshSolid.weld(faces, wt)
        const merged = k.meshSolid.unify(welded)
        const valid = k.isValid(welded)
        k.release(bh(rawSolid))
        // eslint-disable-next-line no-console
        console.log(`jsWeld 链收尾 normalize weldTol=${wt.toExponential(1)}: isValid=${valid} mergedFaces=${merged}`)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.log(`jsWeld 链收尾 normalize weldTol=${wt.toExponential(1)}: threw ${(err as Error).message.slice(0, 120)}`)
      }
    }

    // ── 方案 B：每步 CSG 后做**内核 normalize**（weld+unify+isValid）再 meshShape 喂下一步 ──
    const normToTri = (pos: Float64Array, idx: Uint32Array, wt: number): { positions: Float32Array; indices: Uint32Array } | null => {
      try {
        const rawSolid = k.meshSolid.importMesh(new Float32Array(pos), new Uint32Array(idx))
        const faces = k.getSubShapes(bh(rawSolid), 'face')
        const welded = k.meshSolid.weld(faces, wt)
        k.meshSolid.unify(welded)
        if (!k.isValid(welded)) { k.release(bh(rawSolid)); return null }
        const tess = k.meshShape(welded, { linearDeflection: 0.1, angularDeflection: (2 * Math.PI) / 32 })
        k.release(bh(rawSolid))
        return { positions: new Float32Array(tess.positions), indices: new Uint32Array(tess.indices) }
      } catch {
        return null
      }
    }

    // ── 容差扫描：完整链在不同 CSG tol 下的表现（统一 32 段输入） ──
    for (const csgTol of [1e-7, 1e-6, 3.65e-5, 3.65e-4, 1e-3]) {
      const wtSweep = Math.max(1e-6, Math.hypot(20, 20, 23) * 1e-6) // normalize 焊接容差不变
      const headT = scaledSphere(10, 0.9, 1, 1.15)
      const eLT = scaledSphere(2.4, 1, 0.7, 1, -3.6, 8.0, 3.2)
      const eRT = scaledSphere(2.4, 1, 0.7, 1, 3.6, 8.0, 3.2)
      const mouthT = scaledSphere(1.6, 2.2, 1.4, 0.55, 0, 8.2, -3.6)
      const ebLT = uvSphere(1.5, 32, 16, -3.6, 8.2, 3.2)
      const ebRT = uvSphere(1.5, 32, 16, 3.6, 8.2, 3.2)
      const pLT = uvSphere(0.55, 32, 16, -3.6, 9.6, 3.2)
      const pRT = uvSphere(0.55, 32, 16, 3.6, 9.6, 3.2)
      const noseT = cylinder(0.5, 3.2, 0, 9.0, 0.5)
      let cT = raw.meshBoolean(new Float64Array(headT.positions), headT.indices, new Float64Array(eLT.positions), eLT.indices, 'cut', csgTol)
      cT = raw.meshBoolean(new Float64Array(cT.positions), cT.indices, new Float64Array(eRT.positions), eRT.indices, 'cut', csgTol)
      cT = raw.meshBoolean(new Float64Array(cT.positions), cT.indices, new Float64Array(mouthT.positions), mouthT.indices, 'cut', csgTol)
      const cT2 = normToTri(new Float64Array(cT.positions), cT.indices, wtSweep)
      if (!cT2) { console.log(`tol=${csgTol.toExponential(1)}: carved normalize FAILED`); continue }
      let curT = cT2
      let ok = true
      for (const part of [ebLT, ebRT, pLT, pRT, noseT]) {
        const rT = raw.meshBoolean(new Float64Array(curT.positions), curT.indices, new Float64Array(part.positions), part.indices, 'fuse', csgTol)
        const hT = weldedHealth(rT.positions, rT.indices, 1e-6)
        const cleanT = normToTri(new Float64Array(rT.positions), rT.indices, wtSweep)
        if (!cleanT) { console.log(`tol=${csgTol.toExponential(1)}: union step FAILED (${rT.indices.length / 3} tris, boundary=${hT.boundary})`); ok = false; break }
        curT = cleanT
      }
      if (ok) console.log(`tol=${csgTol.toExponential(1)}: 全链通过，最终 ${curT.indices.length / 3} tris`)
    }

    // ── 后焊容差检查：pL 步骤输出在 {3.65e-5, 3.65e-4, 1e-3} 下焊后自由边 + isValid ──
    {
      const headW = scaledSphere(10, 0.9, 1, 1.15)
      const eLW = scaledSphere(2.4, 1, 0.7, 1, -3.6, 8.0, 3.2)
      const eRW = scaledSphere(2.4, 1, 0.7, 1, 3.6, 8.0, 3.2)
      const mouthW = scaledSphere(1.6, 2.2, 1.4, 0.55, 0, 8.2, -3.6)
      const ebLW = uvSphere(1.5, 32, 16, -3.6, 8.2, 3.2)
      const ebRW = uvSphere(1.5, 32, 16, 3.6, 8.2, 3.2)
      const pLW = uvSphere(0.55, 32, 16, -3.6, 9.6, 3.2)
      const wtW = Math.max(1e-6, Math.hypot(20, 20, 23) * 1e-6)
      let cW = raw.meshBoolean(new Float64Array(headW.positions), headW.indices, new Float64Array(eLW.positions), eLW.indices, 'cut', wtW)
      cW = raw.meshBoolean(new Float64Array(cW.positions), cW.indices, new Float64Array(eRW.positions), eRW.indices, 'cut', wtW)
      cW = raw.meshBoolean(new Float64Array(cW.positions), cW.indices, new Float64Array(mouthW.positions), mouthW.indices, 'cut', wtW)
      let curW = normToTri(new Float64Array(cW.positions), cW.indices, wtW)!
      const rW1 = raw.meshBoolean(new Float64Array(curW.positions), curW.indices, new Float64Array(ebLW.positions), ebLW.indices, 'fuse', wtW)
      curW = normToTri(new Float64Array(rW1.positions), rW1.indices, wtW)!
      const rW2 = raw.meshBoolean(new Float64Array(curW.positions), curW.indices, new Float64Array(ebRW.positions), ebRW.indices, 'fuse', wtW)
      curW = normToTri(new Float64Array(rW2.positions), rW2.indices, wtW)!
      const rW = raw.meshBoolean(new Float64Array(curW.positions), curW.indices, new Float64Array(pLW.positions), pLW.indices, 'fuse', wtW)
      const rawSolidW = k.meshSolid.importMesh(new Float32Array(rW.positions), new Uint32Array(rW.indices))
      const facesW = k.getSubShapes(bh(rawSolidW), 'face')
      for (const wt of [3.65e-5, 3.65e-4, 1e-3]) {
        const weldedW = k.meshSolid.weld(facesW, wt)
        const hAfter = weldedHealth(rW.positions, rW.indices, 1e-6) // 原始索引未变，仅参考
        // 焊后自由边：从 welded 实体再 meshShape 数边界（内核拓扑 → 三角化）
        const tessW = k.meshShape(weldedW, { linearDeflection: 0.1, angularDeflection: (2 * Math.PI) / 32 })
        const hTess = weldedHealth(tessW.positions, tessW.indices, 1e-6)
        const validW = k.isValid(weldedW)
        // eslint-disable-next-line no-console
        console.log(`pL 后焊 weldTol=${wt.toExponential(1)}: isValid=${validW} 焊后meshShape边界@1e-6=${hTess.boundary} (原始soup boundary=${hAfter.boundary})`)
        k.release(bh(weldedW))
      }
      k.release(bh(rawSolidW))
    }

    // ── 内核 face-BOP 全链（kernel.fuse/cut on mesh solids，0.37.0 网格后端路径）──
    {
      const headF = scaledSphere(10, 0.9, 1, 1.15)
      const eLF = scaledSphere(2.4, 1, 0.7, 1, -3.6, 8.0, 3.2)
      const eRF = scaledSphere(2.4, 1, 0.7, 1, 3.6, 8.0, 3.2)
      const mouthF = scaledSphere(1.6, 2.2, 1.4, 0.55, 0, 8.2, -3.6)
      const ebLF = uvSphere(1.5, 32, 16, -3.6, 8.2, 3.2)
      const ebRF = uvSphere(1.5, 32, 16, 3.6, 8.2, 3.2)
      const pLF = uvSphere(0.55, 32, 16, -3.6, 9.6, 3.2)
      const pRF = uvSphere(0.55, 32, 16, 3.6, 9.6, 3.2)
      const noseF = cylinder(0.5, 3.2, 0, 9.0, 0.5)
      const wtF = Math.max(1e-6, Math.hypot(20, 20, 23) * 1e-6)
      const mkSolid = (m: { positions: Float32Array; indices: Uint32Array }): BrepHandle => {
        const rawS = k.meshSolid.importMesh(m.positions, m.indices)
        const f = k.getSubShapes(bh(rawS), 'face')
        const w = k.meshSolid.weld(f, wtF)
        k.meshSolid.unify(w)
        if (!k.isValid(w)) throw new Error('import 失败')
        k.release(bh(rawS))
        return w
      }
      const parts: Array<[string, { positions: Float32Array; indices: Uint32Array }]> = [
        ['head', headF], ['eL', eLF], ['eR', eRF], ['mouth', mouthF],
        ['ebL', ebLF], ['ebR', ebRF], ['pL', pLF], ['pR', pRF], ['nose', noseF],
      ]
      const solids = new Map<string, BrepHandle>()
      for (const [n, m] of parts) {
        const t0 = performance.now()
        solids.set(n, mkSolid(m))
        // eslint-disable-next-line no-console
        console.log(`face-BOP import ${n}: ${(performance.now() - t0).toFixed(0)}ms`)
      }
      // carved = head − eL − eR − mouth
      let curF = solids.get('head')!
      for (const n of ['eL', 'eR', 'mouth'] as const) {
        const t0 = performance.now()
        const r = k.cut(curF, solids.get(n)!)
        k.release(bh(curF))
        curF = r
        // eslint-disable-next-line no-console
        console.log(`face-BOP cut(-${n}): ${(performance.now() - t0).toFixed(0)}ms isValid=${k.isValid(curF)}`)
      }
      // face = carved ∪ ebL ∪ ebR ∪ pL ∪ pR ∪ nose
      for (const n of ['ebL', 'ebR', 'pL', 'pR', 'nose'] as const) {
        const t0 = performance.now()
        const r = k.fuse(curF, solids.get(n)!)
        k.release(bh(curF))
        curF = r
        // eslint-disable-next-line no-console
        console.log(`face-BOP fuse(+${n}): ${(performance.now() - t0).toFixed(0)}ms isValid=${k.isValid(curF)}`)
      }
      // ── 每步后 unify 降面数：cut/fuse 结果统一共面后再进下一步 ──
      let curU = solids.get('head')!
      for (const n of ['eL', 'eR', 'mouth'] as const) {
        const t0 = performance.now()
        const r = k.cut(curU, solids.get(n)!)
        k.release(bh(curU))
        curU = r
        const facesBefore = k.getSubShapes(bh(curU), 'face').length
        k.meshSolid.unify(curU)
        const facesAfter = k.getSubShapes(bh(curU), 'face').length
        // eslint-disable-next-line no-console
        console.log(`unify链 cut(-${n}): ${(performance.now() - t0).toFixed(0)}ms 面数 ${facesBefore}→${facesAfter} isValid=${k.isValid(curU)}`)
      }
      for (const n of ['ebL', 'ebR', 'pL', 'pR', 'nose'] as const) {
        const t0 = performance.now()
        const r = k.fuse(curU, solids.get(n)!)
        k.release(bh(curU))
        curU = r
        const facesBefore = k.getSubShapes(bh(curU), 'face').length
        k.meshSolid.unify(curU)
        const facesAfter = k.getSubShapes(bh(curU), 'face').length
        // eslint-disable-next-line no-console
        console.log(`unify链 fuse(+${n}): ${(performance.now() - t0).toFixed(0)}ms 面数 ${facesBefore}→${facesAfter} isValid=${k.isValid(curU)}`)
      }
      const tessU = k.meshShape(curU, { linearDeflection: 0.1, angularDeflection: (2 * Math.PI) / 32 })
      const hU = weldedHealth(tessU.positions, tessU.indices, 1e-6)
      // eslint-disable-next-line no-console
      console.log(`unify链 最终: isValid=${k.isValid(curU)} meshShape tris=${tessU.indices.length / 3} 边界@1e-6=${hU.boundary}`)
      k.release(bh(curU))
    }

    // ── union 重排：小件先自并（密度相近的接触），再并入 carved ──
    {
      const headR = scaledSphere(10, 0.9, 1, 1.15)
      const eLR = scaledSphere(2.4, 1, 0.7, 1, -3.6, 8.0, 3.2)
      const eRR = scaledSphere(2.4, 1, 0.7, 1, 3.6, 8.0, 3.2)
      const mouthR = scaledSphere(1.6, 2.2, 1.4, 0.55, 0, 8.2, -3.6)
      const ebLR = uvSphere(1.5, 32, 16, -3.6, 8.2, 3.2)
      const ebRR = uvSphere(1.5, 32, 16, 3.6, 8.2, 3.2)
      const pLR = uvSphere(0.55, 32, 16, -3.6, 9.6, 3.2)
      const pRR = uvSphere(0.55, 32, 16, 3.6, 9.6, 3.2)
      const noseR = cylinder(0.5, 3.2, 0, 9.0, 0.5)
      const wtR = Math.max(1e-6, Math.hypot(20, 20, 23) * 1e-6)
      let cR = raw.meshBoolean(new Float64Array(headR.positions), headR.indices, new Float64Array(eLR.positions), eLR.indices, 'cut', wtR)
      cR = raw.meshBoolean(new Float64Array(cR.positions), cR.indices, new Float64Array(eRR.positions), eRR.indices, 'cut', wtR)
      cR = raw.meshBoolean(new Float64Array(cR.positions), cR.indices, new Float64Array(mouthR.positions), mouthR.indices, 'cut', wtR)
      const carvedR = normToTri(new Float64Array(cR.positions), cR.indices, wtR)
      if (!carvedR) { console.log('重排: carved normalize FAILED'); expect(true).toBe(true); return }
      // 眼球装配：ebL ∪ pL，ebR ∪ pR（小件自并）
      const eyeL = raw.meshBoolean(new Float64Array(ebLR.positions), ebLR.indices, new Float64Array(pLR.positions), pLR.indices, 'fuse', wtR)
      const eyeLTri = normToTri(new Float64Array(eyeL.positions), eyeL.indices, wtR)
      const eyeR = raw.meshBoolean(new Float64Array(ebRR.positions), ebRR.indices, new Float64Array(pRR.positions), pRR.indices, 'fuse', wtR)
      const eyeRTri = normToTri(new Float64Array(eyeR.positions), eyeR.indices, wtR)
      // eslint-disable-next-line no-console
      console.log(`重排: eyeL normalize ${eyeLTri ? 'OK' : 'FAILED'}, eyeR normalize ${eyeRTri ? 'OK' : 'FAILED'}`)
      if (!eyeLTri || !eyeRTri) { expect(true).toBe(true); return }
      // carved ∪ eyeL ∪ eyeR ∪ nose
      let fR = raw.meshBoolean(new Float64Array(carvedR.positions), carvedR.indices, new Float64Array(eyeLTri.positions), eyeLTri.indices, 'fuse', wtR)
      const fR1 = normToTri(new Float64Array(fR.positions), fR.indices, wtR)
      // eslint-disable-next-line no-console
      console.log(`重排: carved∪eyeL ${fR1 ? 'OK' : 'FAILED'} (${fR.indices.length / 3} tris)` )
      if (!fR1) { expect(true).toBe(true); return }
      fR = raw.meshBoolean(new Float64Array(fR1.positions), fR1.indices, new Float64Array(eyeRTri.positions), eyeRTri.indices, 'fuse', wtR)
      const fR2 = normToTri(new Float64Array(fR.positions), fR.indices, wtR)
      // eslint-disable-next-line no-console
      console.log(`重排: (+eyeR) ${fR2 ? 'OK' : 'FAILED'} (${fR.indices.length / 3} tris)`)
      if (!fR2) { expect(true).toBe(true); return }
      fR = raw.meshBoolean(new Float64Array(fR2.positions), fR2.indices, new Float64Array(noseR.positions), noseR.indices, 'fuse', wtR)
      const fR3 = normToTri(new Float64Array(fR.positions), fR.indices, wtR)
      // eslint-disable-next-line no-console
      console.log(`重排: (+nose) ${fR3 ? 'OK' : 'FAILED'} (${fR.indices.length / 3} tris)`)
      expect(fR3).toBeTruthy()
    }

    expect(true).toBe(true)
  })
})
