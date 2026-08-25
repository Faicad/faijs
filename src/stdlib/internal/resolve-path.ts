/**
 * stdlib resolvePath — BREP/mesh 路径静态判定（红线保持）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 *
 * BREP 链是否可用，由静态规则在执行前判定，禁止运行时 try-catch 回退。
 * brep 模式下的不支持错误在**调用前**抛出（BrepUnsupportedError → CadRuntime 转 failedAt）。
 */

import type { ExecContext } from '../../cad-runtime/exec-context'
import { BrepUnsupportedError } from '../../cad-runtime/exec-context'
import type { ExecContextImpl } from '../../cad-runtime/exec-context'
import type { Shape } from '../../mesh/types'

/**
 * 判定库函数走 BREP 还是 mesh 路径。
 *
 * 规则：
 * 1. mode='mesh' → mesh（所有 op 必须实现 mesh 路径）。
 * 2. mode='brep' → 无 brepImpl 则**调用前抛错**；有 brepImpl 但输入不全在链
 *    （exec.getSolid 为 undefined）也**调用前抛错**。
 * 3. mode='auto' → 有 brepImpl 且全部输入在链 → brep；否则 mesh
 *    （空输入的创建类 `[].every()===true`，与现状一致）。
 *
 * @param exec 执行上下文（getSolid 按 Shape 身份查链）
 * @param inputs 输入 Shape 列表
 * @param brepImpl 该 op 的 BREP 实现（无则视为 mesh-only）
 * @returns 'brep' | 'mesh'
 */
export function resolvePath(
  exec: ExecContext,
  inputs: Shape[],
  brepImpl: unknown | undefined,
): 'brep' | 'mesh' {
  if (exec.mode === 'mesh') return 'mesh'
  const currentStmt = (exec as ExecContextImpl).currentStmt

  if (exec.mode === 'brep') {
    if (!brepImpl) {
      throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: op has no BREP implementation', currentStmt)
    }
    if (!inputs.every((s) => exec.getSolid(s))) {
      throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: input is not BREP', currentStmt)
    }
    return 'brep'
  }

  // auto：有 brepImpl 且全部输入在链 → brep；否则 mesh（空输入创建类默认 brep）
  if (brepImpl && inputs.every((s) => exec.getSolid(s))) return 'brep'
  return 'mesh'
}
