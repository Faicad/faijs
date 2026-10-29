/**
 * double-free.test — releaseOwned 幂等；disposeHandle 幂等（不 throw）。
 * 设计文档 §12.1 / 项目红线：scope stack pop/drain 路径遇到 dead entry 是正常
 * 状态机迁移（如 booleanOp 失败分支已 releaseOwned 后 drain 再遍历），不 throw。
 * disposeHandle 也幂等——runtime.disposeSolidHandle 可能在 sweep 后对同一 handle
 * 再调一次（受控 GC 正常路径），不是用户错误。
 */
import { describe, it, expect } from 'vitest'
import { HandleRegistryImpl, GcLessPolicy } from '../../src/smlib-kernel/handleRegistry'

function makeRegistry() {
  const deallocated: number[] = []
  const registry = new HandleRegistryImpl(new GcLessPolicy((ptr) => deallocated.push(ptr)))
  return { registry, deallocated }
}

describe('releaseOwned 幂等性（scope stack/drain 路径）', () => {
  it('releaseOwned 同一句柄两次 → 第二次幂等返回，不 throw', () => {
    const { registry, deallocated } = makeRegistry()
    registry.registerOwned(0x1000)
    registry.releaseOwned(0x1000)
    expect(deallocated).toEqual([0x1000])
    expect(() => registry.releaseOwned(0x1000)).not.toThrow()
    expect(deallocated).toEqual([0x1000])
  })

  it('对未登记 ptr 调 releaseOwned 幂等返回（不 throw）', () => {
    const { registry, deallocated } = makeRegistry()
    registry.releaseOwned(0x9999)
    expect(deallocated).toEqual([])
  })

  it('对 borrowed 句柄调 releaseOwned → 幂等返回（不真删 borrowed）', () => {
    const { registry, deallocated } = makeRegistry()
    registry.registerOwned(0x1000)
    registry.registerBorrowed(0x1100, 0x1000, 'face')
    registry.releaseOwned(0x1100)
    expect(deallocated).toEqual([])
    expect(registry.kindOf(0x1000)).toBe('solid')
  })

  it('lookup 返回 dead tombstone（alive=false）供 kindOf 检测 UAF', () => {
    const { registry } = makeRegistry()
    registry.registerOwned(0x1000)
    registry.releaseOwned(0x1000)
    const e = registry.lookup(0x1000)
    expect(e).not.toBeNull()
    expect(e!.alive).toBe(false)
    expect(registry.kindOf(0x1000)).toBeNull()
  })
})
