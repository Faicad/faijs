/**
 * scope-stack.test — per-statement RAII 作用域栈（设计文档 §5 / §12.1）。
 *
 * push → track 3 个 owned → pop(escape={1}) → 另 2 个被 releaseOwned；
 * escaped 的不被释放。
 */
import { describe, it, expect } from 'vitest'
import { HandleRegistryImpl, GcLessPolicy } from '../../src/smlib-kernel/handleRegistry'

function makeRegistry() {
  const deallocated: number[] = []
  const registry = new HandleRegistryImpl(new GcLessPolicy((ptr) => deallocated.push(ptr)))
  return { registry, deallocated }
}

describe('per-statement 作用域栈', () => {
  it('push → track → pop(escape={1}) 释放其余临时 owned', () => {
    const { registry, deallocated } = makeRegistry()
    registry.scope.push('stmt@1')
    registry.registerOwned(0x1000)
    registry.registerOwned(0x2000)
    registry.registerOwned(0x3000)

    // 0x1000 是本语句产物，存入 solidCache → escape
    registry.escape(0x1000)

    // pop: escapePtrs = {0x1000}
    registry.scope.pop(new Set([0x1000]))

    expect(deallocated.sort()).toEqual([0x2000, 0x3000].sort())
    expect(registry.kindOf(0x1000)).toBe('solid')
    expect(registry.kindOf(0x2000)).toBeNull()
    expect(registry.kindOf(0x3000)).toBeNull()
  })

  it('无活动帧时 registerOwned 不 track，releaseAllExcept 兜底', () => {
    const { registry, deallocated } = makeRegistry()
    // 不 push（模拟 GC 型引擎或未接线时）
    registry.registerOwned(0x1000)
    expect(registry.scope.currentScopeId()).toBeNull()
    // pop 无帧 → no-op
    registry.scope.pop(new Set())
    expect(deallocated).toEqual([])
    // releaseAllExcept 仍能清扫
    registry.releaseAllExcept(new Set())
    expect(deallocated).toEqual([0x1000])
  })

  it('drain 排空多层残留帧（失败路径兜底）', () => {
    const { registry, deallocated } = makeRegistry()
    registry.scope.push('stmt@1')
    registry.registerOwned(0x1000)
    registry.scope.push('stmt@2')
    registry.registerOwned(0x2000)
    // 异常中断，没走到 pop
    registry.scope.drain(new Set())
    expect(deallocated.sort()).toEqual([0x1000, 0x2000].sort())
    expect(registry.aliveOwnedCount()).toBe(0)
  })

  it('嵌套帧：内层 pop 不影响外层 track 的句柄', () => {
    const { registry, deallocated } = makeRegistry()
    registry.scope.push('outer')
    registry.registerOwned(0x1000)
    registry.scope.push('inner')
    registry.registerOwned(0x2000)
    registry.scope.pop(new Set([0x1000])) // inner pop, escape outer handle
    expect(deallocated).toEqual([0x2000]) // inner transient released
    expect(registry.kindOf(0x1000)).toBe('solid')
    registry.scope.pop(new Set()) // outer pop, no escape → 0x1000 released
    expect(deallocated).toEqual([0x2000, 0x1000])
  })
})
