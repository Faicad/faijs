/**
 * api offset2d — 2D 轮廓偏置（手写平台 op engines:['occt']）
 *
 * @platform occt — 实现直调 occt 原生 `offsetWire2D`（occt-wasm 有，L1 契约
 * `brep/engine/primitives.ts` 无对应成员——brepkit 侧只有裸 wasm 的
 * `offsetWire2DWithJoin`，未接进 adapter）⇒ 平台 op：defineOp 声明
 * `engines: ['occt']`（D11）。
 *
 * 与 `offset`（3D 全表面偏置）的分工（方案 §4.5 去重表）：
 * - `offset`   = **3D 实体**的面偏置（`BRepOffsetAPI_MakeThickSolid`），产实体；
 * - `offset2d` = **2D 轮廓**（平面 wire）的法向偏置（`BRepOffsetAPI_MakeOffset`），
 *   产**1D 轮廓**（OpenSCAD `offset()` 链路的几何前置）。
 *
 * 产物形态（同 sectionByPlane / helix）：1D 轮廓经 `fromBrepCurve` 登记为
 * `kind:'curve'`（wire/edge 三角载荷为空，显示走 L1 `wireframe`）。
 */

import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import { solidToShape } from '../brep/brep-ops'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrepCurve } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { getOcctKernel } from '../occt-kernel/occtKernel'
import { toProfileWireView } from './internal/profile-wire'

/** 拐角连接方式（映射 occt `JoinType`：Arc=0 / Tangent=1 / Intersection=2）。 */
export type Offset2DJoinType = 'arc' | 'tangent' | 'intersection'

/** `cad.offset2d` 参数。 */
export interface Offset2DOptions {
  /**
   * 拐角连接方式：`'arc'`（默认，圆弧插值）| `'tangent'`（切向延伸）|
   * `'intersection'`（求交延伸）。
   */
  joinType?: Offset2DJoinType
}

/** JoinType 字符串 → occt 枚举值。 */
const JOIN_TYPE_CODE: Record<Offset2DJoinType, number> = {
  arc: 0,
  tangent: 1,
  intersection: 2,
}

/** BREP 路径：occt offsetWire2D → 1D 轮廓经 fromBrepCurve 登记。 */
function offset2dBrep(profile: Shape, delta: number, options?: Offset2DOptions): Shape {
  if (!profile) {
    throw new Error('E_OFFSET2D_NO_PROFILE: offset2d requires a profile (wire or face) shape')
  }
  if (typeof delta !== 'number' || !Number.isFinite(delta)) {
    throw new Error('E_OFFSET2D_BAD_DELTA: delta must be a finite number')
  }
  const joinType = options?.joinType ?? 'arc'
  const joinCode = JOIN_TYPE_CODE[joinType]
  if (joinCode === undefined) {
    throw new Error(
      `E_OFFSET2D_BAD_JOIN: joinType must be 'arc' | 'tangent' | 'intersection' (got '${String(joinType)}')`,
    )
  }
  const kernel = getBrepApi()
  // 轮廓：wire 直用；面取外环（与 sweep/loft 共用唯一步径）。
  const wire = toProfileWireView(profile)
  try {
    const handle = getOcctKernel().offsetWire2D(
      wire.wrapped as never,
      delta,
      joinCode as never,
    ) as unknown as BrepHandle
    return fromBrepCurve(solidToShape(kernel, handle), { solid: handle })
  } finally {
    // 面→外环产出的 wire 是 arena 新句柄；曲线借用不 release。
    if (!wire.borrowed) {
      try { kernel.release(wire.wrapped) } catch { /* 已释放 */ }
    }
  }
}

/**
 * 2D 轮廓偏置：把平面轮廓（wire 或面）沿其法向等距偏移，产出新的 1D 轮廓。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name offset2d
 * @note 平台 op：仅 occt 引擎（原生 offsetWire2D，L1 契约无对应成员）。非 occt
 *       引擎执行前报错；brep_mock 不拦截。`delta` 可正可负（正 = 外扩，
 *       负 = 内缩，方向随 contour 走向）；轮廓接受 wire 或面（面取其外环）。
 * @returns Shape 1D 偏置轮廓（kind:'curve'）。
 * @param profile - 轮廓几何（wire；面取其外环）。type:Shape required:true
 * @param delta - 偏置距离（mm）。type:number required:true
 * @param options - 偏置配置（joinType）。type:Offset2DOptions required:false
 * @example
 * const c = cad.wire([[0,0,0],[10,0,0],[10,10,0],[0,10,0]], { closed: true })
 * const outer = await cad.offset2d(c, 2)
 */
export const offset2d = defineOp({
  name: 'offset2d',
  paramDims: { delta: 'length' },
  brep(profile: Shape, delta: number, options?: Offset2DOptions) {
    return offset2dBrep(profile, delta, options)
  },
  engines: ['occt'],
  naming: { kind: 'unmodeled', reason: '1D offset contour has no face role vocabulary' } as Provenance,
})
