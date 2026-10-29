/**
 * scope-drain-doublefree.probe — 修复后验证（2026-10-29 评审 1 修复）。
 *
 * 原缺陷：booleanOp 失败路径 releaseOwned(pa/pb) → drainScopeFrames 再 releaseOwned
 * → throw double-free，吞掉真实 SM 错误。
 *
 * 修复后：ScopeStackImpl.pop/drain 对 alive=false tombstone 幂等跳过（不 throw）；
 * double-free throw 守卫保留在公开 disposeHandle API（smlibKernel 层 lookup 检测）。
 */
import { describe, it, expect } from 'vitest'
import { HandleRegistryImpl, GcLessPolicy } from '../../src/smlib-kernel/handleRegistry'

function makeRegistry() {
  const deallocated: number[] = []
  const registry = new HandleRegistryImpl(new GcLessPolicy((ptr) => deallocated.push(ptr)))
  return { registry, deallocated }
}

describe('scope drain × 手动释放交互（修复后：drain 幂等不抛）', () => {
  it('修复验证：booleanOp 失败路径（先 releaseOwned 再 throw）→ drain 幂等跳过，不 throw', () => {
    const { registry, deallocated } = makeRegistry()
    registry.scope.push('s3')
    registry.registerOwned(0x1000)
    registry.registerOwned(0x2000)
    // booleanOp 失败分支：pa/pb 手动 releaseOwned（tombstone alive=false），随后 throw
    registry.releaseOwned(0x1000)
    registry.releaseOwned(0x2000)
    // 语句失败 → runtime.drainScopeFrames → pop 本帧
    // 修复后：对 tombstone 幂等跳过，不 throw double-free
    expect(() => registry.scope.drain(new Set<number>())).not.toThrow()
    // 内核只各释放一次（releaseOwned 时真删）
    expect(deallocated).toEqual([0x1000, 0x2000])
  })

  it('对照：markConsumedByKernel（成功路径）× drain 幂等，逃逸句柄存活', () => {
    const { registry, deallocated } = makeRegistry()
    registry.scope.push('s7')
    registry.registerOwned(0x1000) // pa（布尔结果）
    registry.registerOwned(0x2000) // pb
    // 成功路径：pb 被内核消耗（条目删除，不调 delete）
    registry.markConsumedByKernel(0x2000)
    // 语句成功：pop，pa 逃逸进 solidCache（escape 集），pb 幂等跳过
    registry.scope.drain(new Set([0x1000]))
    expect(registry.lookup(0x1000)?.alive).toBe(true) // 逃逸存活
    expect(registry.lookup(0x2000)).toBeNull() // 已从登记表删除
    expect(deallocated).toEqual([]) // 无真删
  })
})
