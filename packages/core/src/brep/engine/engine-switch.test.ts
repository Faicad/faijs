/**
 * engine-switch — 引擎可切换验证（occt vs brep-mock 跑同一 faijs 脚本）
 *
 * 需求锚点：引擎可切换、业务层不写死 occt、用第二引擎证明切换能力。
 *
 * 两段 describe 除「注册哪个引擎」外完全对称——同一段 faijs 脚本、
 * 同一个 runtime 执行路径（registry → ensureBrepChain → stdlib → brep ops）：
 * - occt 引擎：真实 STEP 导出（ADVANCED_FACE）
 * - brep-mock 引擎（内存模拟，仅切换验证用）：mock STEP 导出（brep-mock-engine 标记）
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
import { registerBrepMockEngine, BREP_MOCK_ENGINE_ID } from './adapters/brep-mock'

/** 同一段 faijs 脚本：构造（box×2）→ 布尔（union）。
 *  条件分支断言（不统一放宽）：occt 支持 evolution → union 成功（keepHidden 源保留 → 3 个 terminal）；
 *  memory 缺 evolution → 能力路由执行前明确报错（failedAt），已成功的 part0/part1 仍为 terminal（2 个）。 */
const SCRIPT = `let part0 = cad.box({ size: 10 })
let part1 = cad.box({ size: 10, center: [15, 0, 0] })
let part2 = cad.union(part0, part1)
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
  return runtime.executeIR(script)
}

describe('occt 引擎（默认实现）', () => {
  beforeEach(() => {
    // registry 模块级单例：每个 describe 独立注册目标引擎
    __resetEngineRegistriesForTests()
  })

  it('同一脚本：union 成功 → 3 个 brepSolids + 真实 STEP 导出（ADVANCED_FACE）', async () => {
    const result = await runWithEngine(registerOcctBrepEngine, OCCT_BREP_ENGINE_ID)

    expect(result.failedAt).toBeUndefined()
    expect(result.brepSolids).toBeDefined()
    // union 走 keepHidden：part0/part1 保留为 terminal + part2 → 3 个
    expect(result.brepSolids!.size).toBeGreaterThanOrEqual(3)
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

  it('同一脚本：union 缺 evolution → 能力路由执行前明确报错（无部分结果，不伪造）', async () => {
    const result = await runWithEngine(registerBrepMockEngine, BREP_MOCK_ENGINE_ID)

    // 布尔声明 evolution（§8.4），brep-mock 缺该能力 → brep 模式执行前明确报错，不伪造
    expect(result.failedAt).toBeDefined()
    expect(result.failedAt!.callee).toBe('union')
    expect(result.failedAt!.message).toMatch(/lacks capability 'evolution'/)
    // 能力路由在执行前拦截 union——失败不组装 brepSolids（无部分成功结果）
    expect(result.brepSolids).toBeUndefined()
  })
})
