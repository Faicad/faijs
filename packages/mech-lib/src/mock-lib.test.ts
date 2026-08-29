/**
 * B4 — mock 库 fixture 验收测试
 *
 * 设计文档：docs/plans/2026-08-29-faijs-module-runtime-plan.md §7.3 B4
 *
 * 验收：两版（mesh / BREP）均可被 `registerLib` 接受并**真正求值**
 * （经 ns.<binding>.<callee> 调用产出可用的 faijs Shape）。
 *
 * Run: npx vitest run test/faijs/libs/mock-lib.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { parseScript } from '@faicad/faijs-core'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs-core/node'
import { initOcctWasm } from '@faicad/faijs-core'
import { hasBrep } from '@faicad/faijs-core/shape'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import * as mockMechMesh from './mock-mech-mesh'
import * as mockMechBrep from './mock-mech-brep'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

/** 解析 import + 命名空间调用脚本并执行（F2 parser → P7 registerLib → 执行全链路）。 */
async function executeWithLib(
  binding: string,
  lib: unknown,
  code: string,
): Promise<Shape> {
  const runtime = createRuntime(createNodePorts(), 'auto')
  runtime.registerLib(binding, lib as never)
  const { script } = parseScript(code)
  const result = await runtime.execute(script)
  expect(result.failedAt).toBeUndefined()
  const geoStmts = script.statements.filter((s) => s.hasAssignment)
  const lastStmt = geoStmts[geoStmts.length - 1]
  const shape = result.outputs.get(lastStmt.outputs[0]) as Shape | undefined
  expect(shape).toBeDefined()
  return shape!
}

describe('B4: mock 库 fixture — mesh 版', () => {
  it('带 contractVersion，可被 registerLib 接受', () => {
    expect(mockMechMesh.contractVersion).toBe(1)
    const runtime = createRuntime(createNodePorts(), 'auto')
    expect(() => runtime.registerLib('mech', mockMechMesh as never)).not.toThrow()
  })

  it('经 ns.mech.makeHeadstock 真正求值 → 非空 mesh、无 BREP 槽', async () => {
    const shape = await executeWithLib('mech', mockMechMesh, [
      "import * as mech from 'mech-lib'",
      'let part0 = mech.makeHeadstock({ size: 20 })',
    ].join('\n'))
    expect(shape.positions.length).toBeGreaterThan(0)
    expect(shape.indices.length).toBeGreaterThan(0)
    expect(hasBrep(shape)).toBe(false)
  })
})

describe('B4: mock 库 fixture — BREP 版', () => {
  it('带 contractVersion，可被 registerLib 接受', () => {
    expect(mockMechBrep.contractVersion).toBe(1)
    const runtime = createRuntime(createNodePorts(), 'auto')
    expect(() => runtime.registerLib('mech', mockMechBrep as never)).not.toThrow()
  })

  it('经 ns.mech.makeHeadstock 真正求值 → 非空 mesh、含 BREP 槽（hasBrep === true）', async () => {
    const shape = await executeWithLib('mech', mockMechBrep, [
      "import * as mech from 'mech-lib'",
      'let part0 = mech.makeHeadstock({ size: 20 })',
    ].join('\n'))
    expect(shape.positions.length).toBeGreaterThan(0)
    expect(shape.indices.length).toBeGreaterThan(0)
    expect(hasBrep(shape)).toBe(true)
  })

  it('BREP 产物可与内置 op 混合布尔（跨命名空间消费）', async () => {
    const runtime = createRuntime(createNodePorts(), 'auto')
    runtime.registerLib('mech', mockMechBrep as never)
    const { script } = parseScript([
      "import * as mech from 'mech-lib'",
      'let part0 = mech.makeHeadstock({ size: 10 })',
      'let part1 = cad.box({ size: 5 })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n'))
    const result = await runtime.execute(script)
    expect(result.failedAt).toBeUndefined()
    const lastStmt = script.statements[script.statements.length - 1]
    const shape = result.outputs.get(lastStmt.outputs[0]) as Shape
    expect(shape.positions.length).toBeGreaterThan(0)
  })
})
