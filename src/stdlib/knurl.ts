/**
 * stdlib knurl — 滚花库函数（mesh-only）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 *
 * 从 src/ops/knurl.ts 迁出并改写为 stdlib 形态：`(input, params, exec)`。
 * knurl 无 BREP 实现（mesh-only）——resolvePath 在 brep 模式下调用前抛错。
 */

import type { Shape, Vec3 } from '../mesh/types'
import { cad } from '../mesh'
import { solid } from './shape'
import { resolvePath } from './internal/resolve-path'
import type { ExecContext } from '../cad-runtime/exec-context'

export async function knurl(input: Shape, params: Record<string, unknown>, exec: ExecContext): Promise<Shape> {
  if (!input) throw new Error('[stdlib/knurl] no input geometry')
  // mesh-only：无 brepImpl；brep 模式下 resolvePath 调用前抛 BrepUnsupportedError
  resolvePath(exec, [input], undefined)
  return solid(await cad.knurl(input, {
    face: {
      center: (params.faceCenter as Vec3 | undefined) ?? cad.bboxCenter(input),
      normal: (params.faceNormal as Vec3 | undefined) ?? [0, 0, 1],
    },
    knurlTextureHeight: (params.knurlTextureHeight as number | undefined) ?? 0.5,
    knurlInvertDisplacement: (params.knurlInvertDisplacement as boolean | undefined) ?? false,
    knurlRefineLength: (params.knurlRefineLength as number | undefined) ?? 1.0,
    knurlScaleU: (params.knurlScaleU as number | undefined) ?? 0.15,
    knurlScaleV: (params.knurlScaleV as number | undefined) ?? 0.15,
    knurlMappingMode: (params.knurlMappingMode as number | undefined) ?? 5,
  }))
}
