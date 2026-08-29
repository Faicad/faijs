/**
 * stdlib sdf — SDF 库函数（mesh-only，创建类无输入）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2/P4
 *
 * sdf 无 BREP 实现（mesh-only）——dispatchPath 在 brep 模式下调用前抛错。
 * part-brep-lost 事件由引擎统一发（P4，库不再 emit）。
 */

import type { Shape } from '@faicad/faijs-core/mesh/types'
import { cad } from '@faicad/faijs-core/mesh'
import { solid } from '@faicad/faijs-core/shape'
import { dispatchPath } from '@faicad/faijs-core/cad-runtime/backend-dispatch'

/** sdf: code 必填非空字符串。 */
export function assertSdfParams(params: Record<string, unknown>): void {
  if (typeof params.code !== 'string' || params.code.trim() === '') {
    throw new Error(`[stdlib/sdf] code must be a non-empty string, got ${JSON.stringify(params.code)}`)
  }
}

export async function sdf(params: Record<string, unknown>): Promise<Shape> {
  assertSdfParams(params)
  // mesh-only：无 brepImpl；brep 模式下 dispatchPath 调用前抛 BrepUnsupportedError
  dispatchPath([], undefined)
  return solid(await cad.sdf({
    code: params.code as string,
    box: params.box as [[number, number, number], [number, number, number]] | undefined,
    resolution: params.resolution as number | undefined,
    params: params.params as Record<string, number> | undefined,
  }))
}
