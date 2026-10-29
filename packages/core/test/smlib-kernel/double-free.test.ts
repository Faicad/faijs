/**
 * double-free.test — 同一句柄 releaseOwned 两次 → 第二次 throw（不静默吞）。
 * 设计文档 §12.1 / 项目红线：禁止 try-catch 吞异常，double-free 必须暴露。
 */
import { describe, it, expect } from 'vitest'
import { HandleRegistryImpl, GcLessPolicy } from '../../src/smlib-kernel/handleRegistry'

function makeRegistry() {
  const deallocated: number[] = []
  const registry = new HandleRegistryImpl(new GcLessPolicy((ptr) => deallocated.push(ptr)))
  return { registry, deallocated }
}

describe('double-free 守卫', () => {
  it('releaseOwned 同一句柄两次 → 第二次 throw', () => {
    const { registry, deallocated } = makeRegistry()
    registry.registerOwned(0x1000)
    registry.releaseOwned(0x1000)
    expect(deallocated).toEqual([0x1000])
    expect(() => registry.releaseOwned(0x1000)).toThrow(/double-free/)
  })

  it('对未登记 ptr 调 releaseOwned 幂等返回（不 throw）', () => {
    const { registry, deallocated } = makeRegistry()
    // 从未登记的 ptr：releaseOwned 静默返回（幂等，可能是已被 markConsumedByKernel）
    registry.releaseOwned(0x9999)
    expect(deallocated).toEqual([])
  })

  it('对 borrowed 句柄调 releaseOwned → throw（误用检测）', () => {
    const { registry } = makeRegistry()
    registry.registerOwned(0x1000)
    registry.registerBorrowed(0x1100, 0x1000, 'face')
    expect(() => registry.releaseOwned(0x1100)).toThrow(/borrowed/)
  })
})
