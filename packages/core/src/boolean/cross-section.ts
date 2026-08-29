/**
 * 截面求解器（无 CSG / 无 Manifold.simplify）
 *
 * 给定源网格（THREE.BufferGeometry）和一个局部空间平面，直接求「平面与网格的
 * 交线」，缝合成闭合环（外环 + 孔环），并三角化出截面 cap。这是「拉伸预览无
 * split 方案」的唯一 CPU 几何成本。
 *
 * 为什么不用 Manifold.split：
 *   - split 是整模型布尔运算（焊接 + 全分辨率 CSG），168 万三角面 4~8s/次；
 *   - 本方案只做三角形–平面求交（纯算术），O(n)，且后续可叠加 BVH 降到 O(log n + k)。
 *
 * 设计契约（与 ExtrudeRenderer 现有代码对齐）：
 *   - 输入平面为「局部空间」THREE.Plane（调用方负责把世界平面经 matrixWorld 逆变换得到）。
 *   - computeSection 直接读 geometry.attributes，不拷贝整份顶点缓冲。
 *   - 输出的 cap 顶点为局部空间，预览期经 matrixWorld 渲染到世界空间。
 */
import * as THREE from 'three'

/** 单条闭合环（3D，局部空间，位于截面平面上）。isHole=false 为外边界，true 为孔。 */
export interface SectionRing {
  points: THREE.Vector3[]
  isHole: boolean
}

export interface SectionResult {
  /** 缝合后的全部环（已按面积分类 isHole）。 */
  rings: SectionRing[]
  /** 外环列表（3D 点）。 */
  outers: THREE.Vector3[][]
  /** 每个外环对应的孔环列表（与 outers 同序）。 */
  holesOf: THREE.Vector3[][][]
  /** 实际参与求交、跨越/贴合平面的三角形数（诊断用）。 */
  hitTriangleCount: number
  /** 收集到的交线段数。 */
  segmentCount: number
}

const EPS_SURFACE = 1e-6
/** 线段端点量化容差（平面 2D 坐标），用于缝合相邻线段。 */
const STITCH_TOL = 1e-4

/** 平面正交基 (u, v)，用于把 3D 截面点投影到 2D 以做缝合/面积/三角化。 */
function planeBasis(normal: THREE.Vector3): { u: THREE.Vector3; v: THREE.Vector3 } {
  const n = normal.clone().normalize()
  const t = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const u = new THREE.Vector3().crossVectors(t, n).normalize()
  const v = new THREE.Vector3().crossVectors(n, u).normalize()
  return { u, v }
}

function project2D(p: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3): THREE.Vector2 {
  return new THREE.Vector2(p.dot(u), p.dot(v))
}

/**
 * 端点量化到 STITCH_TOL 网格上作为缝合 key。
 * 用 Math.round 而非 toFixed：避免 -0.00001 → "-0.0000" 与 0 → "0.0000" 被当成两个点。
 */
function key2D(p: THREE.Vector2): string {
  return `${Math.round(p.x / STITCH_TOL)},${Math.round(p.y / STITCH_TOL)}`
}

/** 三角形三个顶点索引（索引几何）或顺次顶点（非索引几何）。 */
interface TriRef {
  a: number
  b: number
  c: number
}

/**
 * 求截面。
 * @param geometry 源网格（局部空间），支持索引/非索引。
 * @param plane    局部空间切割平面（THREE.Plane 语义：normal·p + constant = 0）。
 */
export function computeSection(geometry: THREE.BufferGeometry, plane: THREE.Plane): SectionResult {
  const posAttr = geometry.attributes.position as THREE.BufferAttribute
  if (!posAttr) {
    return { rings: [], outers: [], holesOf: [], hitTriangleCount: 0, segmentCount: 0 }
  }
  const pos = posAttr.array as Float32Array
  const index = geometry.index
  const triCount = index ? index.count / 3 : pos.length / 9

  const refs: TriRef[] = []
  if (index) {
    for (let t = 0; t < triCount; t++) {
      refs.push({ a: index.getX(t * 3), b: index.getX(t * 3 + 1), c: index.getX(t * 3 + 2) })
    }
  } else {
    for (let t = 0; t < triCount; t++) {
      refs.push({ a: t * 3, b: t * 3 + 1, c: t * 3 + 2 })
    }
  }

  const at = (i: number, out: THREE.Vector3) => out.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])

  const n = plane.normal
  const va = new THREE.Vector3()
  const vb = new THREE.Vector3()
  const vc = new THREE.Vector3()

  // 收集交线段（每条 2 个 3D 端点，均在截面上）
  const segments: [THREE.Vector3, THREE.Vector3][] = []
  let hitTriangleCount = 0

  for (const r of refs) {
    at(r.a, va); at(r.b, vb); at(r.c, vc)
    const da = n.dot(va) + plane.constant
    const db = n.dot(vb) + plane.constant
    const dc = n.dot(vc) + plane.constant

    const above = (d: number) => d > EPS_SURFACE
    const below = (d: number) => d < -EPS_SURFACE
    const onSurf = (d: number) => !above(d) && !below(d)

    // 交点插值：在 a、b 边上按距离比例
    const lerp = (ia: number, ib: number, daa: number, dbb: number): THREE.Vector3 => {
      const pa = ia === r.a ? va : ia === r.b ? vb : vc
      const pb = ib === r.a ? va : ib === r.b ? vb : vc
      const t = daa / (daa - dbb)
      return new THREE.Vector3().lerpVectors(pa, pb, t)
    }

    const crossings: THREE.Vector3[] = []
    if (onSurf(da) && (above(db) !== above(dc) || below(db) !== below(dc))) {
      crossings.push(va.clone())
    }
    if (onSurf(db) && (above(da) !== above(dc) || below(da) !== below(dc))) {
      crossings.push(vb.clone())
    }
    if (onSurf(dc) && (above(da) !== above(db) || below(da) !== below(db))) {
      crossings.push(vc.clone())
    }
    // 纯跨越：异侧顶点两两组合产生 2 个交点
    const verts = [
      { i: r.a, d: da, p: va },
      { i: r.b, d: db, p: vb },
      { i: r.c, d: dc, p: vc },
    ]
    const pos_ = verts.filter((x) => above(x.d) || onSurf(x.d))
    const neg_ = verts.filter((x) => below(x.d) || onSurf(x.d))
    // 标准 straddle：恰好 1 顶点在一侧、2 在另一侧 → 两条跨边各一个交点
    if (pos_.length === 1 && neg_.length === 2) {
      const p = pos_[0]
      const [q1, q2] = neg_
      crossings.push(lerp(p.i, q1.i, p.d, q1.d))
      crossings.push(lerp(p.i, q2.i, p.d, q2.d))
    } else if (neg_.length === 1 && pos_.length === 2) {
      const p = neg_[0]
      const [q1, q2] = pos_
      crossings.push(lerp(p.i, q1.i, p.d, q1.d))
      crossings.push(lerp(p.i, q2.i, p.d, q2.d))
    }
    // 去重（同一三角形内重复端点）
    const uniq: THREE.Vector3[] = []
    for (const c of crossings) {
      if (!uniq.some((u) => u.distanceToSquared(c) < 1e-12)) uniq.push(c)
    }
    if (uniq.length >= 2) {
      hitTriangleCount++
      for (let k = 0; k + 1 < uniq.length; k += 2) {
        segments.push([uniq[k], uniq[k + 1]])
      }
    }
  }

  const { u, v } = planeBasis(n)

  // 缝合：按量化端点建邻接，沿共享端点 walk 出闭合环
  const endpoints = new Map<string, Array<{ seg: number; end: 0 | 1 }>>()
  segments.forEach((seg, si) => {
    const ka = key2D(project2D(seg[0], u, v))
    const kb = key2D(project2D(seg[1], u, v))
    if (!endpoints.has(ka)) endpoints.set(ka, [])
    if (!endpoints.has(kb)) endpoints.set(kb, [])
    endpoints.get(ka)!.push({ seg: si, end: 0 })
    endpoints.get(kb)!.push({ seg: si, end: 1 })
  })

  const visited = new Set<number>()
  const loops: THREE.Vector3[][] = []
  for (let si = 0; si < segments.length; si++) {
    if (visited.has(si)) continue
    const loop: THREE.Vector3[] = []
    const start = segments[si][0]
    loop.push(start)
    visited.add(si)
    let curKey = key2D(project2D(segments[si][1], u, v))
    const startKey = key2D(project2D(start, u, v))
    // 防止无限循环
    let guard = 0
    const maxSteps = segments.length * 2 + 4
    while (guard++ < maxSteps) {
      const cands = endpoints.get(curKey)?.filter((c) => !visited.has(c.seg)) ?? []
      if (cands.length === 0) break
      const c = cands[0]
      const otherEnd = c.end === 0 ? segments[c.seg][1] : segments[c.seg][0]
      loop.push(otherEnd)
      visited.add(c.seg)
      const nk = key2D(project2D(otherEnd, u, v))
      if (nk === startKey) break
      curKey = nk
    }
    loops.push(loop)
  }

  // 分类外环/孔环。
  // 关键：不能单纯按「面积<0 即孔」判断，因为缝合出的环绕序不固定（可能整体 CW）。
  // 正确做法：以「绝对面积最大的环」为外环基准，其有向面积符号 outerSign 定义外环方向；
  // 与之同号者为外环、异号者为孔环。这样即使所有环都 CW，最大面积环仍被正确认作外环。
  const signedArea = (loop: THREE.Vector3[]): number => {
    let area = 0
    for (let i = 0; i < loop.length; i++) {
      const p = project2D(loop[i], u, v)
      const q = project2D(loop[(i + 1) % loop.length], u, v)
      area += p.x * q.y - q.x * p.y
    }
    return area / 2
  }

  const areas = loops.map((pts) => signedArea(pts))
  let maxIdx = 0
  for (let i = 1; i < areas.length; i++) {
    if (Math.abs(areas[i]) > Math.abs(areas[maxIdx])) maxIdx = i
  }
  const outerSign = areas.length > 0 ? Math.sign(areas[maxIdx]) || 1 : 1

  const rings: SectionRing[] = loops.map((pts, i) => {
    const isHole = Math.sign(areas[i]) !== outerSign
    // 统一：外环取 outerSign（CCW），孔环取 -outerSign（CW）
    const wantSign = isHole ? -outerSign : outerSign
    const oriented = Math.sign(areas[i]) !== wantSign ? [...pts].reverse() : pts
    return { points: oriented, isHole }
  })

  const outers = rings.filter((r) => !r.isHole).map((r) => r.points)
  const holes = rings.filter((r) => r.isHole).map((r) => r.points)

  // 把孔分给包含其重心的外环
  const holesOf: THREE.Vector3[][][] = outers.map(() => [])
  const centroid = (loop: THREE.Vector3[]): THREE.Vector2 => {
    const c = new THREE.Vector2()
    for (const p of loop) c.add(project2D(p, u, v))
    return c.multiplyScalar(1 / Math.max(1, loop.length))
  }
  const pointInLoop = (pt: THREE.Vector2, loop: THREE.Vector3[]): boolean => {
    let inside = false
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = project2D(loop[i], u, v)
      const b = project2D(loop[j], u, v)
      if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside
      }
    }
    return inside
  }
  holes.forEach((h) => {
    const hc = centroid(h)
    let assigned = -1
    for (let oi = 0; oi < outers.length; oi++) {
      if (pointInLoop(hc, outers[oi])) { assigned = oi; break }
    }
    if (assigned < 0) assigned = 0
    holesOf[assigned].push(h)
  })

  return { rings, outers, holesOf, hitTriangleCount, segmentCount: segments.length }
}

/**
 * 由截面 rings 生成「沿法线挤出 length、起始于 start」的棱柱几何（局部空间）。
 * 输出同时含：cap 三角化（上下端面）+ 所有环边界的侧壁。可直接喂给
 * THREE.BufferGeometry 或转 ManifoldMeshData。
 *
 * @param section    computeSection 结果
 * @param normal     挤出方向（局部空间，单位向量）
 * @param length     拉伸长度
 * @param start      沿法线的起始偏移（centered 模式传 offsetBack，使棱柱落在 [offsetBack, offsetFront]）
 */
export function buildExtrudedProfile(
  section: SectionResult,
  normal: THREE.Vector3,
  length: number,
  start = 0,
): { positions: Float32Array; indices: Uint32Array } {
  const positions: number[] = []
  const indices: number[] = []
  const dx = normal.x * length
  const dy = normal.y * length
  const dz = normal.z * length
  const sx = normal.x * start
  const sy = normal.y * start
  const sz = normal.z * start

  section.outers.forEach((outer, oi) => {
    const holeLoops = section.holesOf[oi]
    // 本组所有边界环（外环在前，孔环随后），顺序即 pts3D 顺序，也是 triangulateShape 的顶点顺序
    const allLoops: THREE.Vector3[][] = [outer, ...holeLoops]
    const offsets: number[] = []
    const pts3D: THREE.Vector3[] = []
    for (const loop of allLoops) {
      offsets.push(pts3D.length)
      pts3D.push(...loop)
    }
    const basis = planeBasis(normal)
    const to2D = (p: THREE.Vector3) => project2D(p, basis.u, basis.v)
    const tris = THREE.ShapeUtils.triangulateShape(
      outer.map(to2D),
      holeLoops.map((h) => h.map(to2D)),
    )
    if (!tris || tris.length === 0) return

    const base = positions.length / 3
    const vCount = pts3D.length
    // bottom cap（含 start 偏移）
    for (const p of pts3D) positions.push(p.x + sx, p.y + sy, p.z + sz)
    for (const t of tris) indices.push(base + t[0], base + t[1], base + t[2])
    // top cap（reversed winding）
    const topBase = base + vCount
    for (const p of pts3D) positions.push(p.x + sx + dx, p.y + sy + dy, p.z + sz + dz)
    for (const t of tris) indices.push(topBase + t[0], topBase + t[2], topBase + t[1])

    // 侧壁：每个边界环的相邻顶点构成竖直 quad（用环内偏移，避免引用查找）
    allLoops.forEach((loop, li) => {
      const off = offsets[li]
      const len = loop.length
      for (let k = 0; k < len; k++) {
        const a = off + k
        const b = off + ((k + 1) % len)
        indices.push(base + a, base + b, topBase + b)
        indices.push(base + a, topBase + b, topBase + a)
      }
    })
  })

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
}
