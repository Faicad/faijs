/**
 * engine-switch — 引擎可切换验证（occt vs memory 跑同一 faijs 脚本）
 *
 * 需求锚点：引擎可切换、业务层不写死 occt、用第二引擎证明切换能力。
 *
 * 两段 describe 除「注册哪个引擎」外完全对称——同一段 faijs 脚本、
 * 同一个 runtime 执行路径（registry → ensureBrepChain → stdlib → brep ops）：
 * - occt 引擎：真实 STEP 导出（ADVANCED_FACE）
 * - memory 引擎（内存模拟，仅切换验证用）：mock STEP 导出（memory-engine 标记）
 *
 * 断言两引擎都产出 brepSolids + STEP 导出，且导出标记不同——证明执行路径
 * 与引擎解耦，换引擎不换代码。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { parseScript } from '../../lang/parser'
import { createRuntime } from '@faicad/faijs'
import type { ExecutionResult } from '../../cad-runtime/runtime'
import type { HostPorts } from '../../cad-runtime/ports'
import { asPartName } from '../../identity'
import { __resetEngineRegistriesForTests, getActiveBrepEngineId } from './registry'
import { registerOcctBrepEngine, OCCT_BREP_ENGINE_ID } from './adapters/occt'
import { registerMemoryBrepEngine, MEMORY_BREP_ENGINE_ID } from './adapters/memory'

/** 同一段 faijs 脚本：构造（box×2）→ 变换（center/translate）→ 三角化 → 导出。
 *  刻意不含布尔——布尔声明 evolution 能力（§8.4），memory 引擎缺该能力会明确报错，
 *  那部分由 capability-routing.test.ts 单独覆盖；此处验证「换引擎不换代码」的完整链路。 */
const SCRIPT = `let part0 = cad.box({ size: 10 })
let part1 = cad.box({ size: 10, center: [15, 0, 0] })
let part2 = cad.translate(part0, { offset: [0, 0, 5] })
`

/** 简化宿主端口（box/union 不依赖 assets/fonts）。 */
function createNodePorts(): HostPorts {
  return { events: { emit: () => undefined } }
}

/** 注册目标引擎 → 同一脚本跑一遍（'brep' 模式强制 BREP 链）。 */
async function runWithEngine(
  register: () => Promise<void> | void,
  expectedEngineId: string,
): Promise<ExecutionResult> {
  __resetEngineRegistriesForTests()
  await register()
  expect(getActiveBrepEngineId()).toBe(expectedEngineId)
  const { script } = parseScript(SCRIPT)
  const runtime = createRuntime(createNodePorts(), 'brep')
  return runtime.execute(script)
}

describe('occt 引擎（默认实现）', () => {
  beforeEach(() => {
    // registry 模块级单例：每个 describe 独立注册目标引擎
    __resetEngineRegistriesForTests()
  })

  it('同一脚本：出 brepSolids + 真实 STEP 导出（ADVANCED_FACE）', async () => {
    const result = await runWithEngine(registerOcctBrepEngine, OCCT_BREP_ENGINE_ID)

    expect(result.failedAt).toBeUndefined()
    expect(result.brepSolids).toBeDefined()
    // part1 + part2 为 terminal（part0 被 translate 消费，非 terminal）
    expect(result.brepSolids!.size).toBeGreaterThanOrEqual(2)
    const entry = result.brepSolids!.get(asPartName('part2'))
    expect(entry).toBeDefined()
    const step = entry!.kernel.exportStep(entry!.solid)
    expect(step).toContain('ADVANCED_FACE')
  })
})

describe('memory 引擎（第二引擎——切换能力验证）', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('同一脚本：出 brepSolids + memory 标记导出（证明换了引擎）', async () => {
    const result = await runWithEngine(registerMemoryBrepEngine, MEMORY_BREP_ENGINE_ID)

    expect(result.failedAt).toBeUndefined()
    expect(result.brepSolids).toBeDefined()
    // part1 + part2 为 terminal（part0 被 translate 消费，非 terminal）
    expect(result.brepSolids!.size).toBeGreaterThanOrEqual(2)
    const entry = result.brepSolids!.get(asPartName('part2'))
    expect(entry).toBeDefined()
    const step = entry!.kernel.exportStep(entry!.solid)
    expect(step).toContain('memory-engine')
    expect(step).not.toContain('ADVANCED_FACE')
  })
})
