/**
 * @vitest-environment node
 *
 * brepkit wasm 初始化入口直呼测试——历史 L1 缺口补账：
 * `initBrepkitWasm` / `isBrepkitInitialized` / `ensureBrepkitDefaultEngine` /
 * `BREPKIT_MESH_ENGINE_ID`。
 *
 * GOTCHA：brepkit-wasm 是有意的可选运行时注入（非声明依赖，同
 * brepkitKernel.test.ts 的 skipIf 模式）——未安装时套件整体 skip 而非 FAIL。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import { initBrepkitWasm, isBrepkitInitialized } from '../../src/brepkit-kernel/brepkitWasm'
import { ensureBrepkitDefaultEngine, BREPKIT_MESH_ENGINE_ID } from '../../src/brep/engine/adapters/brepkit'
import { hasBrepEngine, __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { disposeBrepkit } from '../../src/brepkit-kernel/brepkitKernel'

const require = createRequire(import.meta.url)
let brepkitAvailable = false
try {
  require.resolve('brepkit-wasm')
  brepkitAvailable = true
} catch {
  brepkitAvailable = false
}

const suite = describe.skipIf(!brepkitAvailable)

beforeAll(() => {
  __resetEngineRegistriesForTests()
})

afterAll(() => {
  disposeBrepkit()
  __resetEngineRegistriesForTests()
})

suite('brepkit 初始化入口直呼', () => {
  it('isBrepkitInitialized：init 前后状态翻转（幂等：二次调用共享同一次初始化）', async () => {
    expect(isBrepkitInitialized()).toBe(false)
    const k1 = await initBrepkitWasm()
    const k2 = await initBrepkitWasm()
    expect(isBrepkitInitialized()).toBe(true)
    expect(k2).toBe(k1)
  })

  it('ensureBrepkitDefaultEngine：无引擎时注册 brepkit；已有引擎时 no-op', async () => {
    expect(hasBrepEngine()).toBe(false)
    await ensureBrepkitDefaultEngine()
    expect(hasBrepEngine()).toBe(true)
    // 二次调用：已有引擎 → 不重复注册、不抛
    await ensureBrepkitDefaultEngine()
    expect(hasBrepEngine()).toBe(true)
  })

  it('BREPKIT_MESH_ENGINE_ID 与 defineOp.meshEngines 门禁名同源（恒为 "brepkit"）', () => {
    expect(BREPKIT_MESH_ENGINE_ID).toBe('brepkit')
  })
})
