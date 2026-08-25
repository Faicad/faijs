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
import type { ExecContext } from '../cad-runtime/exec-context'

export async function sdf(params: Record<string, unknown>, exec: ExecContext): Promise<Shape> {
  // mesh-only：无 brepImpl；brep 模式下 resolvePath 调用前抛 BrepUnsupportedError
  resolvePath(exec, [], undefined)
  return solid(await cad.sdf({
    code: params.code as string,
    box: params.box as [[number, number, number], [number, number, number]] | undefined,
    resolution: params.resolution as number | undefined,
    params: params.params as Record<string, number> | undefined,
  }))
}
