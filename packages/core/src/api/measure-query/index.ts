/**
 * api measure-query — 测量与查询族（S4 剩余，平台 op engines:['occt']）
 *
 * @platform occt — 13 个原生方法直调 occt-wasm（occt-wasm 5.6.0 有，见
 * `dist/index.d.ts` 的 `OcctKernel`）：
 *   containsPoint / distanceBetween / getInertia / getLinearCenterOfMass /
 *   projectPointOnEdge / projectPointOnFace / classifyPointOnFace / uvFromPoint /
 *   vertexPosition / subShapeCount / iterShapes / liftCurve2dToPlane / intersectionCells
 * 它们**不在** L1 契约 `BrepEngineApi` 里（L1 只有 getCenterOfMass / getVolume /
 * getSurfaceArea / getBoundingBox 等子集，见 brep/engine/primitives.ts）⇒ 全族平台 op。
 *
 * 方案落点：docs/plans/2026-10-07-occt-wasm-op-enablement-plan.md §3.4.6。
 *
 * **形态二分**（沿用 shape-type / view-export / curve-sketch 的既定口径）：
 * - 返回 Shape 的两项（`liftCurve2d` / `commonCells`）走 `defineOp` + `engines:['occt']`，
 *   由 dispatchPath 门控（D11-4，brep_mock 豁免走 D11-3）；
 * - 其余返回标量 / Vec3 / 对象 / Shape[] 的 11 项走**普通函数** +
 *   `assertEngineFor('<name>', ['occt'])`：defineOp 的 brep 包装
 *   （define-op.ts#wrapBrepOne）把返回值一律收养为 Shape，装不下这些形态。普通函数
 *   形态的 op 由覆盖率扫描器 `scan-occt-op-coverage.ts` 的 PLAN_C2_EXTRA 计入 C2。
 *
 * **GOTCHA（上游载体差异，务必读）**：occt-wasm 的 `Vec3` 是 **`{x, y, z}` 对象接口**
 * （dist/types.d.ts:52-56），而 faijs 脚本面的 `Vec3` 是 **`[x, y, z]` 数组**
 * （mesh/types，见 api/geom.ts 里 `normal = [n.x, n.y, n.z]` 的同款转接）。因此本文件
 * 在**边界处做双向转换**，不外泄载体差异：入参 `[x,y,z]` → `{x,y,z}`，返回值
 * `{x,y,z}` → `[x,y,z]`。漏掉这层转换时症状是原生方法读到 `undefined` 坐标
 * （`{}.x` 静默取不到 → 落在原点）而非显式报错，故每条都配了返回值数组的测试。
 *
 * `iterShapes` 返回的子形状既有实体/面也有边/wire ⇒ 按 `getShapeType` 判定收养形态
 * （vertex/edge/wire → `fromBrepCurve`，其余 → `fromBrep`），避免把 1D 产物谎报成实体。
 *
 * §9.5 降级路径（记录在案）：一旦 brepkit 把这些测量/查询接进 L1 契约且两侧适配器
 * 同时落地，普通函数删掉 assertEngineFor 改走 getBrepApi()、defineOp 删掉 engines
 * 声明，对应方法即从 C2 转入 C1。
 */

import type { Shape, Vec3 } from '../../mesh/types'
import type { BrepHandle } from '../../brep/engine/types'
import type { PointClassification } from 'occt-wasm'
import { solidToShape } from '../../brep/brep-ops'
import { getBrepApi } from '../../brep/handle-bridge'
import { brepOf, fromBrep, fromBrepCurve } from '../../shape'
import { defineOp } from '../../sdk'
import type { Provenance } from '../../topology/naming/lineage'
import { getOcctKernel } from '../../occt-kernel/occtKernel'
import { assertEngineFor } from '../internal/l3-bridge'

/** 子形状类型（与 occt 原生同名形参的字面量联合一致）。 */
export type SubShapeType = 'vertex' | 'edge' | 'wire' | 'face' | 'shell' | 'solid'

const SUB_SHAPE_TYPES: readonly SubShapeType[] = ['vertex', 'edge', 'wire', 'face', 'shell', 'solid']

/** 输入 Shape → 内核句柄（无 BREP 槽报错）。 */
function occtHandleOf(shape: Shape, op: string): BrepHandle {
  const h = brepOf(shape) as BrepHandle | undefined
  if (!h) {
    throw new Error(`E_SHAPE_TYPE_NO_BREP: ${op} requires a BREP handle (mesh-only shape has none)`)
  }
  return h
}

/** 脚本面 `[x,y,z]` → 原生 `{x,y,z}`（见头注 GOTCHA）。 */
function toNativeVec3(v: Vec3, op: string, which: string): { x: number; y: number; z: number } {
  if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    throw new Error(`E_${op.toUpperCase()}_BAD_${which.toUpperCase()}: ${which} must be a finite [x,y,z]`)
  }
  return { x: v[0], y: v[1], z: v[2] }
}

/** 原生 `{x,y,z}` → 脚本面 `[x,y,z]`（同上）。 */
function fromNativeVec3(v: { x: number; y: number; z: number }): Vec3 {
  return [v.x, v.y, v.z]
}

/** 句柄 → Shape：1D（vertex/edge/wire）登记为 kind:'curve'，其余为实体/面。 */
function adopt(handle: BrepHandle): Shape {
  const mesh = solidToShape(getBrepApi(), handle)
  const t = getOcctKernel().getShapeType(handle as never)
  if (t === 'vertex' || t === 'edge' || t === 'wire') {
    return fromBrepCurve(mesh, { solid: handle })
  }
  return fromBrep(mesh, { solid: handle })
}

// ─────────────────────────────────────────────────────────────────────────────
// 标量/数据型查询（普通函数形态 + assertEngineFor）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 点是否在实体内（含边界，带容差）。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name containsPoint
 * @note 平台 op：仅 occt 引擎（原生 containsPoint，L1 契约无对应成员）。
 *       非 occt 引擎执行前报 E_BREP_UNSUPPORTED。坐标收脚本面的 [x,y,z]。
 * @returns boolean 点是否在形状内。
 * @param shape - 被检测的形状（语义上是实体/壳）。type:Shape required:true
 * @param point - 待判定点 [x,y,z]。type:Vec3 required:true
 * @param tolerance - 判定容差（模型单位）。type:number required:false
 * @example
 * const inside = cad.containsPoint(box, [1, 1, 1])
 */
export function containsPoint(shape: Shape, point: Vec3, tolerance?: number): boolean {
  assertEngineFor('containsPoint', ['occt'])
  const p = toNativeVec3(point, 'containsPoint', 'point')
  return getOcctKernel().containsPoint(occtHandleOf(shape, 'containsPoint') as never, p, tolerance)
}

/**
 * 两形状之间的最短距离。
 * @group 查询
 * @inputs 2
 * @async false
 * @qual ok
 * @name distanceBetween
 * @note 平台 op：仅 occt 引擎（原生 distanceBetween，BRepExtrema_DistShapeShape）。
 *       非 occt 引擎执行前报 E_BREP_UNSUPPORTED。
 * @returns number 最短距离（模型单位；相交为 0）。
 * @param a - 第一个形状。type:Shape required:true
 * @param b - 第二个形状。type:Shape required:true
 * @example
 * const gap = cad.distanceBetween(box1, box2)
 */
export function distanceBetween(a: Shape, b: Shape): number {
  assertEngineFor('distanceBetween', ['occt'])
  const ha = occtHandleOf(a, 'distanceBetween')
  const hb = occtHandleOf(b, 'distanceBetween')
  return getOcctKernel().distanceBetween(ha as never, hb as never)
}

/**
 * 绕质心的惯性矩阵（row-major 3×3，长度 9；对称：[1]==[3]、[2]==[6]、[5]==[7]）。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name inertia
 * @note 平台 op：仅 occt 引擎（原生 getInertia）。非 occt 引擎执行前报
 *       E_BREP_UNSUPPORTED。
 * @returns number[] row-major 3×3 惯性矩阵。
 * @param shape - 被测量的形状。type:Shape required:true
 * @example
 * const m = cad.inertia(box)
 */
export function inertia(shape: Shape): number[] {
  assertEngineFor('inertia', ['occt'])
  return getOcctKernel().getInertia(occtHandleOf(shape, 'inertia') as never)
}

/**
 * 线性质心（按边长加权的质心；wire/edge 用它与体积质心区分）。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name linearCenterOfMass
 * @note 平台 op：仅 occt 引擎（原生 getLinearCenterOfMass）。非 occt 引擎执行前报
 *       E_BREP_UNSUPPORTED。返回脚本面的 [x,y,z]（非 occt 的 {x,y,z} 对象）。
 * @returns Vec3 线性质心坐标 [x,y,z]。
 * @param shape - 被测量的形状。type:Shape required:true
 * @example
 * const c = cad.linearCenterOfMass(wire)
 */
export function linearCenterOfMass(shape: Shape): Vec3 {
  assertEngineFor('linearCenterOfMass', ['occt'])
  return fromNativeVec3(getOcctKernel().getLinearCenterOfMass(occtHandleOf(shape, 'linearCenterOfMass') as never))
}

/**
 * 点到边的最近点（含该处切向与参数）。
 * @group 查询
 * @inputs 2
 * @async false
 * @qual ok
 * @name projectPointOnEdge
 * @note 平台 op：仅 occt 引擎（原生 projectPointOnEdge）。非 occt 引擎执行前报
 *       E_BREP_UNSUPPORTED。返回体里的 point/tangent 是脚本面的 [x,y,z]。
 * @returns object { point: Vec3; tangent: Vec3; parameter: number }。
 * @param edge - 被投影的边。type:Shape required:true
 * @param point - 待投影点 [x,y,z]。type:Vec3 required:true
 * @example
 * const hit = cad.projectPointOnEdge(e, [3, 4, 0])
 */
export function projectPointOnEdge(
  edge: Shape,
  point: Vec3,
): { point: Vec3; tangent: Vec3; parameter: number } {
  assertEngineFor('projectPointOnEdge', ['occt'])
  const p = toNativeVec3(point, 'projectPointOnEdge', 'point')
  const r = getOcctKernel().projectPointOnEdge(occtHandleOf(edge, 'projectPointOnEdge') as never, p)
  return { point: fromNativeVec3(r.point), tangent: fromNativeVec3(r.tangent), parameter: r.parameter }
}

/**
 * 点到面的最近点（三维坐标）。
 * @group 查询
 * @inputs 2
 * @async false
 * @qual ok
 * @name projectPointOnFace
 * @note 平台 op：仅 occt 引擎（原生 projectPointOnFace）。非 occt 引擎执行前报
 *       E_BREP_UNSUPPORTED。要 UV 参数用 `uvFromPoint`。
 * @returns Vec3 面上的最近点 [x,y,z]。
 * @param face - 被投影的面。type:Shape required:true
 * @param point - 待投影点 [x,y,z]。type:Vec3 required:true
 * @example
 * const p = cad.projectPointOnFace(f, [3, 4, 5])
 */
export function projectPointOnFace(face: Shape, point: Vec3): Vec3 {
  assertEngineFor('projectPointOnFace', ['occt'])
  const p = toNativeVec3(point, 'projectPointOnFace', 'point')
  return fromNativeVec3(getOcctKernel().projectPointOnFace(occtHandleOf(face, 'projectPointOnFace') as never, p))
}

/**
 * UV 点相对面边界的分类（BRepClass_FaceClassifier）。
 * @group 查询
 * @inputs 3
 * @async false
 * @qual ok
 * @name classifyPointOnFace
 * @note 平台 op：仅 occt 引擎（原生 classifyPointOnFace）。非 occt 引擎执行前报
 *       E_BREP_UNSUPPORTED。
 * @returns string 'in' | 'on' | 'out'。
 * @param face - 被判定的面。type:Shape required:true
 * @param u - U 参数。type:number required:true
 * @param v - V 参数。type:number required:true
 * @example
 * const cls = cad.classifyPointOnFace(f, 0.5, 0.5)
 */
export function classifyPointOnFace(face: Shape, u: number, v: number): PointClassification {
  assertEngineFor('classifyPointOnFace', ['occt'])
  if (typeof u !== 'number' || !Number.isFinite(u) || typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error('E_CLASSIFYPOINTONFACE_BAD_UV: u and v must be finite numbers')
  }
  return getOcctKernel().classifyPointOnFace(occtHandleOf(face, 'classifyPointOnFace') as never, u, v)
}

/**
 * 三维点 → 面的 UV 参数。
 * @group 查询
 * @inputs 2
 * @async false
 * @qual ok
 * @name uvFromPoint
 * @note 平台 op：仅 occt 引擎（原生 uvFromPoint）。非 occt 引擎执行前报
 *       E_BREP_UNSUPPORTED。
 * @returns object { u: number; v: number }。
 * @param face - 目标面。type:Shape required:true
 * @param point - 三维点 [x,y,z]。type:Vec3 required:true
 * @example
 * const { u, v } = cad.uvFromPoint(f, [1, 2, 0])
 */
export function uvFromPoint(face: Shape, point: Vec3): { u: number; v: number } {
  assertEngineFor('uvFromPoint', ['occt'])
  const p = toNativeVec3(point, 'uvFromPoint', 'point')
  return getOcctKernel().uvFromPoint(occtHandleOf(face, 'uvFromPoint') as never, p)
}

/**
 * 顶点坐标。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name vertexPosition
 * @note 平台 op：仅 occt 引擎（原生 vertexPosition）。非 occt 引擎执行前报
 *       E_BREP_UNSUPPORTED。返回脚本面的 [x,y,z]。
 * @returns Vec3 顶点坐标 [x,y,z]。
 * @param vertex - 顶点形状。type:Shape required:true
 * @example
 * const p = cad.vertexPosition(v)
 */
export function vertexPosition(vertex: Shape): Vec3 {
  assertEngineFor('vertexPosition', ['occt'])
  return fromNativeVec3(getOcctKernel().vertexPosition(occtHandleOf(vertex, 'vertexPosition') as never))
}

/**
 * 子形状计数（不物化逐个子形状句柄）。
 * @group 查询
 * @inputs 2
 * @async false
 * @qual ok
 * @name subShapeCount
 * @note 平台 op：仅 occt 引擎（原生 subShapeCount；L1 契约只有 getSubShapes，
 *       计数能力是 occt 独有）。非 occt 引擎执行前报 E_BREP_UNSUPPORTED。
 * @returns number 该类子形状的个数。
 * @param shape - 被统计的形状。type:Shape required:true
 * @param type - 子形状类型（vertex/edge/wire/face/shell/solid）。type:string required:true
 * @example
 * const n = cad.subShapeCount(box, 'face')
 */
export function subShapeCount(shape: Shape, type: SubShapeType): number {
  assertEngineFor('subShapeCount', ['occt'])
  if (!SUB_SHAPE_TYPES.includes(type)) {
    throw new Error(
      `E_SUBSHAPECOUNT_BAD_TYPE: type must be one of ${SUB_SHAPE_TYPES.join('/')} (got ${String(type)})`,
    )
  }
  return getOcctKernel().subShapeCount(occtHandleOf(shape, 'subShapeCount') as never, type)
}

/**
 * 遍历全部子形状（递归展平，返回 Shape[]）。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name iterShapes
 * @note 平台 op：仅 occt 引擎（原生 iterShapes；L1 契约的 getSubShapes 只按类型单层取）。
 *       非 occt 引擎执行前报 E_BREP_UNSUPPORTED。
 *       返回 Shape 数组（非单个 Shape）⇒ 普通函数形态，与 shape-type 同口径。
 * @returns Shape[] 子形状列表（vertex/edge/wire 形态为 curve）。
 * @param shape - 被遍历的形状。type:Shape required:true
 * @example
 * const subs = cad.iterShapes(box)
 */
export function iterShapes(shape: Shape): Shape[] {
  assertEngineFor('iterShapes', ['occt'])
  const handles = getOcctKernel().iterShapes(occtHandleOf(shape, 'iterShapes') as never)
  return (handles as unknown as BrepHandle[]).map(adopt)
}

// ─────────────────────────────────────────────────────────────────────────────
// liftCurve2d — 2D 点集 → 平面 wire（返回 Shape ⇒ defineOp）
// ─────────────────────────────────────────────────────────────────────────────

/** BREP 路径：occt 原生 liftCurve2dToPlane（脚本面收 [x,y]，此处转成 {x,y}）。 */
function liftCurve2dBrep(
  points2d: Array<[number, number]>,
  planeOrigin: Vec3,
  planeZ: Vec3,
  planeX: Vec3,
): Shape {
  if (!Array.isArray(points2d) || points2d.length < 2) {
    throw new Error('E_LIFTCURVE2D_TOO_FEW_POINTS: liftCurve2d requires at least 2 points')
  }
  const pts = points2d.map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2 || p.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
      throw new Error(`E_LIFTCURVE2D_BAD_POINT: points2d[${i}] must be a finite [x,y]`)
    }
    return { x: p[0], y: p[1] }
  })
  const o = toNativeVec3(planeOrigin, 'liftCurve2d', 'planeOrigin')
  const z = toNativeVec3(planeZ, 'liftCurve2d', 'planeZ')
  const x = toNativeVec3(planeX, 'liftCurve2d', 'planeX')
  const handle = getOcctKernel().liftCurve2dToPlane(pts, o, z, x) as unknown as BrepHandle
  return fromBrepCurve(solidToShape(getBrepApi(), handle), { solid: handle })
}

/**
 * 把 2D 点集抬升到指定平面上，构造平面 wire。
 * @group 创建
 * @inputs 4
 * @async false
 * @qual ok
 * @name liftCurve2d
 * @note 平台 op：仅 occt 引擎（原生 liftCurve2dToPlane，L1 契约无对应成员）。
 *       非 occt 引擎执行前报错；brep_mock 不拦截。
 *       坐标收 `[x,y]` 数对（脚本面习惯），内部转成上游的 `{x,y}` 对象；
 *       planeZ/planeX 须非零且互不平行。
 * @returns Shape 平面上的 wire（登记为 kind:'curve'）。
 * @param points2d - 2D 点集 [[x,y], …]（≥2 点）。type:Array required:true
 * @param planeOrigin - 平面原点 [x,y,z]。type:Vec3 required:true
 * @param planeZ - 平面法向 [x,y,z]（非零）。type:Vec3 required:true
 * @param planeX - 平面内 X 轴方向 [x,y,z]（非零）。type:Vec3 required:true
 * @example
 * const w = cad.liftCurve2d([[0,0],[10,0],[10,5]], [0,0,0], [0,0,1], [1,0,0])
 */
export const liftCurve2d = defineOp({
  name: 'liftCurve2d',
  brep(points2d: Array<[number, number]>, planeOrigin: Vec3, planeZ: Vec3, planeX: Vec3) {
    return liftCurve2dBrep(points2d, planeOrigin, planeZ, planeX)
  },
  engines: ['occt'],
  naming: {
    kind: 'unmodeled',
    reason: '1D wire lifted from 2D points has no face role vocabulary',
  } as Provenance,
})

// ─────────────────────────────────────────────────────────────────────────────
// commonCells — ≥2 输入的重叠区域（干涉/通用熔合胞元，返回 Shape ⇒ defineOp）
// ─────────────────────────────────────────────────────────────────────────────

/** BREP 路径：occt 原生 intersectionCells（≥2 输入，不足则报错）。 */
function commonCellsBrep(shapes: Shape[]): Shape {
  if (!Array.isArray(shapes) || shapes.length < 2) {
    throw new Error('E_COMMONCELLS_TOO_FEW: commonCells requires at least 2 shapes')
  }
  const handles = shapes.map((s, i) => {
    if (!s) throw new Error(`E_COMMONCELLS_MISSING_ARG: shapes[${i}] is empty`)
    return occtHandleOf(s, 'commonCells')
  })
  const handle = getOcctKernel().intersectionCells(handles as never[]) as unknown as BrepHandle
  return fromBrep(solidToShape(getBrepApi(), handle), { solid: handle })
}

/**
 * 求多个形状的重叠区域（通用熔合胞元，常用于干涉检查）。
 * @group 布尔
 * @inputs 1
 * @async false
 * @qual ok
 * @name commonCells
 * @note 平台 op：仅 occt 引擎（原生 intersectionCells；与 `intersect` 的区别：
 *       后者是两形状求交，本 op 支持 ≥2 输入并返回全部重叠胞元）。
 *       非 occt 引擎执行前报错；brep_mock 不拦截。
 * @returns Shape 重叠区域（无重叠时为空复合体）。
 * @param shapes - 输入形状数组（≥2）。type:Shape[] required:true
 * @example
 * const overlap = cad.commonCells([boxA, boxB, boxC])
 */
export const commonCells = defineOp({
  name: 'commonCells',
  brep(shapes: Shape[]) {
    return commonCellsBrep(shapes)
  },
  engines: ['occt'],
  naming: {
    // 原生 intersectionCells 只回 Shape（无 EvolutionData），
    // 无法给出新面的来源词汇 —— 方案 §4.2「词汇未定义就用 unmodeled + reason」。
    kind: 'unmodeled',
    reason: 'intersectionCells returns a bare shape with no face evolution data',
  } as Provenance,
})
