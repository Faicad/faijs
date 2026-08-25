/**
 * stdlib extrude — 拉伸库函数
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 *
 * 从 src/ops/extrude.ts 迁出并改写为 stdlib 形态：
 * `(input, params, exec) => Promise<Shape>`，resolvePath 静态判定 brep/mesh。
 */

import type { Shape, Vec3 } from '../mesh/types'
import { cad } from '../mesh'
import { extrudeBrep, solidToShape } from '../brep/brep-ops'
import { solid } from './shape'
import { resolvePath } from './internal/resolve-path'
import type { ExecContext } from '../cad-runtime/exec-context'

/** BREP 实现标记（extrude 有 OCCT 精确拉伸） */
const brepImpl = true

/** BREP 路径：OCCT extrude + 三角化 + 身份槽挂 solid。 */
function extrudeBrepPath(input: Shape, params: Record<string, unknown>, exec: ExecContext): Shape {
  const kernel = exec.kernels.occt
  if (!kernel) throw new Error('[stdlib/extrude] no OCCT kernel')
  const inputSolid = exec.getSolid(input)
  if (!inputSolid) throw new Error('[stdlib/extrude] input is not BREP')

  const normal = (params.normal as Vec3 | undefined) ?? [0, 0, 1]
  const originOffset = (params.originOffset as number | undefined) ?? 0
  const resultSolid = extrudeBrep(kernel, inputSolid, {
    normal,
    originOffset,
    length: params.length as number,
    mode: params.mode as 'centered' | 'forward' | 'backward' | undefined,
  })

  const shape = solid(solidToShape(kernel, resultSolid))
  exec.setSolid(shape, resultSolid)
  return shape
}

export async function extrude(input: Shape, params: Record<string, unknown>, exec: ExecContext): Promise<Shape> {
  if (!input) throw new Error('[stdlib/extrude] no input geometry')
  const path = resolvePath(exec, [input], brepImpl)
  if (path === 'brep') return extrudeBrepPath(input, params, exec)
  return solid(await cad.extrude(input, {
    normal: (params.normal as Vec3 | undefined) ?? [0, 0, 1],
    originOffset: (params.originOffset as number | undefined) ?? 0,
    length: params.length as number,
    mode: params.mode as 'centered' | 'forward' | 'backward' | undefined,
  }))
}
