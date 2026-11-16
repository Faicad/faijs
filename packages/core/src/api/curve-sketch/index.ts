/**
 * api curve-sketch — 曲线与草图构造族（S4，平台 op engines:['occt']）
 *
 * @platform occt — 本目录 import occt-kernel：各 op 直调 occt 原生曲线构造/精修方法
 * （`makeEdge` / `makeCircleArc` / `makeEllipseEdge` / `makeEllipseArc` /
 * `makeTangentArc` / `approximatePoints` / `interpolatePointsWithTangents` /
 * `curveDegreeElevate` / `curveKnotInsert` / `curveKnotRemove` / `curveIsPeriodic`，
 * occt-wasm 原生有）。这些原生方法**不在** L1 契约 `BrepEngineApi` 里（L1 只有
 * `makeLineEdge` / `makeArcEdge` / `interpolatePoints` 等按几何构造的子集，见
 * brep/engine/primitives.ts）⇒ 全族平台 op：defineOp 声明 `engines: ['occt']`（D11）。
 *
 * 方案落点：docs/plans/2026-10-07-occt-wasm-op-enablement-plan.md §3.4.1。
 * 与既有 op 的边界（§4.5 去重表）：`edge`（顶点对构造）≠ `makeLineEdge`（L1 点对构造，
 * 无脚本符号）≠ `wire`（多边组装）；`approximatePoints`（逼近）与 L1 `interpolatePoints`
 * （插值）是数学对偶的两条路径；`interpolateWithTangents` 是带端点切向的插值。
 *
 * 角度约定（实测钉住，见 test/api/occt-s4-curve-sketch.test.ts）：occt 原生
 * `makeCircleArc` / `makeEllipseArc` 的起止角走 `Geom_TrimmedCurve`（**弧度**，
 * 见 occt-wasm facade `Geom_TrimmedCurve(new Geom_Circle(circle), startAngle, endAngle)`）；
 * 本仓契约「角度用度」（docs/api-contract.md）⇒ 脚本面收**度**、内部换算弧度。
 *
 * 产物形态（同 offset2d / helix）：1D 曲线经 `fromBrepCurve` 登记为 `kind:'curve'`
 * （wire/edge 三角载荷为空，显示走 L1 `wireframe`）。
 *
 * `curveIsPeriodic` 返回布尔（非 Shape）⇒ 与 shape-type 族同口径：普通函数 +
 * `assertEngineFor('curveIsPeriodic', ['occt'])`（见 api/shape-type/index.ts 头注），
 * 覆盖率扫描器经 PLAN_C2_EXTRA 计入。
 */

import type { Shape } from '../../mesh/types'
import type { BrepHandle, BrepVec3 } from '../../brep/engine/types'
import { solidToShape } from '../../brep/brep-ops'
import { getBrepApi } from '../../brep/handle-bridge'
import { brepOf, fromBrepCurve } from '../../shape'
import { defineOp } from '../../sdk'
import type { Provenance } from '../../topology/naming/lineage'
import { getOcctKernel } from '../../occt-kernel/occtKernel'
import { assertEngineFor } from '../internal/l3-bridge'

type Vec3 = [number, number, number]

/** 度 → 弧度（脚本面按契约收度；occt Geom_TrimmedCurve 吃弧度）。 */
const DEG2RAD = Math.PI / 180

/** 1D 曲线产物登记：内核句柄 → kind:'curve' 的 faijs Shape。 */
function adoptCurve(handle: BrepHandle): Shape {
  return fromBrepCurve(solidToShape(getBrepApi(), handle), { solid: handle })
}

/** 元组 → {x,y,z}（同 halfSpace：occt 原生向量形参是 {x,y,z} 对象）。 */
function toVec3(v: Vec3, op: string, which: string): { x: number; y: number; z: number } {
  if (
    !Array.isArray(v) ||
    v.length !== 3 ||
    v.some((n) => typeof n !== 'number' || !Number.isFinite(n))
  ) {
    throw new Error(`E_${op.toUpperCase()}_BAD_${which.toUpperCase()}: ${which} must be [x,y,z] finite numbers`)
  }
  return { x: v[0], y: v[1], z: v[2] }
}

/** 非零向量校验（方向/切向量）。 */
function toNonZeroVec3(v: Vec3, op: string, which: string): { x: number; y: number; z: number } {
  const out = toVec3(v, op, which)
  if (out.x === 0 && out.y === 0 && out.z === 0) {
    throw new Error(`E_${op.toUpperCase()}_BAD_${which.toUpperCase()}: ${which} must be a non-zero vector`)
  }
  return out
}

/** 曲线输入 Shape → 内核句柄（无 BREP 槽报错）。判空用 undefined 比较：句柄可为 0。 */
function curveHandleOf(shape: Shape, op: string): BrepHandle {
  const h = brepOf(shape) as BrepHandle | undefined
  if (h === undefined) {
    throw new Error(`E_${op.toUpperCase()}_NO_BREP: ${op} requires a BREP handle (mesh-only shape has none)`)
  }
  return h
}

// ─────────────────────────────────────────────────────────────────────────────
// 圆弧角度基准 + 端点读取（circleArc / tangentArc 共用）
// ─────────────────────────────────────────────────────────────────────────────

/** 三元组点积。 */
function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/** 三元组叉积。 */
function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** 归一化；零长度返回 undefined（调用方已有非零校验，故实际不会发生）。 */
function unit3(v: Vec3): Vec3 | undefined {
  const len = Math.hypot(v[0], v[1], v[2])
  if (!(len > 0)) return undefined
  return [v[0] / len, v[1] / len, v[2] / len]
}

/** BrepVec3 → 三元组。 */
function asTriple(p: BrepVec3): Vec3 {
  return [p.x, p.y, p.z]
}

/** BrepVec3 → `{x,y,z}`（L1 形参形态）。 */
function asBrep(p: Vec3): BrepVec3 {
  return { x: p[0], y: p[1], z: p[2] }
}

/** 两点距离。 */
function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/** 边按**参数先后顺序**的两个端点（引擎中立：`curveParameters` + `curvePointAtParam`）。 */
function curveEndsOf(handle: BrepHandle): [Vec3, Vec3] {
  const api = getBrepApi()
  const params = api.curveParameters(handle)
  return [asTriple(api.curvePointAtParam(handle, params.first)), asTriple(api.curvePointAtParam(handle, params.last))]
}

/**
 * 圆面角度基准（全仓唯一）：`u` = 世界 +X 在圆面内的投影（法向与 +X 近乎平行时退 +Y），
 * `v = n̂ × u`。入参 `n` 必须是**单位**法向。
 *
 * 这不是新发明的约定 —— 它就是 smlib `circlePlacementMatrix` 已经在用的那套
 * （`smlibKernel.ts:135`，注释写明"局部 X = 世界 +X 投影"）。把它抬到 L1 当**唯一契约**，
 * 是因为 occt 的零点由 `gp_Circ` 自己的放置决定、不透明且随法向变：2026-11-16 实测
 * `circleArc([0,0,10],[0,1,0],10,0,90)` 在 occt 上从 (0,0,0) 走到 (10,0,10)、在 smlib 上
 * 从 (10,0,10) 走到 (0,0,0) —— 同一条弧、方向相反。后果不是"看着别扭"：在弧后再接一条
 * 切向直段，拼出来的 wire 边不首尾相接，smlib 会**静默**扫出空体（P0l 实测 V=0 而
 * `getLength` 仍报 17.808），错误最后以 `fuse`／体积对账的名义出现在别处。
 */
function circleFrame(n: Vec3): { u: Vec3; v: Vec3 } {
  const ref: Vec3 = Math.abs(n[0]) < 0.999 ? [1, 0, 0] : [0, 1, 0]
  const d = dot3(ref, n)
  const proj: Vec3 = [ref[0] - n[0] * d, ref[1] - n[1] * d, ref[2] - n[2] * d]
  const u = unit3(proj) ?? [1, 0, 0]
  return { u, v: cross3(n, u) }
}

/** 圆面内的解析点：`center + radius·(cosθ·u + sinθ·v)`（θ 弧度）。 */
function framePoint(center: Vec3, frame: { u: Vec3; v: Vec3 }, radius: number, theta: number): Vec3 {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  return [
    center[0] + radius * (c * frame.u[0] + s * frame.v[0]),
    center[1] + radius * (c * frame.u[1] + s * frame.v[1]),
    center[2] + radius * (c * frame.u[2] + s * frame.v[2]),
  ]
}

/** 绕单位轴 `axis` 旋转 `ang` 弧度（Rodrigues 公式）。 */
function rotateAbout3(v: Vec3, axis: Vec3, ang: number): Vec3 {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  const k = dot3(axis, v) * (1 - c)
  const cr = cross3(axis, v)
  return [
    v[0] * c + cr[0] * s + axis[0] * k,
    v[1] * c + cr[1] * s + axis[1] * k,
    v[2] * c + cr[2] * s + axis[2] * k,
  ]
}

/**
 * 中性圆弧构造（`circleArc` 的唯一路径）：返回边的**参数起点 = 角度 a0 在 `circleFrame`
 * 上的解析点**、参数终点 = a1 的解析点，与引擎无关。
 *
 * 做法是「先建 → 量 → 纠」，不猜引擎的内部约定：
 *  ① 按入参建一条，读 `curvePointAtParam(first/last)`；
 *  ② 两端都对得上 ⇒ 直接返回（smlib 走这条，零额外开销）；
 *  ③ 对不上 ⇒ 用实测两端反推该引擎的角度映射 `θ(α) = δ + σ·α`（σ=+1 纯旋转、
 *     σ=−1 反向/反射约定都覆盖），再按 δ、σ 反解入参重建一次；
 *  ④ 仍对不上 ⇒ `E_CIRCLEARC_DATUM`（宁可失败，也不静默交付一条方向不明的边）。
 *
 * 闭合圆（|跨度| = 360°）不纠：几何只有一种解释，接缝位置随引擎（见 `circleArc` 文档）。
 * 跨度超过一整圈直接拒（`E_CIRCLEARC_SPAN`）—— 一条裁剪圆边表达不了多圈。
 */
function neutralCircleArc(
  center: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
  radius: number,
  a0: number,
  a1: number,
): BrepHandle {
  const api = getBrepApi()
  const c: Vec3 = [center.x, center.y, center.z]
  const n: Vec3 = unit3([normal.x, normal.y, normal.z]) ?? [0, 0, 1]
  const frame = circleFrame(n)
  const span = a1 - a0
  if (Math.abs(span) > 2 * Math.PI + 1e-9) {
    throw new Error(
      'E_CIRCLEARC_SPAN: circleArc span must stay within 360° — a trimmed circle edge cannot ' +
      'represent more than one turn (use cad.helix for a coil, or concatenate arcs)',
    )
  }
  const p0 = framePoint(c, frame, radius, a0)
  const p1 = framePoint(c, frame, radius, a1)
  const tol = Math.max(1e-9, 1e-7 * radius)
  const build = (x: number, y: number) =>
    api.makeCircleArc(center as never, normal as never, radius, x, y) as unknown as BrepHandle
  const matches = (h: BrepHandle): boolean => {
    const [f, l] = curveEndsOf(h)
    return dist3(f, p0) <= tol && dist3(l, p1) <= tol
  }

  const trial = build(a0, a1)
  if (Math.abs(Math.abs(span) - 2 * Math.PI) <= 1e-9) return trial
  if (matches(trial)) return trial

  const thetaOf = (p: Vec3): number => {
    const rel: Vec3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]
    return Math.atan2(dot3(rel, frame.v), dot3(rel, frame.u))
  }
  const [f, l] = curveEndsOf(trial)
  const raw = thetaOf(l) - thetaOf(f)
  const branches = [raw, raw + 2 * Math.PI, raw - 2 * Math.PI]
  const traversed = branches.reduce((best, x) => (Math.abs(x - span) < Math.abs(best - span) ? x : best), raw)
  const sigma = Math.sign(traversed) === Math.sign(span) ? 1 : -1
  const delta = thetaOf(f) - sigma * a0
  const rebuilt = build(sigma * (a0 - delta), sigma * (a1 - delta))
  if (matches(rebuilt)) {
    api.release(trial)
    return rebuilt
  }

  api.release(rebuilt)
  throw new Error(
    'E_CIRCLEARC_DATUM: this engine\'s circle-angle datum could not be normalised ' +
    `(requested ${a0}..${a1} rad; measured offset δ=${delta} sign σ=${sigma} after one correction)`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// edge — 顶点对构造边（occt 原生 makeEdge；顶点可来自 vertex Shape 或 [x,y,z]）
// ─────────────────────────────────────────────────────────────────────────────

/** 顶点入参 → 位置点：`[x,y,z]` 直接用；vertex Shape 取 `vertexPosition`（不物化顶点）。 */
function vertexPointOf(v: Shape | Vec3, op: string, which: string): { x: number; y: number; z: number } {
  if (Array.isArray(v)) return toVec3(v, op, which)
  const h = curveHandleOf(v, op)
  const p = getBrepApi().vertexPosition(h)
  return { x: p.x, y: p.y, z: p.z }
}

/** BREP 路径：顶点对 → L1 `makeLineEdge`（引擎中立，不再要求内核有 makeEdge(v,v)）。 */
function edgeBrep(v1: Shape | Vec3, v2: Shape | Vec3): Shape {
  if (v1 === undefined || v2 === undefined) {
    throw new Error('E_EDGE_MISSING_VERTEX: edge requires two vertices (vertex Shape or [x,y,z])')
  }
  const p1 = vertexPointOf(v1, 'edge', 'vertex1')
  const p2 = vertexPointOf(v2, 'edge', 'vertex2')
  const handle = getBrepApi().makeLineEdge(p1 as never, p2 as never) as unknown as BrepHandle
  return adoptCurve(handle)
}

/**
 * 两顶点构造边。顶点入参可以是 vertex Shape，也可以是 `[x,y,z]` 点。
 * @group 创建
 * @inputs 2
 * @async false
 * @qual ok
 * @name edge
 * @note 中立 op：L1 `makeLineEdge`（顶点 Shape 经 `vertexPosition` 取值，不物化顶点 ——
 *       smlib 没有 `makeVertex`）。occt 上等价于旧的 `makeEdge(v,v)`，几何一致。
 * @returns Shape 1D 直线边（kind:'curve'）。
 * @param v1 - 第一个顶点（vertex Shape 或 [x,y,z]）。type:Shape|Vec3 required:true
 * @param v2 - 第二个顶点（vertex Shape 或 [x,y,z]）。type:Shape|Vec3 required:true
 * @example
 * const e = cad.edge([0,0,0], [10,0,0])
 */
export const edge = defineOp({
  name: 'edge',
  brep(v1: Shape | Vec3, v2: Shape | Vec3) {
    return edgeBrep(v1, v2)
  },
  engines: ['occt', 'smlib'],
  naming: { kind: 'unmodeled', reason: '1D edge has no face role vocabulary' } as Provenance,

  paramDims: {},
})

// ─────────────────────────────────────────────────────────────────────────────
// circleArc — 圆心+法向+半径+起止角（度）构造圆弧
// ─────────────────────────────────────────────────────────────────────────────

/** BREP 路径：中立圆弧（`neutralCircleArc`：角度基准归一 + 端点顺序归一）。 */
function circleArcBrep(
  center: Vec3,
  normal: Vec3,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): Shape {
  if (typeof radius !== 'number' || !(radius > 0)) {
    throw new Error('E_CIRCLEARC_BAD_RADIUS: radius must be a positive number')
  }
  if (
    typeof startAngleDeg !== 'number' || !Number.isFinite(startAngleDeg) ||
    typeof endAngleDeg !== 'number' || !Number.isFinite(endAngleDeg)
  ) {
    throw new Error('E_CIRCLEARC_BAD_ANGLE: startAngle/endAngle must be finite numbers (degrees)')
  }
  const c = toVec3(center, 'circleArc', 'center')
  const n = toNonZeroVec3(normal, 'circleArc', 'normal')
  const handle = neutralCircleArc(c, n, radius, startAngleDeg * DEG2RAD, endAngleDeg * DEG2RAD)
  return adoptCurve(handle)
}

/**
 * 构造圆弧：圆心 + 法向 + 半径 + 起止角（度，绕法向右手逆时针）。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name circleArc
 * @note 中立 op：角度基准由本 op 定死（世界 +X 在圆面内的投影为 0°，绕法向逆时针为正），
 *       **参数起点恒为 startAngle 对应的点**，两个引擎给出同一条弧、同一方向。闭合边
 *       （跨度 360°）的接缝位置随引擎、几何无差别。跨度超过 360° 报 `E_CIRCLEARC_SPAN`。
 *       角度单位是**度**（内部换算弧度传给引擎）。
 * @returns Shape 1D 圆弧（kind:'curve'）。
 * @param center - 圆心 [x,y,z]。type:Vec3 required:true
 * @param normal - 圆面法向 [x,y,z]（非零）。type:Vec3 required:true
 * @param radius - 半径（mm，>0）。type:number required:true
 * @param startAngle - 起始角（度，自法向基准 X 方向起量）。type:number required:true
 * @param endAngle - 终止角（度）。type:number required:true
 * @example
 * const a = cad.circleArc([0,0,0], [0,0,1], 5, 0, 90)
 */
export const circleArc = defineOp({
  name: 'circleArc',
  paramDims: { center: 'length', normal: 'length', radius: 'length', startAngle: 'angle', endAngle: 'angle' },
  brep(center: Vec3, normal: Vec3, radius: number, startAngleDeg: number, endAngleDeg: number) {
    return circleArcBrep(center, normal, radius, startAngleDeg, endAngleDeg)
  },
  engines: ['occt', 'smlib'],
  naming: { kind: 'unmodeled', reason: '1D arc has no face role vocabulary' } as Provenance,
})

// ─────────────────────────────────────────────────────────────────────────────
// ellipseEdge / ellipseArc — 椭圆整边 / 椭圆弧
// ─────────────────────────────────────────────────────────────────────────────

/** 椭圆公共参数校验：两半径均正，且 major > minor（gp_Elips 约束）。 */
function checkEllipseRadii(op: string, majorRadius: number, minorRadius: number): void {
  if (typeof majorRadius !== 'number' || !(majorRadius > 0)) {
    throw new Error(`E_${op.toUpperCase()}_BAD_MAJOR: majorRadius must be a positive number`)
  }
  if (typeof minorRadius !== 'number' || !(minorRadius > 0)) {
    throw new Error(`E_${op.toUpperCase()}_BAD_MINOR: minorRadius must be a positive number`)
  }
  if (minorRadius > majorRadius) {
    throw new Error(`E_${op.toUpperCase()}_BAD_RADII: minorRadius must be <= majorRadius (gp_Elips constraint)`)
  }
}

/** BREP 路径：中立 `makeEllipseEdge`（occt 解析椭圆 / smlib 精确有理二次，见契约面 JSDoc）。 */
function ellipseEdgeBrep(center: Vec3, normal: Vec3, majorRadius: number, minorRadius: number): Shape {
  checkEllipseRadii('ELLIPSEEDGE', majorRadius, minorRadius)
  const c = toVec3(center, 'ellipseEdge', 'center')
  const n = toNonZeroVec3(normal, 'ellipseEdge', 'normal')
  const handle = getBrepApi().makeEllipseEdge(
    c as never, n as never, majorRadius, minorRadius,
  ) as unknown as BrepHandle
  return adoptCurve(handle)
}

/**
 * 构造整椭圆边：中心 + 法向 + 长半轴 + 短半轴。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name ellipseEdge
 * @note 中立 op（occt + smlib）。语义如实、不抹平：occt 走原生解析椭圆 ⇒ `curveType` 报
 * `ellipse`（解析面、弧长积分精确）；smlib 走**精确有理二次 NURBS** ⇒ `curveType` 报
 * `bspline`、侧面是 NURBS 面，点几何与解析椭圆同值（残差 ~1e-16）、长度积分相对 ~1e-6。
 * 跨引擎对拍**比采样几何，不比类型标签**。要求 majorRadius >= minorRadius。
 * @returns Shape 1D 椭圆边（kind:'curve'）。
 * @param center - 椭圆中心 [x,y,z]。type:Vec3 required:true
 * @param normal - 椭圆面法向 [x,y,z]（非零）。type:Vec3 required:true
 * @param majorRadius - 长半轴（mm，>0）。type:number required:true
 * @param minorRadius - 短半轴（mm，>0 且 <= 长半轴）。type:number required:true
 * @example
 * const e = cad.ellipseEdge([0,0,0], [0,0,1], 10, 5)
 */
export const ellipseEdge = defineOp({
  name: 'ellipseEdge',
  paramDims: { center: 'length', normal: 'length', majorRadius: 'length', minorRadius: 'length' },
  brep(center: Vec3, normal: Vec3, majorRadius: number, minorRadius: number) {
    return ellipseEdgeBrep(center, normal, majorRadius, minorRadius)
  },
  engines: ['occt', 'smlib'],
  naming: { kind: 'unmodeled', reason: '1D ellipse has no face role vocabulary' } as Provenance,
})

/** BREP 路径：中立 `makeEllipseArc`（弧度契约在 L1；脚本面收度）。 */
function ellipseArcBrep(
  center: Vec3,
  normal: Vec3,
  majorRadius: number,
  minorRadius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): Shape {
  checkEllipseRadii('ELLIPSEARC', majorRadius, minorRadius)
  if (
    typeof startAngleDeg !== 'number' || !Number.isFinite(startAngleDeg) ||
    typeof endAngleDeg !== 'number' || !Number.isFinite(endAngleDeg)
  ) {
    throw new Error('E_ELLIPSEARC_BAD_ANGLE: startAngle/endAngle must be finite numbers (degrees)')
  }
  const span = (endAngleDeg - startAngleDeg) * DEG2RAD
  if (Math.abs(span) > 2 * Math.PI + 1e-9) {
    throw new Error('E_ELLIPSEARC_SPAN: |endAngle - startAngle| must be <= 360 degrees')
  }
  // 跨度 = 0 没有可交付的 1D 几何（两面都退化成同一个点），显式拒绝而不是丢给内核报方言错。
  if (!(Math.abs(span) > 1e-12)) {
    throw new Error('E_ELLIPSEARC_ZERO_SPAN: startAngle and endAngle must differ')
  }
  const c = toVec3(center, 'ellipseArc', 'center')
  const n = toNonZeroVec3(normal, 'ellipseArc', 'normal')
  const handle = getBrepApi().makeEllipseArc(
    c as never, n as never, majorRadius, minorRadius,
    startAngleDeg * DEG2RAD, endAngleDeg * DEG2RAD,
  ) as unknown as BrepHandle
  return adoptCurve(handle)
}

/**
 * 构造椭圆弧：中心 + 法向 + 长短半轴 + 起止角（度）。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name ellipseArc
 * @note 中立 op（occt + smlib）。角度单位是**度**（L1 契约收弧度，op 边界换算）。语义如实：
 * occt 走原生解析椭圆（`curveType` = `ellipse`，参数域 = [起角, 止角]，经内核轴基旋转对齐后
 * 端点落在契约帧的起止角点）；smlib 走精确有理二次 NURBS（`curveType` = `bspline`、
 * 参数域 = [0, nSeg]、nSeg = ceil(|跨度|/90°)）。负跨度 = 顺时针（CW）—— 走向按
 * `shapeOrientation` 读：occt 上是 REVERSED 边，smlib 上是真实反向参数化。跨度必须
 * 0 < |end − start| <= 360（度），否则 E_ELLIPSEARC_ZERO_SPAN / E_ELLIPSEARC_SPAN。
 * @returns Shape 1D 椭圆弧（kind:'curve'）。
 * @param center - 椭圆中心 [x,y,z]。type:Vec3 required:true
 * @param normal - 椭圆面法向 [x,y,z]（非零）。type:Vec3 required:true
 * @param majorRadius - 长半轴（mm，>0）。type:number required:true
 * @param minorRadius - 短半轴（mm，>0 且 <= 长半轴）。type:number required:true
 * @param startAngle - 起始角（度）。type:number required:true
 * @param endAngle - 终止角（度）。type:number required:true
 * @example
 * const a = cad.ellipseArc([0,0,0], [0,0,1], 10, 5, 0, 90)
 */
export const ellipseArc = defineOp({
  name: 'ellipseArc',
  paramDims: { center: 'length', normal: 'length', majorRadius: 'length', minorRadius: 'length', startAngle: 'angle', endAngle: 'angle' },
  brep(center: Vec3, normal: Vec3, majorRadius: number, minorRadius: number, startAngleDeg: number, endAngleDeg: number) {
    return ellipseArcBrep(center, normal, majorRadius, minorRadius, startAngleDeg, endAngleDeg)
  },
  engines: ['occt', 'smlib'],
  naming: { kind: 'unmodeled', reason: '1D ellipse arc has no face role vocabulary' } as Provenance,
})

// ─────────────────────────────────────────────────────────────────────────────
// tangentArc — 起点+切向+终点构造圆弧
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 起点 + 起点切向 + 终点 → 三点弧中点。几何是唯一的：圆心必在过起点、垂直切向的那条
 * 直线上，又要到两端等距 ⇒ 圆心 = start + x·ĥ，`x = |d|²/(2·d⊥)`（d⊥ = 弦在 ĥ 上的分量）。
 * 反向时（切向与弦的夹角让弧走长边）由 `phi ∈ (0, 2π)` 自动覆盖，不需要分支。
 */
function tangentArcMidPoint(start: Vec3, tangent: Vec3, end: Vec3): Vec3 {
  const d: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]]
  const chord = Math.hypot(d[0], d[1], d[2])
  if (!(chord > 1e-9)) {
    throw new Error('E_TANGENTARC_DEGENERATE: start and end coincide — an arc through one point is undefined')
  }
  const t = unit3(tangent)
  if (!t) throw new Error('E_TANGENTARC_BAD_TANGENT: tangent must be a non-zero vector')
  const along = dot3(d, t)
  const perp: Vec3 = [d[0] - along * t[0], d[1] - along * t[1], d[2] - along * t[2]]
  const perpLen = Math.hypot(perp[0], perp[1], perp[2])
  if (!(perpLen > 1e-9 * chord)) {
    throw new Error(
      'E_TANGENTARC_COLLINEAR: tangent is parallel to the chord ⇒ the arc degenerates to a straight ' +
      'line (infinite radius); use cad.edge(start, end) instead',
    )
  }
  const h = unit3(perp)!
  const x = (chord * chord) / (2 * perpLen)
  const center: Vec3 = [start[0] + x * h[0], start[1] + x * h[1], start[2] + x * h[2]]
  const rVec: Vec3 = [start[0] - center[0], start[1] - center[1], start[2] - center[2]]
  const eVec: Vec3 = [end[0] - center[0], end[1] - center[1], end[2] - center[2]]
  // 旋转轴取「径向 × 切向」⇒ 沿轴正转时起点切向恰好等于入参切向（与 occt 同解）。
  const axis = unit3(cross3(rVec, t))!
  const rLen = Math.hypot(rVec[0], rVec[1], rVec[2])
  const cosA = dot3(rVec, eVec) / (rLen * rLen)
  const sinA = dot3(cross3(rVec, eVec), axis) / (rLen * rLen)
  let phi = Math.atan2(sinA, cosA)
  if (phi <= 0) phi += 2 * Math.PI
  const midR = rotateAbout3(rVec, axis, phi / 2)
  return [center[0] + midR[0], center[1] + midR[1], center[2] + midR[2]]
}

/** BREP 路径：中立几何解圆心 → L1 `makeArcEdge`（三点弧，两个引擎都吃）。 */
function tangentArcBrep(start: Vec3, tangent: Vec3, end: Vec3): Shape {
  const s = toVec3(start, 'tangentArc', 'start')
  const t = toNonZeroVec3(tangent, 'tangentArc', 'tangent')
  const e = toVec3(end, 'tangentArc', 'end')
  const sT: Vec3 = [s.x, s.y, s.z]
  const eT: Vec3 = [e.x, e.y, e.z]
  const mid = tangentArcMidPoint(sT, [t.x, t.y, t.z], eT)
  const api = getBrepApi()
  const tol = Math.max(1e-9, 1e-7 * Math.max(dist3(sT, eT), 1))
  let handle = api.makeArcEdge(asBrep(sT), asBrep(mid), asBrep(eT)) as unknown as BrepHandle
  if (dist3(curveEndsOf(handle)[0], sT) <= tol) return adoptCurve(handle)
  // 反向参数化约定的引擎：同一条弧反着请求一次即可（弧的几何只有一种）
  api.release(handle)
  handle = api.makeArcEdge(asBrep(eT), asBrep(mid), asBrep(sT)) as unknown as BrepHandle
  if (dist3(curveEndsOf(handle)[0], sT) <= tol) return adoptCurve(handle)
  api.release(handle)
  throw new Error(
    'E_TANGENTARC_ORIENTATION: makeArcEdge did not produce an edge starting at `start` in either direction',
  )
}

/**
 * 构造圆弧：过起点、以给定切向出发、终于终点（GC_MakeArcOfCircle 语义）。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name tangentArc
 * @note 中立 op：圆心由本 op 自己解（切向定方向、等距定位置），再走 L1 `makeArcEdge`
 *       （三点弧）⇒ occt / smlib 都能用，几何与 occt 原生 `GC_MakeArcOfCircle` 同解。
 *       切向为零向量非法；切向与弦共线（弧退化成直线）报 `E_TANGENTARC_COLLINEAR`。
 * @returns Shape 1D 圆弧（kind:'curve'）。
 * @param start - 起点 [x,y,z]。type:Vec3 required:true
 * @param tangent - 起点切向 [x,y,z]（非零，不必单位化）。type:Vec3 required:true
 * @param end - 终点 [x,y,z]。type:Vec3 required:true
 * @example
 * const a = cad.tangentArc([0,0,0], [1,0,0], [5,5,0])
 */
export const tangentArc = defineOp({
  name: 'tangentArc',
  paramDims: { start: 'length', tangent: 'length', end: 'length' },
  brep(start: Vec3, tangent: Vec3, end: Vec3) {
    return tangentArcBrep(start, tangent, end)
  },
  engines: ['occt', 'smlib'],
  naming: { kind: 'unmodeled', reason: '1D arc has no face role vocabulary' } as Provenance,
})

// ─────────────────────────────────────────────────────────────────────────────
// approximatePoints — 点集逼近（与 L1 interpolatePoints 的插值成对）
// ─────────────────────────────────────────────────────────────────────────────

/** 点集校验（≥2 点）。 */
function checkPoints(op: string, points: Vec3[]): void {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error(`E_${op.toUpperCase()}_BAD_POINTS: ${op} requires at least 2 points`)
  }
  for (const p of points) toVec3(p, op, 'point')
}

/** 点集 [x,y,z][] → occt {x,y,z}[]（occt-wasm Vec3 是对象接口，非数组）。 */
function toVec3Array(op: string, points: Vec3[]): { x: number; y: number; z: number }[] {
  return points.map((p) => toVec3(p, op, 'point'))
}

/** BREP 路径：occt 原生 approximatePoints（逼近曲线；tolerance 缺省 = 原生 1e-3）。 */
function approximatePointsBrep(points: Vec3[], tolerance?: number): Shape {
  checkPoints('APPROXIMATEPOINTS', points)
  if (tolerance !== undefined && (typeof tolerance !== 'number' || !(tolerance > 0))) {
    throw new Error('E_APPROXIMATEPOINTS_BAD_TOLERANCE: tolerance must be a positive number')
  }
  const pts = toVec3Array('approximatePoints', points)
  const handle = (
    tolerance === undefined
      ? getOcctKernel().approximatePoints(pts as never)
      : getOcctKernel().approximatePoints(pts as never, tolerance)
  ) as unknown as BrepHandle
  return adoptCurve(handle)
}

/**
 * 点集**逼近**曲线：过点但不严格插值（逼近容差内贴合，产平滑 B 样条）。
 * 与 `interpolatePoints`（严格插值）成对的数学对偶路径。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name approximatePoints
 * @note 平台 op：仅 occt 引擎（原生 approximatePoints，tolerance 缺省 1e-3）。
 * @returns Shape 1D 逼近曲线（kind:'curve'）。
 * @param points - 点集 [x,y,z][]（≥2 点）。type:Vec3[] required:true
 * @param tolerance - 逼近容差（mm，默认 1e-3）。type:number required:false
 * @example
 * const c = cad.approximatePoints([[0,0,0],[5,3,0],[10,0,0]])
 */
export const approximatePoints = defineOp({
  name: 'approximatePoints',
  paramDims: { points: 'length', tolerance: 'length' },
  brep(points: Vec3[], tolerance?: number) {
    return approximatePointsBrep(points, tolerance)
  },
  engines: ['occt'],
  naming: { kind: 'unmodeled', reason: '1D approximated curve has no face role vocabulary' } as Provenance,
})

// ─────────────────────────────────────────────────────────────────────────────
// interpolateWithTangents — 带端点切向的插值
// ─────────────────────────────────────────────────────────────────────────────

/** BREP 路径：occt 原生 interpolatePointsWithTangents。 */
function interpolateWithTangentsBrep(points: Vec3[], startTangent: Vec3, endTangent: Vec3): Shape {
  checkPoints('INTERPOLATEWITHTANGENTS', points)
  const st = toNonZeroVec3(startTangent, 'interpolateWithTangents', 'startTangent')
  const et = toNonZeroVec3(endTangent, 'interpolateWithTangents', 'endTangent')
  const pts = toVec3Array('interpolateWithTangents', points)
  const handle = getOcctKernel().interpolatePointsWithTangents(
    pts as never, st as never, et as never,
  ) as unknown as BrepHandle
  return adoptCurve(handle)
}

/**
 * 点集**插值**曲线，带端点切向约束（三次 B 样条，过全部点且端点切向指定）。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name interpolateWithTangents
 * @note 平台 op：仅 occt 引擎（原生 interpolatePointsWithTangents）。两端切向非零。
 * @returns Shape 1D 插值曲线（kind:'curve'）。
 * @param points - 点集 [x,y,z][]（≥2 点）。type:Vec3[] required:true
 * @param startTangent - 起点切向 [x,y,z]（非零）。type:Vec3 required:true
 * @param endTangent - 终点切向 [x,y,z]（非零）。type:Vec3 required:true
 * @example
 * const c = cad.interpolateWithTangents([[0,0,0],[5,3,0],[10,0,0]], [1,0,0], [1,0,0])
 */
export const interpolateWithTangents = defineOp({
  name: 'interpolateWithTangents',
  paramDims: { points: 'length', startTangent: 'length', endTangent: 'length' },
  brep(points: Vec3[], startTangent: Vec3, endTangent: Vec3) {
    return interpolateWithTangentsBrep(points, startTangent, endTangent)
  },
  engines: ['occt'],
  naming: { kind: 'unmodeled', reason: '1D interpolated curve has no face role vocabulary' } as Provenance,
})

// ─────────────────────────────────────────────────────────────────────────────
// NURBS 精修族 — curveDegreeElevate / curveKnotInsert / curveKnotRemove
// ─────────────────────────────────────────────────────────────────────────────

/** BREP 路径：occt 原生 curveDegreeElevate（NURBS 升阶）。 */
function curveDegreeElevateBrep(curve: Shape, elevateBy: number): Shape {
  if (!Number.isInteger(elevateBy) || elevateBy <= 0) {
    throw new Error('E_CURVEDEGREEELEVATE_BAD_STEP: elevateBy must be a positive integer')
  }
  const h = curveHandleOf(curve, 'curveDegreeElevate')
  const handle = getOcctKernel().curveDegreeElevate(h as never, elevateBy) as unknown as BrepHandle
  return adoptCurve(handle)
}

/**
 * NURBS 曲线升阶：把边/曲线的阶数提升 `elevateBy`（几何不变，表示空间变大）。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name curveDegreeElevate
 * @note 平台 op：仅 occt 引擎（原生 curveDegreeElevate）。输入边/曲线。
 * @returns Shape 升阶后的 1D 曲线（kind:'curve'）。
 * @param curve - 输入边/曲线。type:Shape required:true
 * @param elevateBy - 升阶量（正整数）。type:number required:true
 * @example
 * const up = cad.curveDegreeElevate(e, 2)
 */
export const curveDegreeElevate = defineOp({
  name: 'curveDegreeElevate',
  brep(curve: Shape, elevateBy: number) {
    return curveDegreeElevateBrep(curve, elevateBy)
  },
  engines: ['occt'],
  naming: { kind: 'unmodeled', reason: '1D refined curve has no face role vocabulary' } as Provenance,

  paramDims: { elevateBy: 'plain' },
})

/** BREP 路径：occt 原生 curveKnotInsert（插节点 times 次）。 */
function curveKnotInsertBrep(curve: Shape, knot: number, times: number): Shape {
  if (typeof knot !== 'number' || !Number.isFinite(knot)) {
    throw new Error('E_CURVEKNOTINSERT_BAD_KNOT: knot must be a finite number (curve parameter)')
  }
  if (!Number.isInteger(times) || times <= 0) {
    throw new Error('E_CURVEKNOTINSERT_BAD_TIMES: times must be a positive integer')
  }
  const h = curveHandleOf(curve, 'curveKnotInsert')
  const handle = getOcctKernel().curveKnotInsert(h as never, knot, times) as unknown as BrepHandle
  return adoptCurve(handle)
}

/**
 * NURBS 曲线插节点：在曲线参数 `knot` 处插入节点 `times` 次（几何不变）。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name curveKnotInsert
 * @note 平台 op：仅 occt 引擎（原生 curveKnotInsert）。knot 是曲线参数（不是长度）。
 * @returns Shape 插节点后的 1D 曲线（kind:'curve'）。
 * @param curve - 输入边/曲线。type:Shape required:true
 * @param knot - 目标节点参数。type:number required:true
 * @param times - 重复次数（正整数）。type:number required:true
 * @example
 * const refined = cad.curveKnotInsert(e, 0.5, 1)
 */
export const curveKnotInsert = defineOp({
  name: 'curveKnotInsert',
  brep(curve: Shape, knot: number, times: number) {
    return curveKnotInsertBrep(curve, knot, times)
  },
  engines: ['occt'],
  naming: { kind: 'unmodeled', reason: '1D refined curve has no face role vocabulary' } as Provenance,

  paramDims: { knot: 'plain', times: 'plain' },
})

/** BREP 路径：occt 原生 curveKnotRemove（容差内去节点）。 */
function curveKnotRemoveBrep(curve: Shape, knot: number, tolerance: number): Shape {
  if (typeof knot !== 'number' || !Number.isFinite(knot)) {
    throw new Error('E_CURVEKNOTREMOVE_BAD_KNOT: knot must be a finite number (curve parameter)')
  }
  if (typeof tolerance !== 'number' || !(tolerance > 0)) {
    throw new Error('E_CURVEKNOTREMOVE_BAD_TOLERANCE: tolerance must be a positive number')
  }
  const h = curveHandleOf(curve, 'curveKnotRemove')
  const handle = getOcctKernel().curveKnotRemove(h as never, knot, tolerance) as unknown as BrepHandle
  return adoptCurve(handle)
}

/**
 * NURBS 曲线去节点：在容差内移除参数 `knot` 处的节点（几何漂移不超过 tolerance）。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name curveKnotRemove
 * @note 平台 op：仅 occt 引擎（原生 curveKnotRemove）。knot 是曲线参数（不是长度）。
 * @returns Shape 去节点后的 1D 曲线（kind:'curve'）。
 * @param curve - 输入边/曲线。type:Shape required:true
 * @param knot - 目标节点参数。type:number required:true
 * @param tolerance - 允许的几何漂移（mm，>0）。type:number required:true
 * @example
 * const lean = cad.curveKnotRemove(e, 0.5, 1e-4)
 */
export const curveKnotRemove = defineOp({
  name: 'curveKnotRemove',
  paramDims: { knot: 'plain', tolerance: 'length' },
  brep(curve: Shape, knot: number, tolerance: number) {
    return curveKnotRemoveBrep(curve, knot, tolerance)
  },
  engines: ['occt'],
  naming: { kind: 'unmodeled', reason: '1D refined curve has no face role vocabulary' } as Provenance,
})

// ─────────────────────────────────────────────────────────────────────────────
// curveIsPeriodic — 周期性查询（返回布尔 ⇒ 普通函数形态，同 shape-type 族口径）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 曲线是否周期（契约只有 `curveIsClosed`，周期性是 occt 原生独有查询）。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name curveIsPeriodic
 * @note 平台 op：仅 occt 引擎（原生 curveIsPeriodic，L1 无对应成员）。非 occt 引擎
 *       执行前报 E_BREP_UNSUPPORTED。
 * @returns boolean 是否为周期曲线。
 * @param curve - 被查询的边/曲线。type:Shape required:true
 * @example
 * const c = cad.circleArc([0,0,0], [0,0,1], 5, 0, 360)
 * const periodic = cad.curveIsPeriodic(c)
 */
export function curveIsPeriodic(curve: Shape): boolean {
  assertEngineFor('curveIsPeriodic', ['occt'])
  const h = curveHandleOf(curve, 'curveIsPeriodic')
  const kernel = getOcctKernel() as unknown as { curveIsPeriodic(h: unknown): boolean }
  return kernel.curveIsPeriodic(h)
}
