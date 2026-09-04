/**
 * lib-id — content-addressable library identity (B2), §7.3.
 *
 * Focus regression: computeLibId must NEVER throw on arbitrary third-party
 * module exports. A real library namespace may carry a module-namespace
 * subobject (e.g. `export * as sub from './x'`) whose coercion via String()
 * throws "Cannot convert object to primitive value" (exotic namespace objects
 * have no `toString`/`valueOf` and no safe `Symbol.toPrimitive`). Registration
 * must degrade to a stable per-object encoding instead of breaking registerLib.
 */

import { describe, expect, it } from 'vitest'
import { computeLibId } from './lib-id'

function fn(body: string): () => unknown {
  return new Function(`return ${body}`)() as () => unknown
}

/** Placeholder "namespace" containing the given export entries. */
function ns(entries: Record<string, unknown>): Record<string, unknown> {
  return { external: fn('(p) => p.a'), ...entries }
}

/**
 * Build an exotic object whose string coercion throws like a module namespace:
 * null prototype → no `toString`/`valueOf`, and `Symbol.toPrimitive` returns a
 * non-primitive so `String(v)` throws "Cannot convert object to primitive value".
 */
function exoticNamespace(inner: Record<string, unknown> = {}): Record<string, unknown> {
  const target = Object.create(null) as Record<string, unknown>
  for (const [k, v] of Object.entries(inner)) target[k] = v
  Object.defineProperty(target, Symbol.toPrimitive, {
    value: () => ({}), // hint ignored → returns object → String() throws
    configurable: true,
  })
  return target
}

describe('computeLibId — stable, throw-free identity (B2 / P-lib)', () => {
  it('① 纯函数命名空间：源码变化 → libId 变化', () => {
    const a = ns({})
    const b = ns({ external: fn('(p) => p.b') })
    expect(computeLibId('gear', a)).not.toBe(computeLibId('gear', b))
  })

  it('② 相同命名空间重复计算 → libId 稳定相等', () => {
    const a = ns({ thread: fn('(p) => p.t') })
    expect(computeLibId('gear', a)).toBe(computeLibId('gear', a))
  })

  it('③ 含 exotic 子命名空间对象：String(v) 抛 → computeLibId 不抛且稳定', () => {
    const exotic = exoticNamespace()
    expect(() => String(exotic)).toThrow() // 前提确认：正常 String 会炸
    const libNs = ns({ sub: exotic })
    let id: string
    expect(() => {
      id = computeLibId('gear', libNs)
    }).not.toThrow()
    expect(id!).toMatch(/^[0-9a-f]{8}$/)
    expect(computeLibId('gear', libNs)).toBe(id!)
  })

  it('④ 子命名空间内容变化 → libId 变化（递归折叠进 hash）', () => {
    const subA = exoticNamespace({ f: fn('(p) => p.a') })
    const subB = exoticNamespace({ f: fn('(p) => p.b') })
    expect(subA).not.toEqual(subB)
    expect(computeLibId('gear', { sub: subA })).not.toBe(computeLibId('gear', { sub: subB }))
  })

  it('⑤ 循环引用对象不炸（[Circular] 占位）', () => {
    const circle: Record<string, unknown> = {}
    circle.self = circle
    const libNs = ns({ meta: circle })
    expect(() => computeLibId('gear', libNs)).not.toThrow()
  })
})