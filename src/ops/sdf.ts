/**
 * SDF 操作分派器
 *
 * mesh-only（MESH_ONLY_OPS 包含 sdf）— 静态断链点
 * 链活跃时由 runtime 静态断链后走 mesh 路径（合法分支，非回退）
 */

import type { Shape } from '../mesh/types'
import { cad } from '../mesh'
import type { OpContext } from './types'

/**
 * 执行 SDF 操作
 */
export async function executeSdf(ctx: OpContext): Promise<Shape> {
  const { args } = ctx

  const boxArg = args.box as [[number, number, number], [number, number, number]] | undefined
  return cad.sdf({
    code: args.code as string,
    box: boxArg,
    resolution: args.resolution as number | undefined,
    params: args.params as Record<string, number> | undefined,
  })
}
