/**
 * B4 — mock 库 fixture 验收测试
 *
 *
 * 验收：两版（mesh / BREP）均可被 `registerLib` 接受并**真正求值**
 * （经 ns.<binding>.<callee> 调用产出可用的 faijs Shape）。
 *
 * Run: npx vitest run test/faijs/libs/mock-lib.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { initOcctWasm } from '@faicad/faijs'
import { hasBrep } from '@faicad/faijs/shape'
import { CONTRACT_VERSION } from '@faicad/faijs/sdk'
import type { Shape } from '@faicad/faijs/mesh/types'
import * as mockMechMesh from './mock-mech-mesh'
import * as mockMechBrep from './mock-mech-brep'
import { createEditorRuntime } from '../../../_support/editor-runtime'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

/** 执行 import + 命名空间调用脚本（F2 parser → P7 registerLib → 执行全链路，公共文本 API）。 */
async function executeWithLib(
  binding: string,
  lib: unknown,
  code: string,
): Promise<Shape> {
  const runtime = createEditorRuntime(createNodePorts(), 'auto')
  runtime.registerLib(binding, lib as never)
  const result = await runtime.execute(code)
  expect(result.failedAt).toBeUndefined()
  const outputs = Array.from(result.outputs.entries())
  const shape = outputs[outputs.length - 1]?.[1] as Shape | undefined
  expect(shape).toBeDefined()
  return shape!
}

/** 最后一个 shape 输出（公共 ExecutionResult 面；不触碰引擎内部 IR）。 */
function lastShape(
  result: Awaited<ReturnType<ReturnType<typeof createRuntime>['execute']>>,
): Shape | undefined {
  const outputs = Array.from(result.outputs.entries())
  return outputs[outputs.length - 1]?.[1] as Shape | undefined
}

describe('B4: mock 库 fixture — mesh 版', () => {
  it('带 contractVersion，可被 registerLib 接受', () => {
    expect(mockMechMesh.contractVersion).toBe(CONTRACT_VERSION)
    const runtime = createEditorRuntime(createNodePorts(), 'auto')
    expect(() => runtime.registerLib('mech', mockMechMesh as never)).not.toThrow()
  })

  it('经 ns.mech.makeHeadstock 真正求值 → 非空 mesh、无 BREP 槽', async () => {
    const shape = await executeWithLib('mech', mockMechMesh, [
      "import * as mech from 'test-fixture-lib'",
      'let part0 = mech.makeHeadstock({ size: 20 })',
    ].join('\n'))
    expect(shape.positions.length).toBeGreaterThan(0)
    expect(shape.indices.length).toBeGreaterThan(0)
    expect(hasBrep(shape)).toBe(false)
  })
})

describe('B4: mock 库 fixture — BREP 版', () => {
  it('带 contractVersion，可被 registerLib 接受', () => {
    expect(mockMechBrep.contractVersion).toBe(CONTRACT_VERSION)
    const runtime = createEditorRuntime(createNodePorts(), 'auto')
    expect(() => runtime.registerLib('mech', mockMechBrep as never)).not.toThrow()
  })

  it('经 ns.mech.makeHeadstock 真正求值 → 非空 mesh、含 BREP 槽（hasBrep === true）', async () => {
    const shape = await executeWithLib('mech', mockMechBrep, [
      "import * as mech from 'test-fixture-lib'",
      'let part0 = mech.makeHeadstock({ size: 20 })',
    ].join('\n'))
    expect(shape.positions.length).toBeGreaterThan(0)
    expect(shape.indices.length).toBeGreaterThan(0)
    expect(hasBrep(shape)).toBe(true)
  })

  it('BREP 产物可与内置 op 混合布尔（跨命名空间消费）', async () => {
    const runtime = createEditorRuntime(createNodePorts(), 'auto')
    runtime.registerLib('mech', mockMechBrep as never)
    const result = await runtime.execute([
      "import * as mech from 'test-fixture-lib'",
      'let part0 = mech.makeHeadstock({ size: 10 })',
      'let part1 = cad.box(5, 5, 5, { centered: true })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n'))
    expect(result.failedAt).toBeUndefined()
    const shape = lastShape(result)
    expect(shape).toBeDefined()
    expect(shape!.positions.length).toBeGreaterThan(0)
  })

  it('mesh 模式：makeHeadstock 产 mesh box（mesh-first，不再崩溃，hasBrep false）', async () => {
    const runtime = createEditorRuntime(createNodePorts(), 'mesh')
    runtime.registerLib('mech', mockMechBrep as never)
    const result = await runtime.execute([
      "import * as mech from 'test-fixture-lib'",
      'let part0 = mech.makeHeadstock({ size: 20 })',
    ].join('\n'))
    expect(result.failedAt).toBeUndefined()
    const shape = lastShape(result)
    expect(shape).toBeDefined()
    expect(shape!.positions.length).toBeGreaterThan(0)
    expect(hasBrep(shape!)).toBe(false)
  })
})
