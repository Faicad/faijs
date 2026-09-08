/**
 * test-helpers — 测试辅助函数
 *
 * 提供 executeScript 等便利函数，供测试使用。
 * 从 script-engine/replay-validator.ts 迁移（原名 replayScript，已改名对齐 roadmap §3.6）。
 *
 * Phase 2.5：executeScript 改用 CadRuntime（VM 执行），不再依赖 src/ops/dispatcher 的 executeStatement。
 * executeScript 接受代码文本，走 CadRuntime.execute（无 IR 中间层）。
 */

import type { Shape } from './mesh/types'
import type { BrepChainState } from './brep/brep-chain'
import { createRuntime } from './cad-runtime/runtime'
import { computeContentKey } from './cad-runtime/runtime'
import type { StdlibNamespace } from './runtime-state'
import type { HostPorts, ExecutionMode } from './cad-runtime/ports'
// P6/D1：库函数已并入 core 的 api/ 层（原 packages/stdlib 已取消）。
// 同包静态导入（tsc/vitest/vite 均能静态解析）——替代原「变量动态 import」，
// 后者触发 Vite import-analysis 警告，且浏览器侧无法解析裸 specifier。
import { createApiNamespace } from './api/api-namespace'

async function getCadLib(): Promise<StdlibNamespace> {
  return createApiNamespace()
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
 * Execute a script through the CadRuntime (direct path) and return the final
 * shape, its content key, and the resulting BREP chain state.
 *
 * @param code - the .fai.js source text to execute.
 * @param params - optional execution parameters.
 * @param ports - optional host ports (defaults to a no-op events sink).
 * @param mode - optional execution mode.
 * @param _brepChain - optional pre-existing BREP chain state (reserved).
 * @returns the final shape, content key, and BREP chain state.
 */
export async function executeScript(
  code: string,
  params?: Record<string, unknown>,
  ports?: HostPorts,
  mode?: ExecutionMode,
  _brepChain?: BrepChainState,
): Promise<ExecuteOutput> {
  // P5/E-a-1：测试辅助注入 cad 命名空间（core 不默认装配；test-helpers 只被测试消费）
  const runtime = createRuntime(ports ?? defaultPorts(), mode, { cad: await getCadLib() })
  const result = await runtime.execute(code, { params })

  // 从 outputs 中取最后一个 shape（与原逻辑一致）
  const shapeNames = [...result.outputs.keys()]
  if (shapeNames.length === 0) {
    throw new Error(`[executeScript] empty result — no geometry outputs`)
  }
  const finalName = shapeNames[shapeNames.length - 1]
  const finalShape = result.outputs.get(finalName)!
  if (!('positions' in finalShape) || !('indices' in finalShape)) {
    throw new Error(`[executeScript] final output "${finalName}" is not a mesh shape`)
  }
  const contentKey = computeContentKey(finalShape.positions, finalShape.indices)

  return {
    contentKey,
    shape: finalShape,
    brepChain: result.brepChain,
  }
}
