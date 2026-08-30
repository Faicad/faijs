/**
 * 编译期守卫测试（§7.8 AssertSatisfiesBrepEngineApi）
 *
 * 守卫是类型级断言：适配器实现类型必须静态满足 BrepEngineApi。
 * 本文件的正向/负向断言**由 tsc 验证**（typecheck 覆盖），运行时用例仅占位：
 * - 正向：occt 内核与 memory 引擎的返回类型满足接口（不满足 → tsc 报错）
 * - 负向：不完整实现被拒绝（约束失效时 @ts-expect-error 变为 unused → tsc 报错，
 *   守卫在 typecheck 阶段失效可见）
 */

import { describe, it, expect } from 'vitest'
import type { AssertSatisfiesBrepEngineApi } from './primitives'
import { initOcctWasm } from '../../occt-kernel/occtKernel'
import { createBrepMockApi } from './adapters/brep-mock'

// ── 正向断言：两引擎的 API 类型都满足接口 ──
type _OcctSatisfies = AssertSatisfiesBrepEngineApi<Awaited<ReturnType<typeof initOcctWasm>>>
type _BrepMockSatisfies = AssertSatisfiesBrepEngineApi<ReturnType<typeof createBrepMockApi>>

// ── 负向断言：不完整实现必须被拒绝 ──
// @ts-expect-error — 缺少 BrepEngineApi 的大多数方法（release 不足以满足接口）
type _IncompleteRejected = AssertSatisfiesBrepEngineApi<{ release(): void }>

describe('编译期守卫 AssertSatisfiesBrepEngineApi（§7.8）', () => {
  it('两引擎 API 满足接口（正向断言由 tsc 编译期保证）', () => {
    // 类型别名已由 tsc 检查；运行时仅确认构造器存在
    expect(typeof createBrepMockApi).toBe('function')
    expect(typeof initOcctWasm).toBe('function')
  })
})
