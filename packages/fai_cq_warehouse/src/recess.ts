/**
 * recess.ts — W5 螺钉沉孔切割器（方案 §5.4 W5 交付物）。
 *
 * ≈ 上游 `fastener.py:226-347` 的五种沉孔 plan + `default_head_recess`
 * （fastener.py:1576）的 plan/depth/taper 三元组，以及 `make_head`
 * （fastener.py:1513）里的切割器构造：
 *
 *     cutter = extrudeLinear(plan, (0,0,-depth), taper).translate((0,0,topZ))
 *     head_blank = plan Extrude(topZ) − cutter
 *     head = revolved_profile ∩ head_blank
 *
 * B 侧等价替换（探针 §W5-probe11/12 实证，体积解析对齐）：
 * draftPrism 只能沿 +dz 收缩远端，与上游「从顶面向下收」的切割器方向相反——
 * 先向上拔模拉伸（远端收缩）、再关于 XY 面镜像、平移到头顶，三步合成。
 *
 * ⚠️ W5 已知缺口（红线：未验证的路径必须显式抛错，禁止静默近似）：
 * taper=30° 的截面随深度收缩，臂宽（PH: m/12，R: m/2）在深度
 * h* = (m/12)/tan30° ≈ 0.76·m/12… 内归零，之后 A 侧 LocOpe_DPrism 靠
 * 「截面自交后续生锥面」继续成型（实测 PH2 切割器 z 底 −2.349、含 4 锥面），
 * 本内核 draftPrism 在自交前即抛错（探针 §W5-probe50：深 0.8 即失败）。
 * → cross（PH*）沉孔一律抛 `E_RECESS_TAPER_UNSUPPORTED`；Robertson（R*）
 *   上游 taper=0、不受影响，正常实现。受影响的类用 T/slot 类型过验收
 *   （见 gen-reference.py SCREW_CASES 注释）。
 *
 * ## 本文件的两节（互不依赖）
 *
 * 1. **W5 沉孔模块**（本节以上）：`fastener.py:226-347` 的五种 plan +
 *    `default_head_recess` + `make_head` 的切割器构造，服务 `src/screw.ts` 的 12 类。
 * 2. **W4 临时孔径切割器**（文件末节，`Temp` 前缀）：`extensions._fastenerHole`
 *    的最小等价路径，只服务 `src/nut.ts` 的 `bradTeeNut`；替换目标是 W9·P1-b 的
 *    `src/holes.ts`。两节之间**禁止互相引用**。
 */

import type { BrepHandle, BrepVec3 } from '@faicad/faijs-core'
import { requireKernel } from './kernel'
import {
  arcEdge,
  draftPrismFace,
  filletCorner2D,
  lineEdge,
  mirrorAbout,
  polygonWire,
  radiusArcMidpoint,
  rotateAbout,
  wireFromEdges,
} from './primitives'
import { iso10664Def, type ParamRow } from './params'

/** 本包内部统一经 WarehouseKernel 取用。 */
function k(): ReturnType<typeof requireKernel> {
  return requireKernel()
}

const Z_AXIS = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }

/** 沉孔三元组：plan wire（XY 面、z=0）+ 深度 + 锥角（度）。 */
export interface RecessSpec {
  planWire: BrepHandle
  depth: number
  taperDeg: number
}

/** cross（PH）/ Robertson（R）尺寸表——`fastener.py:232/336` 逐字。 */
const CROSS_WIDTHS: Record<string, number> = { PH0: 1.9, PH1: 3.1, PH2: 5.3, PH3: 6.8, PH4: 10.0 }
/** cross（PH）槽深表（按 PH 规格索引）——`fastener.py:232` 逐字。 */
const CROSS_DEPTHS: Record<string, number> = { PH0: 1.1, PH1: 2.0, PH2: 3.27, PH3: 3.53, PH4: 5.88 }
/** Robertson（R）槽宽表（按 R 规格索引）——`fastener.py:336` 逐字。 */
const SQUARE_WIDTHS: Record<string, number> = { R00: 1.8, R0: 2.31, R1: 2.86, R2: 3.38, R3: 4.85 }
/** Robertson（R）槽深表（按 R 规格索引）——`fastener.py:336` 逐字。 */
const SQUARE_DEPTHS: Record<string, number> = { R00: 1.85, R0: 2.87, R1: 3.56, R2: 4.19, R3: 5.11 }

/**
 * 2D 点 → 世界坐标（XY 平面，z=0）。
 */
function v(p: { x: number; y: number }): BrepVec3 {
  return { x: p.x, y: p.y, z: 0 }
}

/**
 * cross / Type H 沉孔 plan（`fastener.py:226 cross_recess`）。
 * 12 边十字；4 个内角（±w/12, ±w/12）用 `fillet2D(m/3)` 圆化。
 * A 侧实证（probe31/37/41）：圆化后面积 11.262240262 逐位一致。
 * @param size - PH0…PH4。
 * @returns plan wire。
 */
export function crossRecessPlanWire(size: string): BrepHandle {
  const m = CROSS_WIDTHS[size]
  if (m === undefined) throw new Error(`cross_recess: invalid cross size ${size}`)
  const w = m / 12
  const r = m / 3
  // 上游象限：moveTo(m/2,0)→vLineTo(m/12)→hLineTo(m/12)→vLineTo(m/2)→hLineTo(0)
  // 经 mirrorX/mirrorY 展开后，臂尖上的镜像缝点（(±m/2,0)/(0,±m/2)）是共线冗余
  // 顶点——几何等价的 12 角环（probe41 面积 11.262240262 与 A 侧逐位一致）。
  const orig: Array<{ x: number; y: number }> = [
    { x: m / 2, y: w },
    { x: w, y: w },
    { x: w, y: m / 2 },
    { x: -w, y: m / 2 },
    { x: -w, y: w },
    { x: -m / 2, y: w },
    { x: -m / 2, y: -w },
    { x: -w, y: -w },
    { x: -w, y: -m / 2 },
    { x: w, y: -m / 2 },
    { x: w, y: -w },
    { x: m / 2, y: -w },
  ]
  // (±w,±w) 四个内角：索引 1、4、7、10。
  const filletIdx = new Set([1, 4, 7, 10])
  const p1of = new Map<number, { x: number; y: number }>()
  const p2of = new Map<number, { x: number; y: number }>()
  const midof = new Map<number, { x: number; y: number }>()
  for (const i of filletIdx) {
    const cur = orig[i]!
    const prev = orig[(i + 11) % 12]!
    const next = orig[(i + 1) % 12]!
    const f = filletCorner2D(prev, cur, next, r)
    p1of.set(i, f.p1)
    p2of.set(i, f.p2)
    midof.set(i, f.mid)
  }
  const edges: BrepHandle[] = []
  for (let i = 0; i < 12; i++) {
    const cur = orig[i]!
    const next = orig[(i + 1) % 12]!
    if (filletIdx.has(i)) {
      // 圆角顶点：P1→(arc)→P2，再接 P2→next 连线（探针 probe38 16 边闭合形态）。
      edges.push(arcEdge(v(p1of.get(i)!), v(midof.get(i)!), v(p2of.get(i)!)))
      edges.push(lineEdge(v(p2of.get(i)!), v(next)))
    } else {
      const target = filletIdx.has((i + 1) % 12) ? p1of.get((i + 1) % 12)! : next
      edges.push(lineEdge(v(cur), v(target)))
    }
  }
  return wireFromEdges(edges)
}

/**
 * 六角沉孔 plan（`fastener.py:257 hex_recess`）：`polygon(6, polygon_diagonal(s))`。
 * @param widthAcrossFlats - 对边距 s。
 * @returns plan wire。
 */
export function hexRecessPlanWire(widthAcrossFlats: number): BrepHandle {
  // polygon_diagonal(s, 6) = s/cos(π/6)（nut.ts polygonDiagonal 同式）。
  const e = widthAcrossFlats / Math.cos(Math.PI / 6)
  const pts: BrepVec3[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i
    pts.push({ x: (e / 2) * Math.cos(a), y: (e / 2) * Math.sin(a), z: 0 })
  }
  return polygonWire(pts)
}

/**
 * hexalobular（Torx® T）沉孔 plan（`fastener.py:265 hexalobular_recess`）。
 * 六分之一轮廓 = 外弧(Re)→内弧(−Ri)→外弧(Re) 三段 radiusArc，再绕 Z 每 −60°
 * 复制 6 份（clockwise，与上游 `range(0,-360,-60)` 一致）。
 * A 侧实证（probe27/28）：T30 plan 面积 17.521497 与 A 侧一致。
 * @param size - T6…T100。
 * @returns plan wire。
 */
export function hexalobularRecessPlanWire(size: string): BrepHandle {
  const row: ParamRow | undefined = iso10664Def[size]
  if (!row) throw new Error(`hexalobular_recess: invalid hexalobular size ${size}`)
  const A = Number(row['A'])
  const B = Number(row['B'])
  const Re = Number(row['Re'])
  const sqrt3 = Math.sqrt(3)
  // Ri = (A²−√3·A·B−4·A·Re+B²+2√3·B·Re) / (2(√3·A−2·B−2√3·Re+4·Re))
  const Ri =
    (A * A - sqrt3 * A * B - 4 * A * Re + B * B + 2 * sqrt3 * B * Re) /
    (2 * (sqrt3 * A - 2 * B - 2 * sqrt3 * Re + 4 * Re))

  const centerExternal0 = { x: 0, y: A / 2 - Re }
  const centerExternal1 = { x: (sqrt3 * (A / 2 - Re)) / 2, y: A / 4 - Re / 2 }
  const centerInternal = { x: B / 4 + Ri / 2, y: (sqrt3 * (B / 2 + Ri)) / 2 }
  // 切点 = 外弧圆心 + 单位向量(内弧圆心−外弧圆心) × Re
  const tangentPoints = [centerExternal0, centerExternal1].map((c) => {
    const dx = centerInternal.x - c.x
    const dy = centerInternal.y - c.y
    const l = Math.hypot(dx, dy)
    return { x: c.x + (dx / l) * Re, y: c.y + (dy / l) * Re }
  })

  // 六分之一：moveTo(0, A/2) → radiusArc(tp0, Re) → radiusArc(tp1, −Ri)
  //           → radiusArc((√3A/4, A/4), Re)
  const start = { x: 0, y: A / 2 }
  const end = { x: (sqrt3 * A) / 4, y: A / 4 }
  const m1 = radiusArcMidpoint(start, tangentPoints[0]!, Re)
  const m2 = radiusArcMidpoint(tangentPoints[0]!, tangentPoints[1]!, -Ri)
  const m3 = radiusArcMidpoint(tangentPoints[1]!, end, Re)
  const oneSixth = [
    arcEdge(v(start), v(m1), v(tangentPoints[0]!)),
    arcEdge(v(tangentPoints[0]!), v(m2), v(tangentPoints[1]!)),
    arcEdge(v(tangentPoints[1]!), v(m3), v(end)),
  ]
  const edges: BrepHandle[] = []
  for (let a = 0; a > -360; a -= 60) {
    const rad = (a * Math.PI) / 180
    for (const e of oneSixth) edges.push(rotateAbout(e, Z_AXIS, rad))
  }
  return wireFromEdges(edges)
}

/**
 * 开槽沉孔 plan（`fastener.py:323 slot_recess`）：`rect(width, length)`
 * （cq rect 以原点为中心）。length 方向必须超出头顶面——上游由
 * `make_head` 用 3×maxR 的默认 plan 包容（slot 的 length 参数是 n，宽度 dk）。
 * 等等——上游 slot_recess(dk, n)：**宽度 dk、长度 n**，而 n < dk；
 * `make_head` 注释说明 slot 横贯整个头、必须伸出顶面，故矩形以原点为中心、
 * 长边 = dk 落在 X、短边 = n 落在 Y。
 * @param width - X 向边长（= dk，横贯头径）。
 * @param length - Y 向边长（= 槽宽 n）。
 * @returns plan wire。
 */
export function slotRecessPlanWire(width: number, length: number): BrepHandle {
  const hw = width / 2
  const hl = length / 2
  return wireFromEdges([
    lineEdge(v({ x: -hw, y: -hl }), v({ x: hw, y: -hl })),
    lineEdge(v({ x: hw, y: -hl }), v({ x: hw, y: hl })),
    lineEdge(v({ x: hw, y: hl }), v({ x: -hw, y: hl })),
    lineEdge(v({ x: -hw, y: hl }), v({ x: -hw, y: -hl })),
  ])
}

/**
 * Robertson 方沉孔 plan（`fastener.py:328 square_recess`）：`rect(m, m)`。
 * @param size - R00…R3。
 * @returns plan wire。
 */
export function squareRecessPlanWire(size: string): BrepHandle {
  const m = SQUARE_WIDTHS[size]
  if (m === undefined) throw new Error(`square_recess: invalid square size ${size}`)
  return slotRecessPlanWire(m, m)
}

/**
 * `fastener.py:1576 default_head_recess`：按 screw_data 列名依序探测
 * slot(dk,n,t) → hex(s,t) → recess 列（PH/T/R），返回三元组。
 * 与上游一致：多个 try 块**后面的命中会覆盖前面的**（fastener.py 逐 try 赋值）。
 * @param row - 该规格的参数行（已 isolate 到具体 fastener_type）。
 * @returns 沉孔三元组。
 * @throws PH（cross，taper=30°）→ `E_RECESS_TAPER_UNSUPPORTED`（W5 已知缺口）；
 *         无任何沉孔列 → 上游同文报错。
 */
export function defaultHeadRecess(row: ParamRow): RecessSpec {
  let spec: RecessSpec | null = null
  // Slot Recess：dk, n, t → slot_recess(dk, n)，taper=0
  if (row['dk'] !== undefined && row['n'] !== undefined && row['t'] !== undefined) {
    spec = {
      planWire: slotRecessPlanWire(Number(row['dk']), Number(row['n'])),
      depth: Number(row['t']),
      taperDeg: 0,
    }
  }
  // Hex Recess：s, t → hex_recess(s)，taper=0
  if (row['s'] !== undefined && row['t'] !== undefined) {
    spec = {
      planWire: hexRecessPlanWire(Number(row['s'])),
      depth: Number(row['t']),
      taperDeg: 0,
    }
  }
  // Philips / Torx / Robertson：recess 列
  const recess = row['recess']
  if (recess !== undefined && recess !== '') {
    const r = String(recess).toUpperCase()
    if (r.startsWith('PH')) {
      // W5 已知缺口：cross 沉孔 30° 锥度在臂宽退化后 A 侧靠 DPrism 续锥面，
      // 本内核 draftPrism 自交即抛错（见文件头）。
      throw new Error(
        `E_RECESS_TAPER_UNSUPPORTED: cross recess ${r} needs a 30° taper cutter whose ` +
          `section self-intersects (LocOpe_DPrism tolerates, our draftPrism does not) — ` +
          `choose a T/slot/hex fastener_type instead`,
      )
    }
    if (r.startsWith('T')) {
      spec = {
        planWire: hexalobularRecessPlanWire(r),
        depth: 0.6 * Number(iso10664Def[r]!['A']),
        taperDeg: 0,
      }
    } else if (r.startsWith('R')) {
      spec = {
        planWire: squareRecessPlanWire(r),
        depth: SQUARE_DEPTHS[r]!,
        taperDeg: 0,
      }
    }
  }
  if (!spec) throw new Error(`Recess data missing from screw_data ${JSON.stringify(row)}`)
  return spec
}

/**
 * 沉孔切割器（`make_head` fastener.py:1548-1552 的 B 侧等价）：
 * draftPrism 向上（远端收缩）→ 关于 XY 镜像 → 平移到头顶 z=topZ。
 * 结果占 z ∈ [topZ−depth, topZ]，开口（全尺寸截面）朝上。
 * @param spec - 沉孔三元组。
 * @param topZ - 头顶面高度（max_head_height）。
 * @returns 切割器实体。
 */
export function recessCutter(spec: RecessSpec, topZ: number): BrepHandle {
  const face = k().makeFace(spec.planWire)
  const up = spec.taperDeg === 0 ? k().extrude(face, 0, 0, spec.depth) : draftPrismFace(face, spec.depth, spec.taperDeg)
  const flipped = mirrorAbout(up, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
  return k().translate(flipped, 0, 0, topZ)
}

/** SQUARE_DEPTHS 仅 square_recess 用；导出供测试对表。 */
export { SQUARE_DEPTHS, CROSS_DEPTHS }

// ── W4：`extensions._fastenerHole` 的最小等价路径（BradTeeNut 用）────────────
//
// W9·P1-b 已落地：孔切割器迁入 `src/holes.ts`（`fastenerHoleCutter`），本文件
// 仅保留 `tempCounterSunkCountersinkProfile`（沉头轮廓，BradTeeNut 仍在用）。
// 原 `TempClearanceHoleCutterParams` / `tempClearanceHoleCutter` 已随迁移删除。

/** 钻尖角（度）—— 上游 `_fastenerHole` 的 `cskAngle = 82`（extensions.py:975）。 */
export { DRILL_TIP_ANGLE } from './holes'

/** 沉头轮廓（XZ 平面 `{r,z}` 点列，闭合，`r` 为到轴距离）。 */
export interface TempProfilePoint {
  r: number
  z: number
}

/**
 * `CounterSunkScrew.countersink_profile`（fastener.py:1786-1798）的临时等价实现 —— 90° 截锥。
 *
 * 上游逐字转写：`vLineTo(k)` → `hLineTo(dk/2)` → `polarLine(k/cos(a/2), -90-a/2)` → `close()`。
 *
 * ⚠️ 注意上游此方法**不读 `fit`**（与 `Screw.default_countersink_profile` 不同）：
 * 轮廓只由 `a`（头角）/`dk`（头径）/`k`（头高）决定。参数里的 `fit` 仅为签名对齐。
 *
 * ⚠️ 与 `src/screw.ts` 的 `CounterSunkScrew` 沉孔轮廓**同式**：该重复是 W4 明示的
 * 临时债（见本文件头与 W5 分析文档），随 `_fastenerHole` 整体迁入 `src/holes.ts` 时一并消除。
 * @param screwData - `countersunk_head_parameters.csv` 中该规格行的求值结果（含 a/dk/k）。
 * @param _fit - 配合等级（上游此路径未使用）。
 * @returns 截锥轮廓点列：`(0,0) → (0,k) → (dk/2,k) → (dk/2−k·tan(a/2), 0)`。
 */
export function tempCounterSunkCountersinkProfile(
  screwData: Record<string, number | string>,
  _fit: 'Close' | 'Normal' | 'Loose' = 'Normal',
): TempProfilePoint[] {
  const a = screwData['a']
  const dk = screwData['dk']
  const k = screwData['k']
  if (typeof a !== 'number' || typeof dk !== 'number' || typeof k !== 'number')
    throw new Error(
      `recess(Temp): countersunk screw data must be numeric (a/dk/k), got ${JSON.stringify({ a, dk, k })}`,
    )
  const half = ((a * Math.PI) / 180) / 2
  const sideLength = k / Math.cos(half)
  const dir = ((-90 - a / 2) * Math.PI) / 180
  const endR = dk / 2 + sideLength * Math.cos(dir)
  const endZ = k + sideLength * Math.sin(dir)
  return [
    { r: 0, z: 0 },
    { r: 0, z: k },
    { r: dk / 2, z: k },
    { r: endR, z: endZ },
  ]
}
