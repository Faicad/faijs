/**
 * stdlib extrude — 拉伸库函数
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape, Vec3 } from '@faicad/faijs-core/mesh/types'
import { cad } from '@faicad/faijs-core/mesh'
import { extrudeBrep, solidToShape } from '@faicad/faijs-core/brep/brep-ops'
import { getBackends } from '@faicad/faijs-core/runtime-state'
import { fromBrep, brepOf } from '@faicad/faijs-core/shape'
import { defineOp } from '@faicad/faijs-core/sdk'
import { assertPositiveNumber } from './assert'
import type { BrepHandle } from '@faicad/faijs-core/brep/engine/types'
import type { BrepEngineApi } from '@faicad/faijs-core/brep/engine/primitives'

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
 * @name extrude
 * @returns Shape 拉伸后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param params.length - 总拉伸量（mm）。type:number required:true
 * @param params.mode - 拉伸方向：centered 双向各一半 / forward 正向 / backward 反向。type:'centered' | 'forward' | 'backward' 默认 'centered'
 * @param params.normal - 拉伸方向法向。type:[x,y,z] 默认 当前面法向 [0,0,1]
 * @param params.originOffset - 切面在法向上的偏移。type:number 默认 0
 * @param params.space - 坐标空间声明。type:'local' | 'world'
 * @example
 * const p = await cad.extrude(part0, { length: 10 })
 * const p = await cad.extrude(part0, { length: 10, mode: 'forward' })
 * const p = await cad.extrude(part0, { length: 10, normal: [0,0,1], originOffset: 2 })
  */
export const extrude = defineOp({
  mesh: async (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[stdlib/extrude] no input geometry')
    assertExtrudeParams(params)
    return cad.extrude(input, {
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
