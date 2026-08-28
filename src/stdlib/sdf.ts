/**
 * stdlib sdf — SDF 库函数（mesh-only，创建类无输入）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 *
 * 从 src/ops/sdf.ts 迁出并改写为 stdlib 形态：`(params, exec)`。
 * sdf 无 BREP 实现（mesh-only）——resolvePath 在 brep 模式下调用前抛错。
 */

import type { Shape } from '../mesh/types'
import { cad } from '../mesh'
import { solid } from './shape'
import { resolvePath } from './internal/resolve-path'
import { asPartName } from '../identity'
import type { ExecContext } from '../cad-runtime/exec-context'

/** sdf: code 必填非空字符串。 */
export function assertSdfParams(params: Record<string, unknown>): void {
  if (typeof params.code !== 'string' || params.code.trim() === '') {
    throw new Error(`[stdlib/sdf] code must be a non-empty string, got ${JSON.stringify(params.code)}`)
  }
}

export async function sdf(params: Record<string, unknown>, exec: ExecContext): Promise<Shape> {
  assertSdfParams(params)
  // mesh-only op: emit part-brep-lost in auto mode (design §4.5-1, moved from adapter)
  if (exec.mode === 'auto') {
    exec.events.emit('part-brep-lost', {
      partName: asPartName(exec.currentStmt?.outputs[0] ?? ''),
      op: 'sdf',
      reason: 'mesh-only op output',
    })
  }
  // mesh-only：无 brepImpl；brep 模式下 resolvePath 调用前抛 BrepUnsupportedError
  resolvePath(exec, [], undefined)
  return solid(await cad.sdf({
    code: params.code as string,
    box: params.box as [[number, number, number], [number, number, number]] | undefined,
    resolution: params.resolution as number | undefined,
    params: params.params as Record<string, number> | undefined,
  }))
}
