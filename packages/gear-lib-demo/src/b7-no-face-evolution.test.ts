/**
 * B7 — 无 faceEvolution 的退化行为确认
 *
 *
 * 场景：第三方库（如外部 adapter）经 `fromHandle` 造的 BREP 产物**没有**
 * 面演化历史（无 faceEvolution —— 没有逐 op 的 ordinal 映射）。
 *
 * 验收（§5.8.4）：
 * 1. 缺失时下游（如 drill 按面选择）**显式报错**而非崩溃或静默错误结果；
 * 2. **不得**因此把第三方 BREP 产物降级为 mesh —— 该产物仍 `hasBrep === true`，
 *    与内置 op 的 BREP 布尔仍走精确路径（不产生混合）。
 *
 * 引擎现状（实证）：faceEvolution 全库只有写入方（fromBrep 登记 / DirectExecutor
 * 同步到 faceEvolutionCache），**无引擎侧读取消费者**——拓扑构建走
 * `meshShapeCache` + `buildAssemblySelectorManifest`（src/brep/brep-topology.ts），
 * drill 按面选择走 `geomQuery`（src/stdlib/geom.ts）实时 `kernel.getSubShapes`，
 * 都不依赖 faceEvolution。⇒ 缺失时不会崩溃、不会静默错误；面选择退化为
 * "无历史"（实时枚举当前面的 ordinal），几何精度不受影响。
 *
 * Run: npx vitest run test/faijs/libs/b7-no-face-evolution.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs-core/node'
import { initOcctWasm } from '@faicad/faijs-core'
import { hasBrep, getSlot } from '@faicad/faijs-core/shape'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import * as mockMechBrep from './mock-mech-brep'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

async function executeScript(code: string): Promise<{
  runtime: ReturnType<typeof createRuntime>
  result: Awaited<ReturnType<ReturnType<typeof createRuntime>['execute']>>
}> {
  const runtime = createRuntime(createNodePorts(), 'auto')
  runtime.registerLib('mech', mockMechBrep as never)
  const result = await runtime.execute(code)
  return { runtime, result }
}

function lastShape(
  result: Awaited<ReturnType<ReturnType<typeof createRuntime>['execute']>>,
): Shape {
  const outputs = Array.from(result.outputs.entries())
  const last = outputs[outputs.length - 1]
  if (!last) throw new Error('no shape output produced')
  return last[1] as Shape
}

describe('B7: 第三方 BREP 产物无 faceEvolution（fromHandle）', () => {
  it('产物 hasBrep === true 且无 faceEvolution 槽（无历史）', async () => {
    const { result } = await executeScript([
      "import * as mech from 'gear-lib-demo'",
      'let part0 = mech.makeHeadstock({ size: 20 })',
    ].join('\n'))
    expect(result.failedAt).toBeUndefined()
    const shape = lastShape(result)
    expect(hasBrep(shape)).toBe(true)
    expect(getSlot(shape)?.faceEvolution).toBeUndefined()
  })

  it('不被降级为 mesh：与内置 box 的布尔仍走精确 BREP 路径', async () => {
    const { result } = await executeScript([
      "import * as mech from 'gear-lib-demo'",
      'let part0 = mech.makeHeadstock({ size: 10 })',
      'let part1 = cad.box(20, 20, 20, { centered: true })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n'))
    expect(result.failedAt).toBeUndefined()
    // 全部输入 hasBrep → dispatchPath 返回 'brep' → 结果保留 BREP 槽（精确布尔，非混合降级）
    const shape = lastShape(result)
    expect(hasBrep(shape)).toBe(true)
    expect(shape.positions.length).toBeGreaterThan(0)
  })

  it('drill 按面选择在无 faceEvolution 产物上：显式报错或正常执行，不崩溃、不静默', async () => {
    // 面选择走 geomQuery：有 faceOrdinal 实时枚举当前面（无历史也可用）；
    // 无 faceOrdinal 且无 anchor → 显式抛错（[GeomRef] ... requires anchor or faceOrdinal）。
    // anchor 需先声明为参数（parser 位置参数只接受标识符引用，不接受数组字面量）。
    const { result } = await executeScript([
      "import * as mech from 'gear-lib-demo'",
      'let part0 = mech.makeHeadstock({ size: 20 })',
      'const anchor = [0, 0, 10]',
      'let f = cad.faceNormal(part0, anchor)',   // anchor 反查 → 正常（mesh 层）
      'let part1 = cad.fai_drill(part0, { diameter: 4, depth: 10, position: [0, 0, 10], faceNormal: f })',
    ].join('\n'))
    expect(result.failedAt).toBeUndefined()
    const shape = lastShape(result)
    expect(shape.positions.length).toBeGreaterThan(0)
  })

  it('faceNormal 无 anchor 且无 faceOrdinal → 显式抛错（不静默、不返回垃圾值）', async () => {
    // T5 direct-only: execution errors land in failedAt (no re-throw).
    // The error is not silently swallowed — it appears in the result's failedAt.
    const code = [
      "import * as mech from 'gear-lib-demo'",
      'let part0 = mech.makeHeadstock({ size: 20 })',
      'let f = cad.faceNormal(part0)',
    ].join('\n')
    const runtime = createRuntime(createNodePorts(), 'auto')
    runtime.registerLib('mech', mockMechBrep as never)
    const result = await runtime.execute(code)
    expect(result.failedAt).toBeDefined()
    expect(result.failedAt!.message).toMatch(/faceNormal requires anchor or faceOrdinal/)
  })
})
