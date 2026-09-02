/**
 * 能力路由测试（§8.4：dispatchPath 按当前引擎 capabilities 静态判定）
 *
 * 同一段 faijs 脚本（box×2 + union），union 声明 evolution 能力（boolean 走
 * *WithHistory 面演化）：
 * - memory 引擎（capabilities 空 → 无 evolution）：
 *   - brep 模式 → BrepUnsupportedError（明确报错，不静默回退）→ failedAt
 *   - auto 模式 → 静态降级走 mesh（绝不伪造缺失能力）→ 正常出 mesh 结果
 * - occt 引擎（capabilities.evolution = true）→ brep 模式正常走 brep 链
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { parseScript } from '../../lang/parser'
import { createRuntime } from '@faicad/faijs'
import type { ExecutionResult } from '../../cad-runtime/runtime'
import type { HostPorts } from '../../cad-runtime/ports'
import { asPartName } from '../../identity'
import { __resetEngineRegistriesForTests } from './registry'
import { registerBrepMockEngine } from './adapters/brep-mock'
import { registerOcctBrepEngine } from './adapters/occt'

const SCRIPT = `let part0 = cad.box({ size: 10 })
let part1 = cad.box({ size: 10, center: [15, 0, 0] })
let part2 = cad.union(part0, part1)
`

/** 简化宿主端口（box/union 不依赖 assets/fonts）。 */
function createNodePorts(): HostPorts {
  return { events: { emit: () => undefined } }
}

async function run(mode: 'auto' | 'brep'): Promise<ExecutionResult> {
  const { script } = parseScript(SCRIPT)
  const runtime = createRuntime(createNodePorts(), mode)
  return runtime.executeIR(script)
}

describe('能力路由（§8.4）：brep-mock 引擎无 evolution 能力', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
    registerBrepMockEngine()
  })

  it('brep 模式：union（需 evolution）→ BrepUnsupportedError → failedAt 明确报错', async () => {
    const result = await run('brep')
    expect(result.failedAt).toBeDefined()
    expect(result.failedAt!.callee).toBe('union')
    expect(result.failedAt!.message).toMatch(/lacks capability 'evolution'/)
  })

  it('auto 模式：union（需 evolution）→ 静态降级走 mesh，正常出结果', async () => {
    const result = await run('auto')
    expect(result.failedAt).toBeUndefined()
    // mesh 路径产物在 outputs；union 结果 part2 存在
    expect(result.outputs.get(asPartName('part2'))).toBeDefined()
  })
})

describe('能力路由：occt 引擎具备 evolution 能力', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('brep 模式：union 正常走 brep 链（capabilities.evolution = true）', async () => {
    await registerOcctBrepEngine()
    const result = await run('brep')
    expect(result.failedAt).toBeUndefined()
    expect(result.brepSolids?.size).toBeGreaterThanOrEqual(3)
  })

  it('D4 并入：occt 适配器如实声明合并后的 KernelCapabilities 字段（exact/brepExport/exactMeasurement/tessellationModel）', async () => {
    await registerOcctBrepEngine()
    const { getBrepEngine } = await import('./registry')
    const engine = await getBrepEngine('occt')
    expect(engine.capabilities).toMatchObject({
      exact: true,
      brepExport: true,
      exactMeasurement: true,
      tessellationModel: 'extract-time',
    })
  })
})
