/**
 * @vitest-environment node
 *
 * CadRuntime.check() dryRun 测试 (P3-6)
 *
 * 测试内容：
 * 1. 合法脚本 → ok: true
 * 2. parse 错误 → ok: false, stage: 'parse'
 * 3. schema 错误（unknown key）→ ok: false, stage: 'schema'
 * 4. 引用预检（安全网，parser 已拦截大多数引用错误）
 *
 * Run: npx vitest run src/cad-runtime/check.test.ts
 */

import { describe, it, expect } from 'vitest'
import { createRuntime } from './runtime'
import type { HostPorts, EventSink } from './ports'

class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []
  emit(event: 'brep-chain-broken', detail: { partId: string; op: string; reason: string }): void {
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
  const part0_v0 = cad.box({ size: 20 })
  return { shape: part0_v0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.script).toBeDefined()
    expect(result.script!.statements).toBe(1)
    expect(result.script!.ops).toEqual(['box'])
  })

  it('valid script: box + sphere boolean subtract → ok', () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  const part0_v1 = cad.sphere({ radius: 8, center: [5, 0, 0] })
  const part0_v2 = cad.subtract(part0_v0, part0_v1)
  return { shape: part0_v2 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
    expect(result.script!.ops).toEqual(['box', 'sphere', 'boolean'])
  })

  it('valid script with params → ok', () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const radius = 5
  const part0_v0 = cad.sphere({ radius: radius })
  return { shape: part0_v0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
    expect(result.script!.statements).toBe(1)
  })

  it('parse error: invalid JS → ok=false, stage=parse', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].stage).toBe('parse')
  })

  it('parse error: not a default export → ok=false, stage=parse', () => {
    const code = `const x = 42`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(false)
    expect(result.errors[0].stage).toBe('parse')
  })

  it('parse error: undefined identifier → ok=false, stage=parse', () => {
    // Parser catches undefined identifiers (part0_v999 not in scope)
    const code = `export default async (cad) => {
  const part0_v0 = cad.translate({ offset: [5, 0, 0] }, part0_v999)
  return { shape: part0_v0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(false)
    expect(result.errors[0].stage).toBe('parse')
  })

  it('schema error: unknown field → ok=false, stage=schema', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20, bogusField: 99 })
  return { shape: part0_v0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(false)
    const schemaErrors = result.errors.filter((e) => e.stage === 'schema')
    expect(schemaErrors.length).toBeGreaterThan(0)
    expect(schemaErrors[0].message).toContain('bogusField')
  })

  it('schema error: missing required field → ok=false, stage=schema', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({})
  return { shape: part0_v0 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(false)
    const schemaErrors = result.errors.filter((e) => e.stage === 'schema')
    expect(schemaErrors.length).toBeGreaterThan(0)
    expect(schemaErrors[0].message).toContain('size')
  })

  it('check is zero-geometry-side-effect: no OCCT init needed', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  return { shape: part0_v0 }
}`
    const runtime = makeRuntime()
    const result = runtime.check(code)
    expect(result.ok).toBe(true)
    // No brepChain, no outputs — check is pure text validation
    expect(runtime.getCachedOutput('part0_v0')).toBeUndefined()
  })

  it('check provides structured context for AI self-correction', () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  const part0_v1 = cad.sphere({ radius: 10 })
  const part0_v2 = cad.union(part0_v0, part0_v1)
  return { shape: part0_v2 }
}`
    const result = makeRuntime().check(code)
    expect(result.ok).toBe(true)
    expect(result.script).toBeDefined()
    expect(result.script!.statements).toBe(3)
    expect(result.script!.ops).toEqual(['box', 'sphere', 'boolean'])
  })
})
