/**
 * test-helpers — 测试辅助函数
 *
 * 提供 executeScript 等便利函数，供测试使用。
 * 从 script-engine/replay-validator.ts 迁移（原名 replayScript，已改名对齐 roadmap §3.6）。
 *
 * Phase 2.5：executeScript 改用 CadRuntime（VM 执行），不再依赖 src/ops/dispatcher 的 executeStatement。
 */

import type { PartScript } from './lang/types'
import type { Shape } from './mesh/types'
import type { BrepChainState } from './brep/brep-chain'
import { CadRuntime } from './cad-runtime/runtime'
import { computeContentKey } from './cad-runtime/runtime'
import type { HostPorts, ExecutionMode } from './cad-runtime/ports'
import { asPartName, type PartName } from './identity'

export interface ExecuteOutput {
  contentKey: string
  shape: Shape
  brepChain: BrepChainState
}

/** 最小 ports（events no-op），供未传 ports 的测试使用。 */
function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

export async function executeScript(
  script: PartScript,
  inputGeometryMap?: Map<PartName, Shape>,
  params?: Record<string, unknown>,
  ports?: HostPorts,
  mode?: ExecutionMode,
  _brepChain?: BrepChainState,
): Promise<ExecuteOutput> {
  const runtime = new CadRuntime(ports ?? defaultPorts(), mode)
  const result = await runtime.execute(script, { params, inputGeometryMap })

  const newShapeStmts = script.statements.filter((s) => s.hasAssignment)
  if (newShapeStmts.length === 0) {
    throw new Error(`[executeScript] empty script — no geometry statements`)
  }
  const lastStmt = newShapeStmts[newShapeStmts.length - 1]
  const finalShape = result.outputs.get(lastStmt.outputs[0])!
  const contentKey = computeContentKey(finalShape.positions, finalShape.indices)

  return {
    contentKey,
    shape: finalShape,
    brepChain: result.brepChain,
  }
}
