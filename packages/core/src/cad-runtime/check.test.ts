/**
 * @vitest-environment node
 *
 * CadRuntime.check() dryRun 测试 (P3-6)
 *
 * T5 后：module 路径已删除，check() 只做语法门禁（extractMetadata = acorn parse +
 * 语句摘要），不做符号检查和引用预检（这些在运行时暴露）。
 *
 * 测试内容：
 * 1. 合法脚本 → ok: true
 * 2. parse 错误 → ok: false, stage: 'parse'
 * 3. 未定义引用/未知 callee → acorn 能 parse → ok: true（运行时暴露）
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
    // 文档标准形态：split 解构后引用 back 输出 part2
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

  it('reference precheck: undefined identifier → ok=false (extractMetadata catches E_REFERENCE)', () => {
    // extractMetadata checks references: unknown identifiers throw E_REFERENCE.
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0 = cad.box(20, 20, 20, { centered: true })
  const { front: part1, back: part2 } = await cad.fai_split(part0, { normal: [0, 0, 1], offset: 0 })
  const part3 = cad.translate({ offset: [5, 0, 0] }, part999)
  return { shape: part3 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
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

  it('unknown callee: acorn parses → ok=true (runtime exposes)', () => {
    // T5: direct-only check() does not do symbol checking — acorn parses any valid
    // function call. Unknown callees surface at runtime.
    const code = `export default async (cad) => {
  const part0 = cad.bogusFn({ size: 20 })
  return { shape: part0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
  })

  it('member method calls are valid syntax', () => {
    // 成员方法（asm.do_assemble）语法合法，check() 放行
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
