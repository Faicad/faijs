/**
 * SDF 操作分派器
 *
 * mesh-only（MESH_ONLY_OPS 包含 sdf）— 永远走 mesh 路径
 * 不写 solidCache → 输出 part 自动失去 BREP（逐 part 设计）
 * 不再翻转任何全局状态
 */

import type { Shape } from '../mesh/types'
import { cad } from '../mesh'
import type { OpContext } from './types'

/**
 * 执行 SDF 操作
 */
export async function executeSdf(ctx: OpContext): Promise<Shape> {
  const { stmt, args, brepChain } = ctx

  // 防御性：确保输出 part 不在 solidCache 中（明确「本 part 失去 BREP」）
  brepChain?.solidCache.delete(stmt.id)

  const boxArg = args.box as [[number, number, number], [number, number, number]] | undefined
  return cad.sdf({
    code: args.code as string,
    box: boxArg,
    resolution: args.resolution as number | undefined,
    params: args.params as Record<string, number> | undefined,
  })
}
