/**
 * stdlib splitByPlane — 平面二分：把 solid 沿无限平面切成两半（手写中立 op，Phase 6.1）
 *
 * 中立 op：L1 `splitByPlane(shape, point, normal)` 在 occt 与 brepkit 两侧均有真实现
 * （engine-method-map `dialect`；occt 适配器 `occt-primitives.ts:182` 经原生 splitter，
 * brepkit 映射其平面二分）⇒ 走 `getBrepApi()`，不声明 engines。
 *
 * 多产物口径（§2.4 ③ / 设计原则 5）：数组产物做不成 op，用具名 `outputs`
 * `['positive','negative']`（先例：occt 适配器 splitByPlane 直接返回该形态）。
 * `positive` = 法向正侧，`negative` = 法向负侧（§3.7 返回口径）。
 *
 * 仅 BREP 可用（同 shell）：mesh 输入执行前报错（backend-dispatch 静态判定）。
 */

import type { Shape } from '../mesh/types'
import type { BrepHandle, BrepVec3 } from '../brep/engine/types'
import { solidToShape } from '../brep/brep-ops'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf, fromBrep } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'

/** `cad.splitByPlane` 参数。 */
export interface SplitByPlaneParams {
  /** 平面上一点 [x, y, z]。 */
  point: [number, number, number]
  /** 平面法向 [x, y, z]（不必单位化；positive = 法向正侧）。 */
  normal: [number, number, number]
}

/** 归一化 3D 点参数（[x,y,z] 数组 → BrepVec3）。 */
function toVec3(raw: unknown, what: string): BrepVec3 {
  if (!Array.isArray(raw) || raw.length < 3 || raw.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new Error(`E_SPLIT_BY_PLANE_BAD_${what.toUpperCase()}: ${what} must be [x, y, z] finite numbers`)
  }
  return { x: raw[0] as number, y: raw[1] as number, z: raw[2] as number }
}

/** BREP 路径：L1 splitByPlane → 具名双产物收养。 */
function splitByPlaneBrep(input: Shape, params: SplitByPlaneParams): Record<string, Shape> {
  const p = params ?? ({} as SplitByPlaneParams)
  const point = toVec3(p.point, 'point')
  const normal = toVec3(p.normal, 'normal')
  const kernel = getBrepApi()
  const solid = brepOf(input) as BrepHandle | undefined
  if (!solid) throw new Error('E_SPLIT_BY_PLANE_NO_BREP: splitByPlane input is not BREP')
  const { positive, negative } = kernel.splitByPlane(solid, point, normal)
  return {
    positive: fromBrep(solidToShape(kernel, positive), { solid: positive }),
    negative: fromBrep(solidToShape(kernel, negative), { solid: negative }),
  }
}

/**
 * 平面二分：把 solid 沿「过 point、法向 normal 的无限平面」切成两半。
 * @group 切分
 * @inputs 1
 * @async true
 * @qual ok
 * @name splitByPlane
 * @note 中立 op：L1 splitByPlane 两引擎同实现。产物为具名双产物（非数组）：
 *       `{ positive, negative }`（positive = 法向正侧）。仅 BREP 可用。
 * @returns {positive: Shape, negative: Shape} 法向正侧 / 负侧两个 solid。
 * @param input - 目标几何。type:Shape required:true
 * @param params.point - 平面上一点 [x,y,z]。type:Vec3 required:true
 * @param params.normal - 平面法向 [x,y,z]。type:Vec3 required:true
 * @example
 * const { positive, negative } = await cad.splitByPlane(part0, { point: [0,0,5], normal: [0,0,1] })
 */
export const splitByPlane = defineOp({
  outputs: ['positive', 'negative'],
  brep(input: Shape, params: SplitByPlaneParams) {
    return splitByPlaneBrep(input, params)
  },
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,
})
