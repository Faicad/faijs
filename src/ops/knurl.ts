/**
 * 滚花操作分派器
 *
 * mesh-only（MESH_ONLY_OPS 包含 knurl）— 静态断链点
 * 链活跃时由 runtime 静态断链后走 mesh 路径（合法分支，非回退）
 *
 * Mesh 路径：应用纹理位移
 */

import type { Shape, Vec3 } from '../mesh/types'
import { cad } from '../mesh'
import type { OpContext } from './types'

/**
 * 执行滚花操作
 */
export async function executeKnurl(ctx: OpContext): Promise<Shape> {
  const { stmt, inputGeometries, args } = ctx

  if (inputGeometries.length === 0) {
    throw new Error(`[ReplayValidator] knurl statement "${stmt.id}" has no input geometry`)
  }
  const shape = inputGeometries[0]

  // mesh 路径：应用纹理位移（BREP 链已由 runtime 静态断链）
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
