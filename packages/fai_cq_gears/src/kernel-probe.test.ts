/**
 * kernel-probe — 内核能力守卫
 *
 * `RawOcctKernel` 断言了 faijs 中立面（`BrepEngineApi`）之外的 occt-wasm 原始能力。
 * occt-wasm 是预编译 wasm + JS 绑定，**方法名变了不会有任何编译期信号**——
 * 只有运行到那一行才会 `undefined is not a function`。
 *
 * 本测试把「契约」钉在运行时：内核一升级/改名，这里立刻变红。
 */

import { describe, expect, it } from 'vitest'
import { getRawKernel, RAW_KERNEL_METHODS } from './kernel'

describe('RawOcctKernel 能力面', () => {
  it('initOcctWasm 返回的实例具备 RAW_KERNEL_METHODS 全部方法', async () => {
    const kernel = await getRawKernel()
    const missing = RAW_KERNEL_METHODS.filter((m) => typeof kernel[m] !== 'function')
    expect(missing, `内核缺少方法：${missing.join(', ')}`).toEqual([])
  })

  it('RAW_KERNEL_METHODS 无重复项（清单本身的自检）', () => {
    const set = new Set<string>(RAW_KERNEL_METHODS)
    expect(set.size).toBe(RAW_KERNEL_METHODS.length)
  })

  it('同一进程内 getRawKernel() 是同一个实例（句柄不能跨实例）', async () => {
    const a = await getRawKernel()
    const b = await getRawKernel()
    expect(b).toBe(a)
  })

  it('基础几何自检：makeBox + getVolume', async () => {
    const kernel = await getRawKernel()
    const box = kernel.makeBoxFromCorners({ x: -5, y: -10, z: -15 }, { x: 5, y: 10, z: 15 })
    expect(kernel.isSolid(box)).toBe(true)
    expect(kernel.getVolume(box)).toBeCloseTo(6000, 6)
  })
})
