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
import type { BrepHandle } from '../../brep/engine/types'
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

/** 曲线输入 Shape → 内核句柄（无 BREP 槽报错）。 */
function curveHandleOf(shape: Shape, op: string): BrepHandle {
  const h = brepOf(shape) as BrepHandle | undefined
  if (!h) {
    throw new Error(`E_${op.toUpperCase()}_NO_BREP: ${op} requires a BREP handle (mesh-only shape has none)`)
  }
  return h
}

// ─────────────────────────────────────────────────────────────────────────────
// edge — 顶点对构造边（occt 原生 makeEdge；顶点可来自 vertex Shape 或 [x,y,z]）
// ─────────────────────────────────────────────────────────────────────────────

/** 顶点入参：vertex Shape 或 [x,y,z] 点（内部经契约 makeVertex 物化）。 */
function vertexHandleOf(v: Shape | Vec3, op: string): BrepHandle {
  if (Array.isArray(v)) {
    const p = toVec3(v, op, 'vertex')
    return getBrepApi().makeVertex(p.x, p.y, p.z) as unknown as BrepHandle
  }
  return curveHandleOf(v, op)
}

/** BREP 路径：顶点对 → occt 原生 makeEdge。 */
function edgeBrep(v1: Shape | Vec3, v2: Shape | Vec3): Shape {
  if (v1 === undefined || v2 === undefined) {
    throw new Error('E_EDGE_MISSING_VERTEX: edge requires two vertices (vertex Shape or [x,y,z])')
  }
  const h1 = vertexHandleOf(v1, 'edge')
  const h2 = vertexHandleOf(v2, 'edge')
  const handle = getOcctKernel().makeEdge(h1 as never, h2 as never) as unknown as BrepHandle
  return adoptCurve(handle)
}

/**
 * 两顶点构造边。顶点入参可以是 vertex Shape，也可以是 `[x,y,z]` 点
 * （点经 L1 契约 `makeVertex` 物化成顶点再配边）。
 * @group 创建
 * @inputs 2
 * @async false
 * @qual ok
 * @name edge
 * @note 平台 op：仅 occt 引擎（原生 makeEdge，L1 契约只有 makeLineEdge 等按几何构造）。
 *       非 occt 引擎执行前报错；brep_mock 不拦截。
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
  engines: ['occt'],
  naming: { kind: 'unmodeled', reason: '1D edge has no face role vocabulary' } as Provenance,
})

// ─────────────────────────────────────────────────────────────────────────────
// circleArc — 圆心+法向+半径+起止角（度）构造圆弧
// ─────────────────────────────────────────────────────────────────────────────

/** BREP 路径：occt 原生 makeCircleArc（角度内部换算弧度）。 */
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
  const handle = getOcctKernel().makeCircleArc(
    c as never, n as never, radius, startAngleDeg * DEG2RAD, endAngleDeg * DEG2RAD,
  ) as unknown as BrepHandle
  return adoptCurve(handle)
}

/**
 * 构造圆弧：圆心 + 法向 + 半径 + 起止角（度，绕法向右手逆时针）。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name circleArc
 * @note 平台 op：仅 occt 引擎（原生 makeCircleArc）。角度单位是**度**（内部换算弧度
 *       传给 occt 的 Geom_TrimmedCurve）。
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
  engines: ['occt'],
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

/** BREP 路径：occt 原生 makeEllipseEdge。 */
function ellipseEdgeBrep(center: Vec3, normal: Vec3, majorRadius: number, minorRadius: number): Shape {
  checkEllipseRadii('ELLIPSEEDGE', majorRadius, minorRadius)
  const c = toVec3(center, 'ellipseEdge', 'center')
  const n = toNonZeroVec3(normal, 'ellipseEdge', 'normal')
  const handle = getOcctKernel().makeEllipseEdge(c as never, n as never, majorRadius, minorRadius) as unknown as BrepHandle
  return adoptCurve(handle)
}

/**
 * 构造整椭圆边：中心 + 法向 + 长半轴 + 短半轴。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name ellipseEdge
 * @note 平台 op：仅 occt 引擎（原生 makeEllipseEdge）。要求 majorRadius >= minorRadius。
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
  engines: ['occt'],
  naming: { kind: 'unmodeled', reason: '1D ellipse has no face role vocabulary' } as Provenance,
})

/** BREP 路径：occt 原生 makeEllipseArc（角度内部换算弧度）。 */
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
  const c = toVec3(center, 'ellipseArc', 'center')
  const n = toNonZeroVec3(normal, 'ellipseArc', 'normal')
  const handle = getOcctKernel().makeEllipseArc(
    c as never, n as never, majorRadius, minorRadius, startAngleDeg * DEG2RAD, endAngleDeg * DEG2RAD,
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
 * @note 平台 op：仅 occt 引擎（原生 makeEllipseArc）。角度单位是**度**（内部换算弧度）。
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
  engines: ['occt'],
  naming: { kind: 'unmodeled', reason: '1D ellipse arc has no face role vocabulary' } as Provenance,
})

// ─────────────────────────────────────────────────────────────────────────────
// tangentArc — 起点+切向+终点构造圆弧
// ─────────────────────────────────────────────────────────────────────────────

/** BREP 路径：occt 原生 makeTangentArc（GC_MakeArcOfCircle(start, tangent, end)）。 */
function tangentArcBrep(start: Vec3, tangent: Vec3, end: Vec3): Shape {
  const s = toVec3(start, 'tangentArc', 'start')
  const t = toNonZeroVec3(tangent, 'tangentArc', 'tangent')
  const e = toVec3(end, 'tangentArc', 'end')
  const handle = getOcctKernel().makeTangentArc(s as never, t as never, e as never) as unknown as BrepHandle
  return adoptCurve(handle)
}

/**
 * 构造圆弧：过起点、以给定切向出发、终于终点（GC_MakeArcOfCircle 语义）。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name tangentArc
 * @note 平台 op：仅 occt 引擎（原生 makeTangentArc）。切向为零向量非法。
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
  engines: ['occt'],
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

/** BREP 路径：occt 原生 approximatePoints（逼近曲线；tolerance 缺省 = 原生 1e-3）。 */
function approximatePointsBrep(points: Vec3[], tolerance?: number): Shape {
  checkPoints('APPROXIMATEPOINTS', points)
  if (tolerance !== undefined && (typeof tolerance !== 'number' || !(tolerance > 0))) {
    throw new Error('E_APPROXIMATEPOINTS_BAD_TOLERANCE: tolerance must be a positive number')
  }
  const handle = (
    tolerance === undefined
      ? getOcctKernel().approximatePoints(points as never)
      : getOcctKernel().approximatePoints(points as never, tolerance)
  ) as unknown as BrepHandle
  return adoptCurve(handle)
}

/**
 * 点集**逼近**曲线：过点但不严格插值（逼近容差内贴合，产平滑 B 样条）。
 * 与 L1 `interpolatePoints`（严格插值）成对的数学对偶路径。
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
  const handle = getOcctKernel().interpolatePointsWithTangents(
    points as never, st as never, et as never,
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
  paramDims: { tolerance: 'length' },
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
 * 曲线是否周期（L1 契约只有 `curveIsClosed`，周期性是 occt 原生独有查询）。
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
