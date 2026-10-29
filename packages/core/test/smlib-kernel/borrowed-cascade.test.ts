/**
 * borrowed-cascade.test — owner 释放时级联失效 borrowed 条目（设计文档 §6.2 / §12.1）。
 *
 * 治考古报告 §3.4 悬垂指针：父 solid 释放后，其 face/edge 借用条目必须 alive=false，
 * 后续 kindOf 返回 null（不再按 face/edge 分派 → 避免 UAF）。
 */
import { describe, it, expect } from 'vitest'
import { HandleRegistryImpl, GcLessPolicy } from '../../src/smlib-kernel/handleRegistry'

function makeRegistry() {
  const deallocated: number[] = []
  const registry = new HandleRegistryImpl(new GcLessPolicy((ptr) => deallocated.push(ptr)))
  return { registry, deallocated }
}

describe('borrowed 级联失效', () => {
  it('dispose owner → 所有 borrowed 条目 alive=false；kindOf 返回 null', () => {
    const { registry } = makeRegistry()
    // owner = solid 0x1000
    registry.registerOwned(0x1000)
    // faces/edges borrowed from 0x1000
    registry.registerBorrowed(0x1100, 0x1000, 'face')
    registry.registerBorrowed(0x1200, 0x1000, 'face')
    registry.registerBorrowed(0x1300, 0x1000, 'edge')

    expect(registry.kindOf(0x1100)).toBe('face')
    expect(registry.kindOf(0x1200)).toBe('face')
    expect(registry.kindOf(0x1300)).toBe('edge')

    // release owner
    registry.releaseOwned(0x1000)

    // borrowed entries now dead
    expect(registry.lookup(0x1100)!.alive).toBe(false)
    expect(registry.lookup(0x1200)!.alive).toBe(false)
    expect(registry.lookup(0x1300)!.alive).toBe(false)
    expect(registry.kindOf(0x1100)).toBeNull()
    expect(registry.kindOf(0x1200)).toBeNull()
    expect(registry.kindOf(0x1300)).toBeNull()
  })

  it('新 getSubShapes 复用同地址 upsert → 覆盖旧 dead 条目，重新 alive', () => {
    const { registry } = makeRegistry()
    registry.registerOwned(0x1000)
    registry.registerBorrowed(0x1100, 0x1000, 'face')
    registry.releaseOwned(0x1000)
    expect(registry.kindOf(0x1100)).toBeNull()

    // malloc 复用 0x1100 作为新 solid 0x2000 的 face
    registry.registerOwned(0x2000)
    registry.registerBorrowed(0x1100, 0x2000, 'face')
    expect(registry.kindOf(0x1100)).toBe('face')
    expect(registry.lookup(0x1100)!.alive).toBe(true)
    expect(registry.lookup(0x1100)!.owner).toBe(0x2000)
  })

  it('markConsumedByKernel(owner) 也级联失效 borrowed', () => {
    const { registry } = makeRegistry()
    registry.registerOwned(0x1000)
    registry.registerBorrowed(0x1100, 0x1000, 'face')
    // booleanOp 路径：owner 被内核消耗
    registry.markConsumedByKernel(0x1000)
    expect(registry.lookup(0x1100)!.alive).toBe(false)
  })
})
