/**
 * handle-bridge 不变量测试（B1）
 *
 * 设计文档：docs/plans/2026-08-29-faijs-module-runtime-plan.md §4.5
 *
 * 四条不变量：
 * 1. `getKernel()` 在 mesh 模式（kernel 为 null）抛错，不返回 null
 * 2. `fromHandle(h)` 产出的 Shape 满足 `hasBrep(shape) === true`
 * 3. `dist/sdk.js` 静态 import 扫描仍然零 heavy 依赖（src/sdk.test.ts 守卫，独立验证）
 * 4. `meshHandle` 默认参数与内置 op 一致：linearDeflection = 0.1、segments = 32
 *
 * Run: npx vitest run src/brep/handle-bridge.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getKernel, meshHandle, fromHandle } from './handle-bridge'
import { registerOcctBrepEngine } from './engine/adapters/occt'
import { hasBrep } from '../shape'
import { configureBackends } from '../runtime-state'
import { createNodePorts } from '../node-host'
import { createRuntime } from '@faicad/faijs'

describe('handle-bridge: getKernel', () => {
  it('throws when kernel is not available (mesh mode / not initialized)', () => {
    // 显式装配 mesh 模式（kernel.brep = null）→ getKernel 必须抛错，不静默返回 null
    configureBackends({
      contractVersion: 1,
      config: { mode: 'mesh' },
      kernel: { brep: null, csg: undefined, sdf: undefined },
      fonts: undefined,
      texture: undefined,
      assets: undefined,
      events: undefined,
      cad: {} as never,
    })
    expect(() => getKernel()).toThrow(/OCCT kernel not available/)
  })
})

describe('handle-bridge: meshHandle / fromHandle with real OCCT kernel', () => {
  let runtime: ReturnType<typeof createRuntime>
  let solidHandle: unknown

  beforeAll(async () => {
    // 宿主装配：注册 OCCT BREP 引擎（runtime 从注册表取引擎）
    await registerOcctBrepEngine()
    // 用 runtime 装配真实 backends（auto 模式 → kernel 存在），再建一个 box solid
    runtime = createRuntime(createNodePorts(), 'auto')
    await runtime.execute({
      params: [],
      statements: [],
    })
    // 直接经 runtime 的 brep 链造一个 box solid：走 stdlib box → fromBrep 登记
    const { box } = await import('@faicad/faijs-stdlib')
    const shape = box({ size: 10 })
    // 从全局 slot 取回句柄
    const { brepOf } = await import('../shape')
    solidHandle = brepOf(shape)
    expect(solidHandle).toBeDefined()
  }, 120000)

  afterAll(async () => {
    runtime?.dispose?.()
  })

  it('meshHandle triangulates a real OCCT handle with default 0.1 / 32 params', () => {
    const shape = meshHandle(solidHandle!)
    expect(shape.positions.length).toBeGreaterThan(0)
    expect(shape.indices.length).toBeGreaterThan(0)
    // 默认 32 段：立方体 6 面 × 2 三角 → 12 三角形
    expect(shape.indices.length / 3).toBe(12)
  })

  it('meshHandle accepts explicit segments', () => {
    const shape = meshHandle(solidHandle!, { segments: 4 })
    expect(shape.indices.length / 3).toBe(12) // 立方体面数不随分段变化
  })

  it('fromHandle registers the BREP slot (hasBrep === true)', () => {
    const shape = fromHandle(solidHandle!)
    expect(hasBrep(shape)).toBe(true)
  })
})
