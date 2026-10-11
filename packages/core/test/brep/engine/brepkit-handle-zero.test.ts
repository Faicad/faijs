/**
 * brepkit 句柄空间是 **0 基**：`0` 是合法 solid 句柄（`KIND_SOLID = 0 << 26`）。
 *
 * 缺陷留档（2026-10-11）：faijs 的句柄存在性判断曾写成**真值判断**
 * （`if (!solid)` / `if (slot.solid)` / `if (s && this.kernel)`），把合法句柄 `0`
 * 当成「没有句柄」。后果：
 * - BREP solid 装不进 runtime 的 `solidCache` → `result.brepSolids` 直接 `undefined`；
 * - 下游 op（translate / fillet / exportStep…）误报 `input is not BREP`；
 * - STEP 导出丢零件（`if (e.solid)` 静默跳过）。
 * occt 的句柄是 **1 基**，所以这个缺陷长期潜伏，只在 brepkit 下、且句柄恰为 `0`
 * 时暴露——「全新内核的第一次 `importStep`」正是这种情况。
 *
 * 本文件把两边都钉住（AGENTS.md「验证与踩坑留档铁律」）：
 * - **应有值**：句柄恰为 `0` 的 solid 必须进 `brepSolids`，且条目 `solid` 就是 `0`；
 * - **曾有错误值**：修复前 `result.brepSolids` 是 `undefined`（`?.get(part)` 取不到）。
 *
 * 前置断言 `Number(brepOf(outputs.a)) === 0` 把用例钉死在句柄 `0` 上：一旦内核
 * 分配顺序变化使句柄不再是 `0`，用例**直接失败**而不是静默退化成空转。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { HostPorts } from '../../../src/cad-runtime/ports'
import type { Shape } from '../../../src/mesh/types'
import type { BrepHandle } from '../../../src/brep/engine/types'
import { asPartName } from '../../../src/identity'
import { brepOf, hasBrep, fromBrep } from '../../../src/shape'
import { __resetEngineRegistriesForTests } from '../../../src/brep/engine/registry'
import { registerBrepkitBrepEngine } from '../../../src/brep/engine/adapters/brepkit'
import { disposeBrepkit } from '../../../src/brepkit-kernel/brepkitKernel'
import { resetBrepkitWasm } from '../../../src/brepkit-kernel/brepkitWasm'
import { readFileArrayBuffer } from '../../../src/io/bytes-node'
import { createEditorRuntime } from '../../support/editor-ops'

const STEP_BUFFER = readFileArrayBuffer(new URL('../../../../fixtures/data/box_boss.step', import.meta.url))

function portsFor(buf: ArrayBuffer): HostPorts {
  return {
    events: { emit: () => undefined },
    hostEnv: 'node',
    assets: {
      resolveByKey: async () => ({ bytes: buf }),
      resolveFile: async () => buf,
      resolveUrl: async () => buf,
    },
  } as unknown as HostPorts
}

/** 空 mesh 载荷（本文件只关心身份槽，不关心三角载荷）。 */
function emptyMesh(): Shape {
  return { positions: new Float32Array(0), indices: new Uint32Array(0) } as unknown as Shape
}

describe('brepkit handle 0 is a legal handle', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
    // 丢弃已装载的内核，让下一次 init 新建 wasm 实例 —— 句柄空间从 0 开始，
    // 于是「本用例的第一次 importStep」拿到句柄 0（前置断言会验证这一点）。
    disposeBrepkit()
    resetBrepkitWasm()
  })

  it('imported solid at handle 0 still lands in brepSolids (STEP import path)', async () => {
    await registerBrepkitBrepEngine()
    const runtime = createEditorRuntime(portsFor(STEP_BUFFER), 'brep')
    const result = await runtime.execute(
      `let a = await cad.import_step({ path: 'x.step' })\nlet r = a`,
    )
    expect(result.failedAt).toBeUndefined()

    // 前置：outputs.a 的 BREP 句柄必须是 0，否则本用例没有打在缺陷上 → 显式失败。
    const outputA = result.outputs?.get(asPartName('a'))
    expect(outputA, 'import_step must produce an output shape').toBeDefined()
    expect(Number(brepOf(outputA as Shape))).toBe(0)

    // 应有值：句柄 0 的 solid 必须登记进 brepSolids（曾有错误值 = undefined）。
    expect(result.brepSolids).toBeDefined()
    const entry = result.brepSolids!.get(asPartName('a'))
    expect(entry, 'a handle-0 solid must not be dropped from brepSolids').toBeDefined()
    expect(entry!.solid).toBe(0)
    // 句柄真的能用：STEP 导出仍带精确曲面面（不是静默降级成三角化）。
    expect(entry!.kernel.exportStep(entry!.solid)).toContain('ADVANCED_FACE')
  })

  it('hasBrep / brepOf treat handle 0 as present (predicate level)', () => {
    const holed = fromBrep(emptyMesh(), { solid: 0 as unknown as BrepHandle })
    expect(brepOf(holed)).toBe(0)
    expect(hasBrep(holed)).toBe(true)

    // 反例：未挂句柄的 Shape 仍判为「无 BREP」——`!== undefined` 不等于「恒真」。
    expect(brepOf(emptyMesh())).toBeUndefined()
    expect(hasBrep(emptyMesh())).toBe(false)
  })
})
