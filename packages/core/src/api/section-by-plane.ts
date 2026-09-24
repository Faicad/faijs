/**
 * stdlib sectionByPlane — 平面截面：solid 与无限平面的精确交线（手写中立 op，Phase 6.2）
 *
 * 中立 op：L1 `sectionByPlane(shape, point, normal)` 在 occt 与 brepkit 两侧均有
 * 真实现 ⇒ 走 `getBrepApi()`（D12），不声明 engines。
 *
 * 产物形态（设计原则 5 + §2.4①）：L1 返回交线句柄**数组**（occt 适配器把
 * compound 逐条 downcast 成 edge/wire），数组过不了单产物边界 —— 收拢为
 * **1D compound**（`makeCompound(edges)`）经 `fromBrepCurve` 登记为
 * `kind:'curve'`（Phase 3 判别位；wire/edge 载荷为空，显示走 L1 `wireframe`）。
 * 无交线（平面不与体相交）显式报错 —— 不返回假空产物（原则 9）。
 */

import type { Shape } from '../mesh/types'
import type { BrepHandle, BrepVec3 } from '../brep/engine/types'
import { solidToShape } from '../brep/brep-ops'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf, fromBrepCurve } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'

type Vec3 = [number, number, number]

/** `cad.sectionByPlane` 参数。 */
export interface SectionByPlaneParams {
  /** 平面上一点（mm）。 */
  point: Vec3
  /** 平面法向（不必单位化）。 */
  normal: Vec3
}

/** 元组 → BrepVec3 对象（同 split-by-plane：L1 向量形参是 {x,y,z} 对象）。 */
function toVec3(v: Vec3): BrepVec3 {
  if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    throw new Error('E_SECTION_BY_PLANE_BAD_VEC: point/normal must be [x,y,z] finite numbers')
  }
  return { x: v[0], y: v[1], z: v[2] }
}

/** BREP 路径：L1 sectionByPlane → 交线收拢为 1D compound → fromBrepCurve 登记。 */
function sectionByPlaneBrep(input: Shape, params: SectionByPlaneParams): Shape {
  const { point, normal } = params ?? ({} as SectionByPlaneParams)
  const kernel = getBrepApi()
  const solid = brepOf(input) as BrepHandle | undefined
  if (!solid) throw new Error('E_SECTION_BY_PLANE_NO_BREP: sectionByPlane input is not BREP')
  const curves = kernel.sectionByPlane(solid, toVec3(point), toVec3(normal))
  if (!curves || curves.length === 0) {
    throw new Error('E_SECTION_BY_PLANE_NO_INTERSECTION: plane does not intersect the shape')
  }
  const compound = kernel.makeCompound(curves)
  return fromBrepCurve(solidToShape(kernel, compound), { solid: compound })
}

/**
 * 求实体与无限平面的精确截面线（1D 曲线，可继续建模/导出 STEP）。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name sectionByPlane
 * @note 中立 op：L1 sectionByPlane 两引擎同实现。产物是 1D 曲线（kind:'curve'，
 *       全部交线收拢为一个 compound）；平面不与体相交时显式报错。
 * @returns Shape 1D 截面曲线。
 * @param input - 目标实体。type:Shape required:true
 * @param params.point - 平面上一点 [x,y,z]（mm）。type:Vec3 required:true
 * @param params.normal - 平面法向 [x,y,z]。type:Vec3 required:true
 * @example
 * const sec = await cad.sectionByPlane(part0, { point: [0,0,5], normal: [0,0,1] })
 */
export const sectionByPlane = defineOp({
  capabilities: ['directEdit'],
  brep(input: Shape, params: SectionByPlaneParams) {
    return sectionByPlaneBrep(input, params)
  },
  naming: { kind: 'unmodeled', reason: '1D section curves have no face role vocabulary' } as Provenance,
})
