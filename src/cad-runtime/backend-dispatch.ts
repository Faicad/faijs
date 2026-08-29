/**
 * backend-dispatch — BREP/mesh 路径静态判定（引擎侧）
 *
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P4
 *
 * 红线（AGENTS.md）：BREP 链是否可用，由静态规则在执行前判定，
 * **禁止运行时 try-catch 回退**。BREP 路径抛异常 = 设计缺陷或 bug，必须直接报错暴露。
 *
 * 本文件从 src/stdlib/internal/resolve-path.ts 迁移而来：判定是引擎的职责，
 * 不该由每个库函数各自调用。
 *
 * ⚠️ 分层例外：本文件位于 cad-runtime/ 但被 stdlib/ import。
 * 这是安全的——它只依赖 runtime-state / stdlib/shape / mesh/types，
 * 不依赖 cad-runtime 的任何其他模块，因此不构成循环。
 * P4b（可选）把函数拆成 brep/mesh 双实现后，此依赖会自然消失。
 */

import { getBackends, getCurrentStmt, BrepUnsupportedError } from '../runtime-state'
import { hasBrep } from '../stdlib/shape'
import type { Shape } from '../mesh/types'

/**
 * 判定本次调用走 BREP 还是 mesh。
 *
 * 规则（与迁移前逐字一致）：
 * 1. mode='mesh' → mesh
 * 2. mode='brep' → 无 brepImpl 则抛错；有 brepImpl 但输入不全在链也抛错
 * 3. mode='auto' → 有 brepImpl 且全部输入在链 → brep；否则 mesh
 */
export function dispatchPath(
  inputs: Shape[],
  brepImpl: unknown | undefined,
): 'brep' | 'mesh' {
  const { config } = getBackends()

  if (config.mode === 'mesh') return 'mesh'
  const currentStmt = getCurrentStmt()

  if (config.mode === 'brep') {
    if (!brepImpl) {
      throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: function has no BREP implementation', currentStmt)
    }
    if (!inputs.every(hasBrep)) {
      throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: input is not BREP', currentStmt)
    }
    return 'brep'
  }

  if (brepImpl && inputs.every(hasBrep)) return 'brep'
  return 'mesh'
}
