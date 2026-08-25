/**
 * 滚花操作分派器
 *
 * mesh-only（MESH_ONLY_OPS 包含 knurl）— 永远走 mesh 路径
 * 不写 solidCache → 输出 part 自动失去 BREP（逐 part 设计）
 * 不再翻转任何全局状态
 *
 * Mesh 路径：应用纹理位移
 */

import type { Shape, Vec3 } from '../mesh/types'
import { cad } from '../mesh'
import type { OpContext } from './types'
import { asPartName } from '../identity'

/**
 * 执行滚花操作
 */
export async function executeKnurl(ctx: OpContext): Promise<Shape> {
  const { stmt, inputGeometries, args, brepChain } = ctx

  if (inputGeometries.length === 0) {
    throw new Error(`[ExecutionValidator] knurl statement "${stmt.id}" has no input geometry`)
  }
  const shape = inputGeometries[0]

  // 防御性：确保输出 part 不在 solidCache 中（明确「本 part 失去 BREP」）
  // 输出是新 id，正常情况下不会残留，但显性删除更稳健、语义更清楚
  brepChain?.solidCache.delete(asPartName(stmt.id))

  // mesh 路径：应用纹理位移
  return cad.knurl(shape, {
    face: {
      center: (args.faceCenter as Vec3) ?? cad.bboxCenter(shape),
      normal: (args.faceNormal as Vec3) ?? [0, 0, 1],
    },
    knurlTextureHeight: (args.knurlTextureHeight as number) ?? 0.5,
    knurlInvertDisplacement: (args.knurlInvertDisplacement as boolean) ?? false,
    knurlRefineLength: (args.knurlRefineLength as number) ?? 1.0,
    knurlScaleU: (args.knurlScaleU as number) ?? 0.15,
    knurlScaleV: (args.knurlScaleV as number) ?? 0.15,
    knurlMappingMode: (args.knurlMappingMode as number) ?? 5,
  })
}
