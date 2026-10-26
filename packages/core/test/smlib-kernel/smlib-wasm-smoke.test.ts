/**
 * smlib-kernel/smlib-wasm-smoke — smlib standalone wasm 装载冒烟（node 直跑）
 *
 * P0 验收：vendored `smlib_standalone.wasm` 可在 node 装载，SmApi 导出齐备，
 * context + createBox + booleanUnion 全链路可调、返回合法句柄。
 *
 * 与 brepkit 测试不同：smlib 的 wasm 是 core 包内 vendor 资产（非常依赖），
 * 不需要 skipIf 守卫——缺失即构建/资产问题，应当 FAIL 而非 skip。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initSmlibWasm, resetSmlibWasm, isSmlibInitialized, type SmlibKernel } from '../../src/smlib-kernel/smlibWasm'

// SM_SUCCESS（SmMessages.h: #define SM_SUCCESS 1000L）
const SM_SUCCESS = 1000

let k!: SmlibKernel

beforeAll(async () => {
  k = await initSmlibWasm()
})

afterAll(() => {
  resetSmlibWasm()
})

describe('smlib standalone wasm 装载', () => {
  it('初始化后内核就绪：memory / malloc / free / find 齐备', () => {
    expect(k.memory).toBeDefined()
    expect(typeof k.malloc).toBe('function')
    expect(typeof k.free).toBe('function')
    expect(typeof k.find).toBe('function')
    expect(Object.keys(k.exports).length).toBeGreaterThanOrEqual(190)
    expect(isSmlibInitialized()).toBe(true)
  })

  it('SmApiGetOrCreateContext 返回非零 context', () => {
    const ctx = k.getOrCreateContext()
    expect(ctx).not.toBe(0)
    // 幂等：二次调用返回同一 context
    expect(k.getOrCreateContext()).toBe(ctx)
  })

  it('SmApiCreateBox 返回合法 brep 句柄', () => {
    const mem = new DataView(k.memory.buffer)
    const arg = k.malloc(64)
    try {
      // SmApiCreateBox(const SmVector3d& origin, dx, dy, dz, SmBrep*& out)
      // origin = 3×f64（24 字节）；out = 4 字节指针槽。
      mem.setFloat64(arg, 0, true)      // origin.x
      mem.setFloat64(arg + 8, 0, true)  // origin.y
      mem.setFloat64(arg + 16, 0, true) // origin.z
      mem.setUint32(arg + 24, 0, true)  // out = NULL
      const st = k.find('SmApiCreateBox')(arg, 10, 20, 30, arg + 24)
      expect(st).toBe(SM_SUCCESS)
      const brep = mem.getUint32(arg + 24, true)
      expect(brep).not.toBe(0)
    } finally {
      k.free(arg)
    }
  })

  it('SmApiBooleanUnion 两个 box 返回融合句柄（输入被内核消耗的语义路径可跑通）', () => {
    const mem = new DataView(k.memory.buffer)
    const arg = k.malloc(64)
    try {
      // 建两个 box：a = 10×20×30 在原点；b = 5×5×5 平移 (10,10,10)（贴合 a 一角）。
      mem.setFloat64(arg, 0, true)
      mem.setFloat64(arg + 8, 0, true)
      mem.setFloat64(arg + 16, 0, true)
      mem.setUint32(arg + 24, 0, true)
      const stA = k.find('SmApiCreateBox')(arg, 10, 20, 30, arg + 24)
      expect(stA).toBe(SM_SUCCESS)
      const boxA = mem.getUint32(arg + 24, true)

      mem.setFloat64(arg, 10, true)
      mem.setFloat64(arg + 8, 10, true)
      mem.setFloat64(arg + 16, 10, true)
      mem.setUint32(arg + 24, 0, true)
      const stB = k.find('SmApiCreateBox')(arg, 5, 5, 5, arg + 24)
      expect(stB).toBe(SM_SUCCESS)
      const boxB = mem.getUint32(arg + 24, true)

      // SmApiBooleanUnion(SmBrep* a, SmBrep* b, SmBrep*& out)：a 原地变，b 被内核接管。
      mem.setUint32(arg + 24, 0, true)
      const stU = k.find('SmApiBooleanUnion')(boxA, boxB, arg + 24)
      expect(stU).toBe(SM_SUCCESS)
      const fused = mem.getUint32(arg + 24, true)
      expect(fused).not.toBe(0)
      // 原地语义：out == a（boxA 原地成为结果）
      expect(fused).toBe(boxA)
    } finally {
      k.free(arg)
    }
  })

  it('reset 后重新 init 可得新内核（与 brepkitWasm multi-version 同款收尾路径）', async () => {
    resetSmlibWasm()
    expect(isSmlibInitialized()).toBe(false)
    const k2 = await initSmlibWasm()
    expect(k2.getOrCreateContext()).not.toBe(0)
    resetSmlibWasm()
  })
})
