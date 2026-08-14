/**
 * 拉伸操作分派器
 *
 * BREP 路径：用 OCCT extrude
 * Mesh 路径：用 manifold-3d mesh-CSG
 *
 * 静态分派：链活跃时必走 BREP 路径（开发期写死），异常冒泡上报。
 */

import type { Shape } from '../mesh/types'
import { cad } from '../mesh'
import {
  extrudeBrep,
  solidToShape,
} from '../brep/brep-ops'
import type { OpContext } from './types'
import { canUseBrep } from './types'

/**
 * 执行拉伸操作
 */
export async function executeExtrude(ctx: OpContext): Promise<Shape> {
  const { stmt, inputGeometries, args } = ctx

  if (inputGeometries.length === 0) {
    throw new Error(`[ReplayValidator] extrude statement "${stmt.id}" has no input geometry`)
  }
  const shape = inputGeometries[0]
  const normal = (args.normal as [number, number, number] | undefined) ?? [0, 0, 1]
  const originOffset = (args.originOffset as number | undefined) ?? 0

  // 链不活跃 → mesh 路径（链已在前面静态断掉，正常继续）
  if (!canUseBrep(ctx)) {
    return cad.extrude(shape, {
      normal,
      originOffset,
      length: args.length as number,
      mode: args.mode as 'centered' | 'forward' | 'backward' | undefined,
    })
  }

  // 链活跃 → BREP 路径（直接执行，不包 try-catch！异常 = 未预期错误，冒泡上报）
  return executeExtrudeBrep(ctx, normal, originOffset)
}

/**
 * BREP 路径：用 OCCT extrude
 */
async function executeExtrudeBrep(
  ctx: OpContext,
  normal: [number, number, number],
  originOffset: number,
): Promise<Shape> {
  const { stmt, args, brepChain } = ctx
  if (!brepChain?.kernel) throw new Error('[executeExtrude] no kernel')

  const upstreamSolid = brepChain.solidCache.get(stmt.inputs[0])
  if (!upstreamSolid || !brepChain.kernel) {
    // 不变量错误：链活跃时上游必有 solid，缺失即 bug
    throw new Error(`[executeExtrude] upstream solid not found for statement "${stmt.id}" (input: ${stmt.inputs[0]}) — invariant violation: chain is active but upstream solid is missing`)
  }

  const resultSolid = extrudeBrep(brepChain.kernel, upstreamSolid, {
    normal,
    originOffset,
    length: args.length as number,
    mode: args.mode as 'centered' | 'forward' | 'backward' | undefined,
  })
  brepChain.solidCache.set(stmt.id, resultSolid)
  return solidToShape(brepChain.kernel, resultSolid)
}
