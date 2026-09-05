/**
 * @vitest-environment node
 *
 * CadRuntime.check() dryRun 测试 (P3-6)
 *
 * 测试内容（阶段 4 三阶段：parse + symbol + reference）：
 * 1. 合法脚本 → ok: true
 * 2. parse 错误 → ok: false, stage: 'parse'
 * 3. 符号错误（未知 callee）→ ok: false, stage: 'symbol'
 * 4. 引用预检（安全网，parser 已拦截大多数引用错误）
 *
 * Run: npx vitest run src/cad-runtime/check.test.ts
 */

import { describe, it, expect } from 'vitest'
import { asPartName } from '../identity'
import { createRuntime } from './runtime'
import type { HostPorts, EventSink } from './ports'

class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []
  emit(event: string, detail: Record<string, unknown>): void {
    this.events.push({ event, detail: { ...detail } })
  }
}

function makeRuntime() {
  const ports: HostPorts = { events: new TestEventSink() }
  return createRuntime(ports)
}

describe('CadRuntime.check() — dryRun validation', () => {
  it('valid script: single box → ok', () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0 = cad.box(20, 20, 20, { centered: true })
  return { shape: part0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.script).toBeDefined()
    expect(result.script!.statements).toBe(1)
    expect(result.script!.callees).toEqual(['box'])
  })

  it('valid script: box + sphere boolean subtract → ok', () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0 = cad.box(20, 20, 20, { centered: true })
  const part1 = cad.sphere({ radius: 8, center: [5, 0, 0] })
  const part2 = cad.subtract(part0, part1)
  return { shape: part2 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
    expect(result.script!.callees).toEqual(['box', 'sphere', 'subtract'])
  })

  it('valid script with params → ok', () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const radius = 5
  const part0 = cad.sphere({ radius: radius })
  return { shape: part0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
    expect(result.script!.statements).toBe(1)
  })

  it('split destructure: referencing an output id later → ok', () => {
    // 文档标准形态：split 解构后引用 back 输出 part2（issue: check() 误报 undefined input）
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0 = cad.box(20, 20, 20, { centered: true })
  const { front: part1, back: part2 } = await cad.fai_split(part0, { normal: [0, 0, 1], offset: 0 })
  const part3 = cad.translate({ offset: [5, 0, 0] }, part2)
  return { shape: part3 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.script!.callees).toEqual(['box', 'fai_split', 'translate'])
  })

  it('reference precheck: undefined split output id → ok=false', () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0 = cad.box(20, 20, 20, { centered: true })
  const { front: part1, back: part2 } = await cad.fai_split(part0, { normal: [0, 0, 1], offset: 0 })
  const part3 = cad.translate({ offset: [5, 0, 0] }, part999)
  return { shape: part3 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(false)
  })

  it('parse error: invalid JS → ok=false, stage=parse', () => {
    const code = `export default async (cad) => {
  const part0 = cad.box({ size: 20
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].stage).toBe('parse')
  })

  it('parse error: not a default export and not valid flat code → ok=false, stage=parse', () => {
    // flat code 支持：`const x = 42` 现在是合法的扁平代码
    // 真正无效的输入：语法错误
    const code = `export default {`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(false)
    expect(result.errors[0].stage).toBe('parse')
  })

  it('parse error: undefined identifier → ok=false, stage=parse', () => {
    // Parser catches undefined identifiers (part999 not in scope)
    const code = `export default async (cad) => {
  const part0 = cad.translate({ offset: [5, 0, 0] }, part999)
  return { shape: part0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(false)
    expect(result.errors[0].stage).toBe('parse')
  })

  it('symbol error: unknown callee → ok=false, stage=symbol', () => {
    const code = `export default async (cad) => {
  const part0 = cad.bogusFn({ size: 20 })
  return { shape: part0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(false)
    const symbolErrors = result.errors.filter((e) => e.stage === 'symbol')
    expect(symbolErrors.length).toBeGreaterThan(0)
    expect(symbolErrors[0].message).toContain('bogusFn')
  })

  it('member method calls are exempt from symbol check (receiver present)', () => {
    // 成员方法（asm.do_assemble）不在符号表（对象方法），receiver 非空时不查符号表
    const code = `export default async (cad) => {
  const part0 = cad.box(20, 20, 20, { centered: true })
  const asm0 = cad.assembly({ members: [part0] })
  asm0.do_assemble()
  return { shape: part0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('check is zero-geometry-side-effect: no OCCT init needed', () => {
    const code = `export default async (cad) => {
  const part0 = cad.box(20, 20, 20, { centered: true })
  return { shape: part0 }
}`
    const runtime = makeRuntime()
    const result = runtime.check(code)
    expect(result.ok).toBe(true)
    // No brepChain, no outputs — check is pure text validation
    expect(runtime.getCachedOutput(asPartName('part0'))).toBeUndefined()
  })

  it('check provides structured context for AI self-correction', () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0 = cad.box(20, 20, 20, { centered: true })
  const part1 = cad.sphere({ radius: 10 })
  const part2 = cad.union(part0, part1)
  return { shape: part2 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
    expect(result.script).toBeDefined()
    expect(result.script!.statements).toBe(3)
    expect(result.script!.callees).toEqual(['box', 'sphere', 'union'])
  })
})
