/**
 * smlib 平面二分（`cad.splitByPlane`）回归 —— 端侧 test:ops 两条 `ConvertToPolyBrep failed` 的真身。
 *
 * 症状：`cad.box(..., {centered:true})` 再 `splitByPlane({point:[0,0,15]})` —— z=15 是居中 box
 * 的**顶面**，平面只擦过实体、一侧为空。旧 smlib 适配器不看这个前提，直接拿一个与顶面
 * **共面**的半空间盒做布尔减，产出带瑕疵的 BREP，随后三角化报
 * `smw_tessellate failed: ConvertToPolyBrep failed`（错误信息指向三角化，根因在分割）。
 *
 * 对齐目标 = occt 适配器：只擦过 / 整体在一侧时抛
 * `splitByPlane: expected 2 solids, got 1`（`occt-primitives.ts:244`）。
 */
import { describe, it, expect } from 'vitest'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerSmlibBrepEngine } from '../../src/brep/engine/adapters/smlib'
import { createEditorRuntime } from '../support/editor-ops'

function ports(): HostPorts {
  return { events: { emit: () => undefined } }
}

async function run(script: string): Promise<ExecutionResult> {
  __resetEngineRegistriesForTests()
  await registerSmlibBrepEngine()
  return createEditorRuntime(ports(), 'brep').execute(script)
}

/** 居中 box(10,20,30) 体积 6000；过半平面切两半各 3000。 */
const HALF = 3000
const WHOLE = 6000

describe('smlib splitByPlane', () => {
  it('中面切割：两半各 3000，且都能三角化（不再 ConvertToPolyBrep failed）', async () => {
    const r = await run(`let part0 = cad.box(10, 20, 30, { centered: true })
let { positive, negative } = await cad.splitByPlane(part0, { point: [0, 0, 0], normal: [0, 0, 1] })
let vp = cad.volume(positive)
let vn = cad.volume(negative)
if (Math.abs(vp - ${HALF}) > 1) throw 'positive volume=' + vp
if (Math.abs(vn - ${HALF}) > 1) throw 'negative volume=' + vn
`)
    expect(r.failedAt?.message ?? null).toBeNull()
    expect(r.outputs.get('positive' as never)).toBeDefined()
    expect(r.outputs.get('negative' as never)).toBeDefined()
  })

  it('非居中方体（z∈[0,30]）在 z=15 切：两半各 3000', async () => {
    const r = await run(`let part0 = cad.box(10, 20, 30)
let { positive, negative } = await cad.splitByPlane(part0, { point: [0, 0, 15], normal: [0, 0, 1] })
let vp = cad.volume(positive)
let vn = cad.volume(negative)
if (Math.abs(vp - ${HALF}) > 1) throw 'positive volume=' + vp
if (Math.abs(vn - ${HALF}) > 1) throw 'negative volume=' + vn
`)
    expect(r.failedAt?.message ?? null).toBeNull()
  })

  it('斜切（法向 [1,1,1] 过中心）：体积守恒 6000', async () => {
    const r = await run(`let part0 = cad.box(10, 20, 30, { centered: true })
let { positive, negative } = await cad.splitByPlane(part0, { point: [0, 0, 0], normal: [1, 1, 1] })
let vp = cad.volume(positive)
let vn = cad.volume(negative)
if (Math.abs(vp + vn - ${WHOLE}) > 1) throw 'sum=' + (vp + vn)
`)
    expect(r.failedAt?.message ?? null).toBeNull()
  })

  it('平面只擦过顶面（居中 box @ z=15）→ 与 occt 同文案拒绝，不进内核布尔', async () => {
    const r = await run(`let part0 = cad.box(10, 20, 30, { centered: true })
let { positive, negative } = await cad.splitByPlane(part0, { point: [0, 0, 15], normal: [0, 0, 1] })
`)
    expect(r.failedAt).toBeDefined()
    expect(r.failedAt!.message).toContain('splitByPlane: expected 2 solids, got 1')
    expect(r.failedAt!.message).not.toContain('ConvertToPolyBrep')
  })

  it('平面在实体之外（z=100）→ 同样拒绝', async () => {
    const r = await run(`let part0 = cad.box(10, 20, 30, { centered: true })
let { positive, negative } = await cad.splitByPlane(part0, { point: [0, 0, 100], normal: [0, 0, 1] })
`)
    expect(r.failedAt).toBeDefined()
    expect(r.failedAt!.message).toContain('splitByPlane: expected 2 solids, got 1')
  })
})
