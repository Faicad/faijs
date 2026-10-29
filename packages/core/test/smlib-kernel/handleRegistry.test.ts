/**
 * handleRegistry.test — HandleRegistry 基础生命周期：registerOwned / escape / releaseOwned
 * 的状态迁移（设计文档 §12.1）。
 *
 * 不加载 wasm：用 mock policy 记录 dealloc 调用，验证登记表状态机。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { HandleRegistryImpl, GcLessPolicy } from '../../src/smlib-kernel/handleRegistry'

function makeRegistry() {
  const deallocated: number[] = []
  const policy = new GcLessPolicy((ptr) => deallocated.push(ptr))
  const registry = new HandleRegistryImpl(policy)
  return { registry, deallocated }
}

describe('HandleRegistry 基础生命周期', () => {
  it('registerOwned → alive owned；releaseOwned → dealloc + 移除', () => {
    const { registry, deallocated } = makeRegistry()
    registry.registerOwned(0x1000)
    expect(registry.aliveOwnedCount()).toBe(1)
    expect(registry.kindOf(0x1000)).toBe('solid')

    registry.releaseOwned(0x1000)
    expect(deallocated).toEqual([0x1000])
    expect(registry.aliveOwnedCount()).toBe(0)
    expect(registry.kindOf(0x1000)).toBeNull()
  })

  it('escape 标记后 releaseAllExcept 不删逃逸句柄', () => {
    const { registry, deallocated } = makeRegistry()
    registry.registerOwned(0x2000)
    registry.registerOwned(0x3000)
    registry.escape(0x2000)

    registry.releaseAllExcept(new Set([0x2000]))
    expect(deallocated).toEqual([0x3000])
    expect(registry.aliveOwnedCount()).toBe(1)
    expect(registry.kindOf(0x2000)).toBe('solid')
    expect(registry.kindOf(0x3000)).toBeNull()
  })

  it('markConsumedByKernel 移除条目但不调 dealloc（内核已删）', () => {
    const { registry, deallocated } = makeRegistry()
    registry.registerOwned(0x4000)
    registry.markConsumedByKernel(0x4000)
    expect(deallocated).toEqual([])
    expect(registry.aliveOwnedCount()).toBe(0)
    expect(registry.lookup(0x4000)).toBeNull()
  })

  it('assertAlive 对未登记 ptr throw；对已释放 ptr throw', () => {
    const { registry } = makeRegistry()
    registry.registerOwned(0x5000)
    registry.releaseOwned(0x5000)
    expect(() => registry.assertAlive(0x5000, 'test')).toThrow(/UAF/)
    expect(() => registry.assertAlive(0x9999, 'test')).toThrow(/unknown handle/)
  })
})
