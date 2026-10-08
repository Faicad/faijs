/**
 * api splitByPlane — 平面二分：把 solid 沿无限平面切成两半（手写中立 op，Phase 6.1）
 *
 * 中立 op：L1 `splitByPlane(shape, point, normal)` 在 occt 与 brepkit 两侧均有
 * 真实现（occt-kernel/occt-primitives.ts / brepkit-kernel/brepkitKernel.ts）⇒
 * 走 `getBrepApi()`（D12），不声明 engines（实现只经 L1 契约面）。
 *
 * 产物形态（设计原则 5）：两半不是数组，是具名 `outputs: ['positive','negative']`
 * ——法向正侧 = positive（L1 契约 §3.7 口径，occt 适配器按质心投影分类）。
 * 先例：occt 适配器的 splitByPlane 直接返回 `{positive, negative}`。
 */

import type { Shape } from '../mesh/types'
import type { BrepHandle, BrepVec3 } from '../brep/engine/types'
import { solidToShape } from '../brep/brep-ops'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf, fromBrep } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'

type Vec3 = [number, number, number]

/** `cad.splitByPlane` 参数。 */
export interface SplitByPlaneParams {
  /** 平面上一点（mm）。 */
  point: Vec3
  /** 平面法向（不必单位化；其正侧为 `positive`）。 */
  normal: Vec3
}

/** 元组 → BrepVec3 对象（GOTCHA：L1 向量形参是 {x,y,z} 对象，元组会被读成零向量）。 */
function toVec3(v: Vec3): BrepVec3 {
  if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    throw new Error('E_SPLIT_BY_PLANE_BAD_VEC: point/normal must be [x,y,z] finite numbers')
  }
  return { x: v[0], y: v[1], z: v[2] }
}

/** BREP 路径：L1 splitByPlane → 两半各自收养。 */
function splitByPlaneBrep(input: Shape, params: SplitByPlaneParams): Record<string, Shape> {
  const { point, normal } = params ?? ({} as SplitByPlaneParams)
  const kernel = getBrepApi()
  const solid = brepOf(input) as BrepHandle | undefined
  if (!solid) throw new Error('E_SPLIT_BY_PLANE_NO_BREP: splitByPlane input is not BREP')
  const halves = kernel.splitByPlane(solid, toVec3(point), toVec3(normal))
  return {
    positive: fromBrep(solidToShape(kernel, halves.positive), { solid: halves.positive }),
    negative: fromBrep(solidToShape(kernel, halves.negative), { solid: halves.negative }),
  }
}

/**
 * 沿无限平面把实体切成两半，返回法向正/负两半（具名产物）。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name splitByPlane
 * @note 中立 op：L1 splitByPlane 两引擎同实现。产物是具名两半
 *       `{ positive, negative }`（不是数组）；法向正侧 = positive。
 * @returns 具名产物 positive/negative。
 * @param input - 目标实体。type:Shape required:true
 * @param params.point - 平面上一点 [x,y,z]（mm）。type:Vec3 required:true
 * @param params.normal - 平面法向 [x,y,z]。type:Vec3 required:true
 * @example
 * const { positive, negative } = await cad.splitByPlane(part0, { point: [0,0,5], normal: [0,0,1] })
 */
export const splitByPlane = defineOp({
  outputs: ['positive', 'negative'],
  paramDims: { 'params.point': 'length', 'params.normal': 'length' },
  brep(input: Shape, params: SplitByPlaneParams) {
    return splitByPlaneBrep(input, params)
  },
  naming: { kind: 'subdivide' } as Provenance,
})
