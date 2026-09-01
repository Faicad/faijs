/**
 * P2 · D10 内核单实例断言 + occtWasm 适配器冒烟
 *
 * 来源：docs/plans/2026-09-01-layered-api-architecture.md §D10 / P2 / §9
 *
 * 目标:
 *  1. 单实例禁令：移植的 `kernel/occtWasm` 适配器建立在 faijs 唯一的
 *     occt-wasm 实例之上（`initOcctWasm` 链路）。断言桥接后适配器 pin 住的
 *     kernel owner 与 faijs 侧拿到的 `OcctKernel` 是**同一个对象**——若适配器
 *     自载第二份 wasm，两个实例句柄分属不同指针空间，hasBrep/brepOf/面演化
 *     全部静默错乱（D10）。
 *  2. getKernel 冻结（D10）：绑定后 registry freeze，二次注册抛错；且
 *     bindOcctKernel 幂等（重复调用返回同实例）。
 *  3. 冒烟：通过移植适配器真的能 makeBox / fuse / isValid——证明已投运的
 *     occtWasm 移植树（7.8k 行）不是只过了类型检查，而是能执行。
 *
 * Run: npx vitest run faijs/d10-occt-single-instance
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm, getKernel as getHostKernel } from '@faicad/faijs-core/occt-kernel/occtKernel'
import { bindOcctKernel, getBrepjsKernel, isOcctKernelBound } from '@faicad/faijs-core/api/occt-kernel-bridge'
import { getKernel as getBrepjsRegistry, registerKernel, getActiveKernelId } from '@faicad/faijs-core/vendored/brepjs/kernel/index'

describe('D10 · occt-wasm 单实例绑定 + 冻结', () => {
  beforeAll(async () => {
    // 宿主装配：initOcctWasm 完成（与 registerOcctBrepEngine 同链路）
    await initOcctWasm()
  }, 120000)

  it('P2-1 单实例：绑定后适配器 pin 住的 kernel 与 faijs host 内核同一对象', () => {
    const adapter = bindOcctKernel()
    const hostKernel = getHostKernel()
    // occtWasmAdapter.retainedKernelOwner 即 fromKernel 传入的 OcctKernelOwner
    const owner = (adapter as unknown as { retainedKernelOwner?: unknown }).retainedKernelOwner
    expect(owner).toBe(hostKernel) // 同一 wasm 实例（D10 单实例禁令）
    expect(isOcctKernelBound()).toBe(true)
    expect(getActiveKernelId()).toBe('occt-wasm')
  })

  it('P2-冻结：绑定幂等——重复 bind 返回同一实例、不再注册', () => {
    const a = bindOcctKernel()
    const b = bindOcctKernel()
    expect(a).toBe(b) // 只注册一次，冻结后读取 getBrepjsKernel
    expect(getBrepjsKernel()).toBe(a)
  })

  it('P2-冻结：注册后 registry 冻结——二次 registerKernel 抛错', () => {
    // 另一个适配器（不从 host 构造，仅验证 registry 拒绝二次注册）
    const bogusAdapter = {} as Parameters<typeof registerKernel>[1]
    expect(() => registerKernel('occt-wasm', bogusAdapter)).toThrow(/frozen|assembl/i)
  })

  it('P2-smoke：移植的 occtWasm 适配器真的能建模（box + fuse + isValid）', async () => {
    const adapter = getBrepjsKernel()
    expect(adapter.kernelId).toBe('occt-wasm')
    const box = adapter.makeBox(10, 12, 14)
    expect(adapter.isValid(box)).toBe(true)
    const tool = adapter.makeBox(8, 8, 8)
    const fused = adapter.fuse(box, tool, undefined)
    expect(adapter.isValid(fused)).toBe(true)
    expect(adapter.hashCode(fused, 1000)).toBeGreaterThanOrEqual(0)
    // 释放临时句柄（arena——checkpoint 由适配器管理）
    try {
      adapter.dispose(fused)
    } catch {
      // dispose no-op 亦可（arena 释放）
    }
  })

  it('P2-只读读取器：冻结后仍能读取注册的默认内核与 id', () => {
    const adapter = getBrepjsKernel()
    expect(getBrepjsRegistry('occt-wasm')).toBe(adapter)
  })
})