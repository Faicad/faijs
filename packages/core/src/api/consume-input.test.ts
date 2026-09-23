/**
 * @vitest-environment node
 *
 * consume-input — 复制类 op 不消费输入 shape（与 copy 同级）
 *
 * 背景：faijs 的"消费"模型由函数体 keep 声明驱动（live-shapes.ts lineConsumes
 * C5 默认消费短路）。copy 通过 `keep(input)` 让输入保留为存活终端；而 linearPattern /
 * mirror 这类"复制语义"的 op 当前没有 keep 声明 → 输入被判定为消费 → 从 terminals
 * 掉落。本测试保证：复制类 op（linearPattern / mirror）与 copy 一样，不消费其输入
 * shape —— 执行后输入变量仍出现在 result.terminals。
 *
 * 这是行为测试（端到端走 keep → keepByLine → computeLiveShapes 全链路），
 * 以 copy 为对照基线（copy 当前已实现 keep，必须恒通过）。
 *
 * Run: npx vitest run src/api/consume-input.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import { CadRuntime } from '../cad-runtime/runtime'
import { createApiNamespace } from './api-namespace'
import type { ExecutionMode } from '../cad-runtime/ports'
import type { ExecutionResult } from '../cad-runtime/runtime'

let kernelReady = false

beforeAll(async () => {
  await registerOcctBrepEngine()
  kernelReady = true
}, 120000)

function makeRuntime(mode?: ExecutionMode): CadRuntime {
  return new CadRuntime({ events: { emit() {} } }, mode, { cad: createApiNamespace() })
}

async function run(code: string, mode?: ExecutionMode): Promise<ExecutionResult> {
  const runtime = makeRuntime(mode)
  return runtime.execute(code)
}

/** 取 terminals 中的 part 名集合（人类可读，便于断言）。 */
function terminalIds(result: ExecutionResult): string[] {
  return result.terminals.map((t) => String(t.id))
}

// 复制类 op 的"输入不消费"对照程序：每个 op 都先建 box(s0)，再对 s0 做复制类变换，
// 断言 s0 仍出现在 terminals。
const PROGRAMS: Array<{ op: string; code: string }> = [
  {
    op: 'copy',
    code: [
      'const s0 = cad.box(20, 20, 20, { centered: true })',
      'const s1 = cad.copy(s0)',
    ].join('\n'),
  },
  {
    op: 'linearPattern',
    code: [
      'const s0 = cad.box(20, 20, 20, { centered: true })',
      'const s1 = cad.linearPattern(s0, [1, 0, 0], 3, 20)',
    ].join('\n'),
  },
  {
    op: 'mirror',
    code: [
      'const s0 = cad.box(20, 20, 20, { centered: true })',
      'const s1 = cad.mirror(s0, { normal: [1, 0, 0] })',
    ].join('\n'),
  },
]

describe('copy-like ops must not consume their input shape', () => {
  for (const { op, code } of PROGRAMS) {
    // copy 用例保留（真实回归：验证 occt 适配器实例覆盖修复）；
    // linearPattern / mirror 的 keep 语义按用户指示忽略（非 Phase 2 范围）。
    const skipped = op === 'linearPattern' || op === 'mirror'
    const fn = skipped ? it.skip : it
    fn(`${op}: input s0 remains a live terminal after the op`, async () => {
      expect(kernelReady).toBe(true)
      const result = await run(code)
      expect(result.failedAt).toBeUndefined()
      const ids = terminalIds(result)
      expect(ids).toContain('s0')
      // 结果本身也必须是终端
      expect(ids).toContain('s1')
    })
  }
})
