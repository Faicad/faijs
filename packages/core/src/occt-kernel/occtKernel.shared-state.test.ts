/**
 * occtKernel / brepkitWasm 跨实例共享状态测试（随 0.18.2 发布，2026-09-26）。
 *
 * 背景：CDN 装载的第三方库（sheetmetal/cq-compat/faijs-gears）在 jsDelivr
 * +esm 打包时把 peer `@faicad/faijs` 外部化为**独立模块实例**（根入口与
 * /api/ 子路径是不同 URL → 不同 bundle）。模块级单例导致各实例持有独立的
 * occt/brepkit 内核：库实例内核从未初始化（`occt-wasm kernel not initialized`）
 * 或句柄不互通（`meshShape: Invalid shape ID`）。
 *
 * 修复：内核单例（kernelInstance/initPromise/customInitFn）挂在 globalThis
 * 共享（与 runtime-state.ts 的 `__FAICAD_FAIJS_RUNTIME__` 同款设计）。本测试
 * 钉住共享语义：
 * - 注入挂点写入共享状态（跨"实例"生效的机制前提）；
 * - init 幂等且全局共享（两份代码读同一 globalThis 拿到同一内核）；
 * - dispose 重置并允许重新初始化；
 * - stateVersion 不匹配显式报错（禁止静默混用旧结构）。
 *
 * 注意：真实 occt-wasm 初始化较重（22MB），本测试全部通过 setOcctWasmInitFn
 * 注入 fake，不触碰真实内核；afterEach 彻底清理共享状态，避免污染同 worker
 * 其它测试文件（下一文件的 setup 会重新真实 init）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  setOcctWasmInitFn,
  initOcctWasm,
  getKernel,
  disposeOcctWasm,
} from './occtKernel'
import { setBrepkitWasmInitFn } from '../brepkit-kernel/brepkitWasm'
import type { OcctKernel } from 'occt-wasm'

const OCCT_KERNEL_KEY = '__FAICAD_FAIJS_OCCT_KERNEL__'
const BREPKIT_KERNEL_KEY = '__FAICAD_FAIJS_BREPKIT_KERNEL__'

interface SharedState {
  stateVersion: number
  kernelInstance: unknown
  initPromise: unknown
  customInitFn: unknown
}

function sharedOcctState(): SharedState | undefined {
  return (globalThis as unknown as Record<string, SharedState>)[OCCT_KERNEL_KEY]
}

function sharedBrepkitState(): SharedState | undefined {
  return (globalThis as unknown as Record<string, SharedState>)[BREPKIT_KERNEL_KEY]
}

/** fake kernel 最小形态（测试不用真实 occt-wasm）。 */
function makeFakeKernel(): OcctKernel {
  return {
    fake: true,
    disposed: false,
    [Symbol.dispose]() {
      ;(this as { disposed: boolean }).disposed = true
    },
  } as unknown as OcctKernel
}

beforeEach(() => {
  // 清掉可能残留的真实内核与共享状态，从干净起点开始。
  // 注意：不调用 disposeOcctWasm() —— 真实 occt-wasm 内核没有 Symbol.dispose
  // 实现（该路径仅浏览器宿主使用），这里直接删除共享 key，让下次 init 重建。
  setOcctWasmInitFn(null)
  setBrepkitWasmInitFn(null)
  delete (globalThis as Record<string, unknown>)[OCCT_KERNEL_KEY]
  delete (globalThis as Record<string, unknown>)[BREPKIT_KERNEL_KEY]
})

afterEach(() => {
  setOcctWasmInitFn(null)
  setBrepkitWasmInitFn(null)
  delete (globalThis as Record<string, unknown>)[OCCT_KERNEL_KEY]
  delete (globalThis as Record<string, unknown>)[BREPKIT_KERNEL_KEY]
})

describe('occt kernel globalThis 共享状态', () => {
  it('OCCT-1: setOcctWasmInitFn 写入 globalThis 共享挂点（跨实例生效的机制前提）', () => {
    const fn = async () => makeFakeKernel()
    setOcctWasmInitFn(fn)
    const st = sharedOcctState()
    expect(st).toBeDefined()
    expect(st?.stateVersion).toBe(1)
    // "另一份实例"不 import 本模块，直接读 globalThis 必须看到同一挂点。
    expect(st?.customInitFn).toBe(fn)
  })

  it('OCCT-2: init 幂等——多次调用共享同一次初始化，内核写入共享状态', async () => {
    let calls = 0
    const kernel = makeFakeKernel()
    const fn = async () => {
      calls += 1
      return kernel
    }
    setOcctWasmInitFn(fn)

    const a = await initOcctWasm()
    const b = await initOcctWasm()
    expect(a).toBe(b)
    expect(a).toBe(kernel)
    expect(calls).toBe(1)
    expect(sharedOcctState()?.kernelInstance).toBe(kernel)
    // 同步读入口也返回同一内核。
    expect(getKernel()).toBe(kernel)
  })

  it('OCCT-3: 第二份"实例"通过 globalThis 拿到同一内核（跨实例句柄互通的前提）', async () => {
    const kernel = makeFakeKernel()
    setOcctWasmInitFn(async () => kernel)
    await initOcctWasm()

    // 模拟另一个模块实例：不经过本模块的 getKernel，直接读共享状态。
    const otherInstanceView = sharedOcctState()?.kernelInstance
    expect(otherInstanceView).toBe(kernel)
    expect(otherInstanceView).toBe(getKernel())
  })

  it('OCCT-4: dispose 重置共享状态并允许重新初始化', async () => {
    const k1 = makeFakeKernel()
    const k2 = makeFakeKernel()
    setOcctWasmInitFn(async () => k1)
    await initOcctWasm()
    expect(getKernel()).toBe(k1)

    disposeOcctWasm()
    expect(() => getKernel()).toThrow(/occt-wasm kernel not initialized/)
    expect(sharedOcctState()?.kernelInstance).toBeNull()
    expect(sharedOcctState()?.initPromise).toBeNull()

    // 换挂点后可重新初始化。
    setOcctWasmInitFn(async () => k2)
    await initOcctWasm()
    expect(getKernel()).toBe(k2)
  })

  it('OCCT-5: stateVersion 不匹配显式报错（禁止静默混用旧结构）', () => {
    setOcctWasmInitFn(async () => makeFakeKernel())
    const st = sharedOcctState()
    expect(st).toBeDefined()
    // 模拟旧版实例遗留的共享状态。
    ;(st as { stateVersion: number }).stateVersion = 99
    try {
      expect(() => setOcctWasmInitFn(async () => makeFakeKernel())).toThrow(
        /occt kernel state version mismatch/,
      )
      expect(() => disposeOcctWasm()).toThrow(/occt kernel state version mismatch/)
    } finally {
      // 恢复版本号，避免污染后续测试的 beforeEach 清理。
      ;(st as { stateVersion: number }).stateVersion = 1
    }
  })
})

describe('brepkit kernel globalThis 共享状态', () => {
  it('BREPKIT-1: setBrepkitWasmInitFn 写入共享挂点并清空进行中的初始化', () => {
    const fn = async () => ({ fake: true as const })
    setBrepkitWasmInitFn(fn)
    const st = sharedBrepkitState()
    expect(st).toBeDefined()
    expect(st?.stateVersion).toBe(1)
    expect(st?.customInitFn).toBe(fn)

    // 重新注入会清空 initPromise（下一次 init 用新挂点重来）。
    setBrepkitWasmInitFn(async () => ({ fake: true as const }))
    expect(sharedBrepkitState()?.initPromise).toBeNull()
  })

  it('BREPKIT-2: 跨实例共享挂点——另一份实例直接读 globalThis 看到同一 init 函数', () => {
    const fn = async () => ({ fake: true as const })
    setBrepkitWasmInitFn(fn)
    expect(sharedBrepkitState()?.customInitFn).toBe(fn)
  })
})
