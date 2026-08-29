/**
 * stdlib knurl — 滚花库函数（mesh-only）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2/P4
 *
 * knurl 无 BREP 实现（mesh-only）——dispatchPath 在 brep 模式下调用前抛错。
 * part-brep-lost 事件由引擎统一发（P4，库不再 emit）。
 */

import type { Shape, Vec3 } from '../mesh/types'
import { cad } from '../mesh'
import { solid } from './shape'
import { dispatchPath } from '../cad-runtime/backend-dispatch'
import { assertPositiveNumber } from './assert'

/** knurl: knurlTextureHeight 必填 > 0。 */
export function assertKnurlParams(params: Record<string, unknown>): void {
  assertPositiveNumber(params.knurlTextureHeight, 'knurl.knurlTextureHeight')
}

export async function knurl(input: Shape, params: Record<string, unknown>): Promise<Shape> {
  if (!input) throw new Error('[stdlib/knurl] no input geometry')
  assertKnurlParams(params)
  // mesh-only：无 brepImpl；brep 模式下 dispatchPath 调用前抛 BrepUnsupportedError
  dispatchPath([input], undefined)
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
