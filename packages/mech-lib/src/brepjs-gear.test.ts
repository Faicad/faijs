/**
 * C1 — brepjs-gear adapter 单测（fixture 库）
 *
 * 设计文档：docs/plans/2026-08-29-faijs-module-runtime-plan.md §6 / §7.4 C1
 *
 * 直接测 adapter（libs/brepjs-gear.ts）的契约：
 * 1. contractVersion = 1（registerLib 版本契约）
 * 2. 内核注入经 getBackends().kernel.brep（auto 模式 + 热身执行后非空），零 shim
 * 3. 齿轮 API：external / internal / planetary 产出 faijs Shape 且 hasBrep === true
 * 4. 所有权三态：模块级 pinned 递增（只钉不释 §6.3）；同内核再建不抛错
 * 5. 错误转译：非法入参 → throw（携带 brepjs error code + message，不静默）
 * 6. 几何交叉校验：brepjs GearResult 的 pitch/tip/base/root 直径与 adapter 网格外径一致
 *
 * Run: npx vitest run test/faijs/libs/brepjs-gear.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm } from '@faicad/faijs-core'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs-core/node'
import { hasBrep } from '@faicad/faijs-core/shape'
import { CONTRACT_VERSION } from '@faicad/faijs-core/sdk'
import { makeExternalGear } from 'brepjs'
import * as gear from './brepjs-gear'

// 预热：让内核就绪（getBackends().kernel.brep 非空）且 backends 已配置。
// 保持 runtime 存活——kernel getter 从运行中的实例读 brepChain。
// 宿主时序（§6.4）：先建 runtime + 执行，再加载/使用 adapter（每次 run 加载一次）。
let runtime: ReturnType<typeof createRuntime>
beforeAll(async () => {
  await initOcctWasm()
  runtime = createRuntime(createNodePorts(), 'auto')
  // 触发 ensureBrepChain：一条最简 box 语句即可将环境内核接进 brepChain
  await runtime.execute('let a = cad.box({ size: [1, 1, 1] })')
  // 触发 adapter 模块级一次注册：brepjs 全局 kernel 就绪，后续测试共享
  await gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })
}, 120000)

describe('C1 brepjs-gear adapter', () => {
  it(`exports contractVersion = ${CONTRACT_VERSION}（registerLib 版本契约）`, () => {
    expect(typeof gear.contractVersion).toBe('number')
    expect(gear.contractVersion).toBe(CONTRACT_VERSION)
  })

  it('external() 产制 faijs Shape 且 hasBrep === true（含非空网格）', async () => {
    const shape = await gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })
    expect(shape).toBeDefined()
    expect(hasBrep(shape)).toBe(true)
    expect(shape.positions.length).toBeGreaterThan(0)
    expect(shape.indices.length).toBeGreaterThan(0)
  })

  it('internal() 产出内齿圈 BREP（hasBrep === true）', async () => {
    const shape = await gear.internal({ teeth: 48, moduleSize: 2, thickness: 8 })
    expect(hasBrep(shape)).toBe(true)
    expect(shape.positions.length).toBeGreaterThan(0)
  })

  it('planetary() 合成 CompoundShape（sun+planets+ring 各含 BREP）', () => {
    const c = gear.planetary({ thickness: 8, sunTeeth: 12, planetTeeth: 6, numPlanets: 3 })
    expect(c.kind).toBe('compound')
    expect(c.children.length).toBeGreaterThanOrEqual(5) // sun + 3 planets + ring
    for (const child of c.children) {
      expect(hasBrep(child)).toBe(true)
    }
  })

  it('模块级 pinned 数组递增：只钉不释（§6.3）', async () => {
    const before = gear.pinnedCount()
    await gear.external({ teeth: 16, moduleSize: 2, thickness: 4 })
    await gear.external({ teeth: 20, moduleSize: 3, thickness: 6 })
    const after = gear.pinnedCount()
    expect(after).toBeGreaterThanOrEqual(before + 2) // 每个产物钉住一次
  })

  it('thread()（C5 第二类 op）：产出 BREP 螺纹且错误转译同协议', async () => {
    const shape = await gear.thread({ radius: 10, pitch: 2, height: 12 })
    expect(shape).toBeDefined()
    expect(hasBrep(shape)).toBe(true)
    expect(shape.positions.length).toBeGreaterThan(0)
    // 同一错误转译：非法入参 → throw 携带 THREAD_* code
    await expect(gear.thread({ radius: 0, pitch: 2, height: 12 })).rejects.toThrowError(
      /THREAD_INVALID_RADIUS|radius must be > 0/,
    )
  })

  it('错误转译：非法入参 → throw（携带 brep3 code + message，不静默）', async () => {
    await expect(gear.external({ teeth: 24, moduleSize: 2, thickness: 0 })).rejects.toThrowError(
      /GEAR_THICKNESS_NONPOSITIVE|thickness must be > 0/,
    )
    await expect(gear.external({ teeth: 2, moduleSize: 2, thickness: 8 })).rejects.toThrowError(
      /GEAR_TEETH_TOO_FEW|≥ 4/,
    )
  })

  it('几何交叉校验（brep3 GearResult 字段）：pitch/tip/base/root 直径 + 网格外径', async () => {
    const r = makeExternalGear({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })
    if (!r.ok) throw new Error('brep3 makeExternalGear failed: ' + String(r.error))
    const { pitchDiameter, tipDiameter, baseDiameter, rootDiameter } = r.value
    expect(pitchDiameter).toBeCloseTo(24 * 2, 6) // m×z = 48
    expect(tipDiameter).toBeCloseTo(2 * (24 + 2), 6) // m×(z+2) = 52
    expect(baseDiameter).toBeGreaterThan(0)
    expect(rootDiameter).toBeGreaterThan(0)
    // adapter 产出的 Shape 承受同一几何：网格外径≈tip/2
    const shape = await gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })
    let xyMax = -Infinity
    for (let i = 0; i < shape.positions.length; i += 3) {
      const x = Math.abs(shape.positions[i])
      const y = Math.abs(shape.positions[i + 1])
      const m = Math.max(x, y)
      if (m > xyMax) xyMax = m
    }
    expect(xyMax).toBeGreaterThan(0)
    expect(xyMax).toBeLessThanOrEqual(tipDiameter / 2 + 1)
  })

  it('brep-only（D1b）：mesh 模式调用 → MeshUnsupportedError（不崩溃不静默）', async () => {
    const meshRuntime = createRuntime(createNodePorts(), 'mesh')
    meshRuntime.registerLib('gear', gear as never)
    const result = await meshRuntime.execute([
      "import * as gear from 'brepjs-gear'",
      'let a = gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })',
    ].join('\n'))
    expect(result.failedAt).toBeDefined()
    expect(result.failedAt!.message).toMatch(/E_MESH_UNSUPPORTED/)
  })
})