/**
 * test-helpers — 测试辅助函数
 *
 * 提供 executeScript 等便利函数，供测试使用。
 * 从 script-engine/replay-validator.ts 迁移（原名 replayScript，已改名对齐 roadmap §3.6）。
 *
 * Phase 2.5：executeScript 改用 CadRuntime（VM 执行），不再依赖 src/ops/dispatcher 的 executeStatement。
 */

import type { ScriptIR } from './lang/types'
import type { Shape } from './mesh/types'
import type { BrepChainState } from './brep/brep-chain'
import { createRuntime } from './cad-runtime/runtime'
import { computeContentKey } from './cad-runtime/runtime'
import type { StdlibNamespace } from './runtime-state'
import type { HostPorts, ExecutionMode } from './cad-runtime/ports'
import type { PartName } from './identity'

// P5/E-a-1：cad 注入经「变量动态 import」——tsc 不解析非字面量 specifier，
// core build 不依赖 @faicad/faijs-stdlib 的 dist（构建顺序 core → stdlib）；
// vitest 运行时经 alias 解析到 stdlib 源码。test-helpers 只被测试消费。
const STDLIB_INTERNAL_MODULE = '@faicad/faijs-stdlib/internal-stdlib'

async function getCadLib(): Promise<StdlibNamespace> {
  const mod = (await import(STDLIB_INTERNAL_MODULE)) as { createInternalStdlib: () => StdlibNamespace }
  return mod.createInternalStdlib()
}

/** Result of executing a script via the test helper. */
export interface ExecuteOutput {
  contentKey: string
  shape: Shape
  brepChain: BrepChainState
}

/** 最小 ports（events no-op），供未传 ports 的测试使用。 */
function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

/**
 * Execute a script through the CadRuntime (VM) and return the final shape,
 * its content key, and the resulting BREP chain state.
 *
 * @param script - the compiled script IR to execute.
 * @param inputGeometryMap - optional input geometry keyed by part name.
 * @param params - optional execution parameters.
 * @param ports - optional host ports (defaults to a no-op events sink).
 * @param mode - optional execution mode.
 * @param _brepChain - optional pre-existing BREP chain state (reserved).
 * @returns the final shape, content key, and BREP chain state.
 */
export async function executeScript(
  script: ScriptIR,
  inputGeometryMap?: Map<PartName, Shape>,
  params?: Record<string, unknown>,
  ports?: HostPorts,
  mode?: ExecutionMode,
  _brepChain?: BrepChainState,
): Promise<ExecuteOutput> {
  // P5/E-a-1：测试辅助注入 cad 命名空间（core 不默认装配；test-helpers 只被测试消费）
  const runtime = createRuntime(ports ?? defaultPorts(), mode, { cad: await getCadLib() })
  const result = await runtime.execute(script, { params, inputGeometryMap })

  const newShapeStmts = script.statements.filter((s) => s.hasAssignment)
  if (newShapeStmts.length === 0) {
    throw new Error(`[executeScript] empty script — no geometry statements`)
  }
  const lastStmt = newShapeStmts[newShapeStmts.length - 1]
  const finalShape = result.outputs.get(lastStmt.outputs[0])!
  if (!('positions' in finalShape) || !('indices' in finalShape)) {
    throw new Error(`[executeScript] final output "${lastStmt.outputs[0]}" is not a mesh shape`)
  }
  const contentKey = computeContentKey(finalShape.positions, finalShape.indices)

  return {
    contentKey,
    shape: finalShape,
    brepChain: result.brepChain,
  }
}
