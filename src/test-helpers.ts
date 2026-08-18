/**
 * test-helpers — 测试辅助函数
 *
 * 提供 replayScript 等便利函数，供测试使用。
 * 从 script-engine/replay-validator.ts 迁移。
 */

import type { PartScript } from './lang/types'
import type { Shape } from './ops/types'
import type { BrepChainState } from './brep/brep-chain'
import { initBrepChainState } from './brep/brep-chain'
import { executeStatement } from './ops/dispatcher'
import { computeContentKey } from './cad-runtime/runtime'
import type { HostPorts, ExecutionMode } from './cad-runtime/ports'

export interface ReplayOutput {
  contentKey: string
  shape: Shape
  brepChain: BrepChainState
}

export { executeStatement }

export async function replayScript(
  script: PartScript,
  inputGeometryMap?: Map<string, Shape>,
  params?: Record<string, unknown>,
  ports?: HostPorts,
  mode?: ExecutionMode,
): Promise<ReplayOutput> {
  const outputCache = new Map<string, Shape>()
  const brepChain = await initBrepChainState()

  for (const stmt of script.statements) {
    // void / same_shape 语句不产出新几何，跳过执行
    const rt = stmt.returnType ?? 'new_shape'
    if (rt === 'void' || rt === 'same_shape') continue
    const inputGeometries: Shape[] = []
    for (const inputRef of stmt.inputs) {
      const geo = outputCache.get(inputRef) ?? inputGeometryMap?.get(inputRef)
      if (!geo) {
        throw new Error(`[replayScript] missing input geometry for ref "${inputRef}" in statement "${stmt.id}"`)
      }
      inputGeometries.push(geo)
    }

    const result = await executeStatement(stmt, inputGeometries, outputCache, params, brepChain, ports, mode)
    outputCache.set(stmt.id, result)
  }

  const newShapeStmts = script.statements.filter(
    s => s.hasAssignment && (s.returnType ?? 'new_shape') === 'new_shape',
  )
  if (newShapeStmts.length === 0) {
    throw new Error(`[replayScript] empty script — no geometry statements`)
  }
  const lastStmt = newShapeStmts[newShapeStmts.length - 1]
  const finalShape = outputCache.get(lastStmt.id)!
  const contentKey = computeContentKey(finalShape.positions, finalShape.indices)

  return {
    contentKey,
    shape: finalShape,
    brepChain,
  }
}
