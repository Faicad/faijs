/**
 * stdlib extrude — 拉伸库函数
 *
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape, Vec3 } from '../mesh/types'
import { cad } from '../mesh'
import { extrudeBrep, solidToShape } from '../brep/brep-ops'
import { getBackends } from '../runtime-state'
import { fromBrep, brepOf } from '../shape'
import { defineOp } from '../sdk'
import { assertPositiveNumber } from './assert'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'

// ── per-op 参数自校验（Phase 2.2；stdlib 被直接 import 时的防御层） ──

/**
 * Validate extrude parameters: `length` must be a positive number.
 * @param params - the raw extrude operation parameters.
 */
export function assertExtrudeParams(params: Record<string, unknown>): void {
  assertPositiveNumber(params.length, 'extrude.length')
}

/** BREP 路径：OCCT extrude + 三角化 + fromBrep 登记。 */
function extrudeBrepPath(input: Shape, params: Record<string, unknown>): Shape {
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[stdlib/extrude] no OCCT kernel')
  const inputSolid = brepOf(input) as BrepHandle | undefined
  if (!inputSolid) throw new Error('[stdlib/extrude] input is not BREP')

  const normal = (params.normal as Vec3 | undefined) ?? [0, 0, 1]
  const originOffset = (params.originOffset as number | undefined) ?? 0
  const resultSolid = extrudeBrep(kernel, inputSolid, {
    normal,
    originOffset,
    length: params.length as number,
    mode: params.mode as 'centered' | 'forward' | 'backward' | undefined,
  })

  return fromBrep(solidToShape(kernel, resultSolid), { solid: resultSolid })
}

/**
 * 沿法向拉伸几何。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name fai_extrude
 * @deprecated `fai_` 前缀 op 是 ../3d_editor 项目特有的操作，不属于 faijs 平台面；将来会迁往该项目并从 faijs 删除。新代码请勿使用。
 * @returns Shape 拉伸后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param params.length - 总拉伸量（mm）。type:number required:true
 * @param params.mode - 拉伸方向：centered 双向各一半 / forward 正向 / backward 反向。type:'centered' | 'forward' | 'backward' 默认 'centered'
 * @param params.normal - 拉伸方向法向。type:[x,y,z] 默认 当前面法向 [0,0,1]
 * @param params.originOffset - 切面在法向上的偏移。type:number 默认 0
 * @param params.space - 坐标空间声明。type:'local' | 'world'
 * @example
 * const p = await cad.fai_extrude(part0, { length: 10 })
 * const p = await cad.fai_extrude(part0, { length: 10, mode: 'forward' })
 * const p = await cad.fai_extrude(part0, { length: 10, normal: [0,0,1], originOffset: 2 })
  */
export const fai_extrude = defineOp({
  mesh: async (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[stdlib/extrude] no input geometry')
    assertExtrudeParams(params)
    return cad.fai_extrude(input, {
      normal: (params.normal as Vec3 | undefined) ?? [0, 0, 1],
      originOffset: (params.originOffset as number | undefined) ?? 0,
      length: params.length as number,
      mode: params.mode as 'centered' | 'forward' | 'backward' | undefined,
    })
  },
  brep: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[stdlib/extrude] no input geometry')
    assertExtrudeParams(params)
    return extrudeBrepPath(input, params)
  },
})
