/**
 * backend-dispatch — BREP/mesh 路径静态判定（引擎侧）
 *
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

import { getBackends, getCurrentStmt, BrepUnsupportedError, MeshUnsupportedError } from '../runtime-state'
import { hasBrep } from '../shape'
import type { Shape } from '../mesh/types'

/** 静态判定的两个可能结果：走 BREP 链或 mesh 链。 */
export type BrepPath = 'brep' | 'mesh'

/** 能力名（对应 §7.5 BrepCapabilities 的布尔字段；能力路由 §8.4 用）。 */
export type BrepCapabilityName =
  | 'evolution'
  | 'heal'
  | 'directEdit'
  | 'advSurface'
  | 'assembly'
  | 'meshLift'

/**
 * Decide whether this invocation takes the BREP or the mesh backend path.
 *
 * Bidirectional dispatch (defineOp contract, D1/D1b/D2):
 * - `impls` carries mesh/brep implementation presence (function reference or
 *   undefined, fixed at defineOp construction — static).
 * - `mode='mesh'` → always mesh; missing mesh implementation (brep-only)
 *   throws `MeshUnsupportedError`.
 * - `mode='brep'` → missing brep / input off chain / missing capability throws
 *   `BrepUnsupportedError`.
 * - `mode='auto'` → brep when brep exists and all inputs are on the chain;
 *   otherwise mesh when mesh exists; brep-only with a broken input chain (or
 *   missing capability) throws `MeshUnsupportedError` — no mesh to fall back to.
 *
 * Capability routing (requiredCapability): when the current engine (registry)
 * lacks a declared capability, brep mode throws a BrepUnsupportedError (an
 * explicit error, never a silent fallback) while auto mode statically degrades
 * to mesh (never fabricating a missing capability).
 *
 * Red line unchanged: static dispatch, no runtime try-catch fallback. The
 * decision happens before the implementation runs and is never revised after a
 * failed execution.
 *
 * Third-party library authors never call this directly — `defineOp` (SDK)
 * invokes it inside its wrapper; authors only declare the implementation set.
 * @param inputs - the shapes feeding the operation, used to test whether all
 * lie on the BREP chain.
 * @param impls - the operation's implementation set: `mesh`/`brep` presence
 * (function reference or undefined; fixed at defineOp construction).
 * @param requiredCapability - an optional capability the operation declares;
 * a missing capability routes the dispatch.
 * @returns the selected backend path: 'brep' or 'mesh'.
 */
export function dispatchPath(
  inputs: Shape[],
  impls: { mesh?: unknown; brep?: unknown },
  requiredCapability?: BrepCapabilityName,
): BrepPath {
  const { config } = getBackends()

  if (config.mode === 'mesh') {
    if (!impls.mesh) {
      throw new MeshUnsupportedError('E_MESH_UNSUPPORTED: function has no mesh implementation', getCurrentStmt())
    }
    return 'mesh'
  }
  const currentStmt = getCurrentStmt()

  if (config.mode === 'brep') {
    if (!impls.brep) {
      throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: function has no BREP implementation', currentStmt)
    }
    if (!inputs.every(hasBrep)) {
      throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: input is not BREP', currentStmt)
    }
    // 能力路由：brep 模式缺能力 → 明确报错，不静默回退
    if (requiredCapability && !config.brepCapabilities?.[requiredCapability]) {
      throw new BrepUnsupportedError(
        `E_BREP_UNSUPPORTED: current engine lacks capability '${requiredCapability}' (brepEngineId=${config.brepEngineId ?? '<none>'})`,
        currentStmt,
      )
    }
    return 'brep'
  }

  // auto 模式：能力路由（缺能力 → 静态降级走 mesh；brep-only 无 mesh 可降 → 明确报错）
  if (requiredCapability && !config.brepCapabilities?.[requiredCapability]) {
    if (!impls.mesh) {
      throw new MeshUnsupportedError(
        `E_MESH_UNSUPPORTED: current engine lacks capability '${requiredCapability}' and function has no mesh implementation`,
        currentStmt,
      )
    }
    return 'mesh'
  }

  if (impls.brep && inputs.every(hasBrep)) return 'brep'
  if (!impls.mesh) {
    throw new MeshUnsupportedError(
      'E_MESH_UNSUPPORTED: input is not BREP and function has no mesh implementation',
      currentStmt,
    )
  }
  return 'mesh'
}
