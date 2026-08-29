/**
 * stdlib extrude — 拉伸库函数
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape, Vec3 } from '../mesh/types'
import { cad } from '../mesh'
import { extrudeBrep, solidToShape } from '../brep/brep-ops'
import { getBackends } from '../runtime-state'
import { solid, fromBrep, brepOf } from './shape'
import { dispatchPath } from '../cad-runtime/backend-dispatch'
import { assertPositiveNumber } from './assert'

/** BREP 实现标记（extrude 有 OCCT 精确拉伸） */
const brepImpl = true

// ── per-op 参数自校验（Phase 2.2；stdlib 被直接 import 时的防御层） ──

/** extrude: length 必填 > 0。 */
export function assertExtrudeParams(params: Record<string, unknown>): void {
  assertPositiveNumber(params.length, 'extrude.length')
}

/** BREP 路径：OCCT extrude + 三角化 + fromBrep 登记。 */
function extrudeBrepPath(input: Shape, params: Record<string, unknown>): Shape {
  const kernel = getBackends().kernel.occt as import('occt-wasm').OcctKernel | null
  if (!kernel) throw new Error('[stdlib/extrude] no OCCT kernel')
  const inputSolid = brepOf(input) as import('occt-wasm').ShapeHandle | undefined
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

export async function extrude(input: Shape, params: Record<string, unknown>): Promise<Shape> {
  if (!input) throw new Error('[stdlib/extrude] no input geometry')
  assertExtrudeParams(params)
  const path = dispatchPath([input], brepImpl)
  if (path === 'brep') return extrudeBrepPath(input, params)
  return solid(await cad.extrude(input, {
    normal: (params.normal as Vec3 | undefined) ?? [0, 0, 1],
    originOffset: (params.originOffset as number | undefined) ?? 0,
    length: params.length as number,
    mode: params.mode as 'centered' | 'forward' | 'backward' | undefined,
  }))
}
