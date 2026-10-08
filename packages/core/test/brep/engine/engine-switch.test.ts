/**
 * engine-switch — 引擎可切换验证（occt vs brep-mock 跑同一 faijs 脚本）
 *
 * 需求锚点：引擎可切换、业务层不写死 occt、用第二引擎证明切换能力。
 *
 * 两段 describe 除「注册哪个引擎」外完全对称——同一段 faijs 脚本、
 * 同一个 runtime 执行路径（registry → ensureBrepChain → api → brep ops）：
 * - occt 引擎：真实 STEP 导出（ADVANCED_FACE）
 * - brep-mock 引擎（内存模拟，仅切换验证用）：mock STEP 导出（brep-mock-engine 标记）
 *
 * 断言两引擎都产出 brepSolids + STEP 导出，且导出标记不同——证明执行路径
 * 与引擎解耦，换引擎不换代码。
 *
 * 2026-10-08（删除 `capabilities` 声明轴）：本文件第二段原先断言「memory 缺 evolution →
 * 能力路由执行前报错」，那是能力门对 brep-mock 的判决，不是引擎身份判决。声明轴删除后
 * `union` 是中立 op（无 `engines`），engine 门对 `brep_mock` 又本就有 D11-3 豁免，
 * 故两段重新完全对称——同一段脚本、同一断言形状，只有导出标记不同。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { ExecutionResult } from '../../../src/cad-runtime/runtime'
import type { HostPorts } from '../../../src/cad-runtime/ports'
import { asPartName } from '../../../src/identity'
import { __resetEngineRegistriesForTests, getActiveBrepEngineId } from '../../../src/brep/engine/registry'
import { registerOcctBrepEngine, OCCT_BREP_ENGINE_ID } from '../../../src/brep/engine/adapters/occt'
import { registerBrepMockEngine, BREP_MOCK_ENGINE_ID } from '../../../src/brep/engine/adapters/brep-mock'
import { createEditorRuntime } from '../../support/editor-ops'

/** 同一段 faijs 脚本：构造（box×2）→ 布尔（union）。
 *  `union` 中立（无 `engines`）→ 两引擎都执行，无执行前静态拒绝；
 *  唯一差异是 STEP 导出标记（`ADVANCED_FACE` vs `brep-mock-engine`）。 */
const SCRIPT = `let part0 = cad.box(10, 10, 10, { centered: true })
let part1 = cad.box(10, 10, 10, { centered: true, at: [15, 0, 0] })
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
  const runtime = createEditorRuntime(createNodePorts(), 'brep')
  return runtime.execute(SCRIPT)
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

  it('同一脚本：union 成功 → ≥3 个 brepSolids + mock STEP 导出（brep-mock-engine 标记）', async () => {
    const result = await runWithEngine(registerBrepMockEngine, BREP_MOCK_ENGINE_ID)

    // union 无 engines 白名单 ⇒ 引擎门放行；brep_mock 亦不在任何白名单语义内（D11-3 豁免）。
    // 静态拒绝面已无第二条声明轴（能力门于 2026-10-08 删除），故与 occt 段同形断言。
    expect(result.failedAt).toBeUndefined()
    expect(result.brepSolids).toBeDefined()
    // union 走 keepHidden：part0/part1 保留为 terminal + part2 → ≥3 个
    expect(result.brepSolids!.size).toBeGreaterThanOrEqual(3)
    const entry = result.brepSolids!.get(asPartName('part2'))
    expect(entry).toBeDefined()
    const step = entry!.kernel.exportStep(entry!.solid)
    expect(step).toContain('brep-mock-engine')
    expect(step).not.toContain('ADVANCED_FACE')
  })
})
