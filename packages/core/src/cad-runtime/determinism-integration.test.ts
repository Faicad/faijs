/**
 * @vitest-environment node
 *
 * 确定性扫描集成测试：execute 前自动扫描，违规按 determinismPolicy 处理。
 *
 * .fai.js parser 对声明语句 RHS 用 lenient 模式（Math/Date 跳过），对 op 参数用
 * strict 模式。因此非确定源必须先存入变量再传入几何 op（正是 taint 传播场景）。
 *
 * Run: npx vitest run src/cad-runtime/determinism-integration.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import { CadRuntime } from './runtime'
import { createApiNamespace } from '../api/api-namespace'
import { CONTRACT_VERSION, type StdlibNamespace } from '../runtime-state'
import type { HostPorts, EventSink, LibLoader } from './ports'

class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []
  emit(event: string, detail: Record<string, unknown>): void {
    this.events.push({ event, detail: { ...detail } })
  }
}

function makeRuntime(determinism: 'off' | 'warn' | 'error', libLoader?: LibLoader): CadRuntime {
  const ports: HostPorts = { events: new TestEventSink(), ...(libLoader ? { libLoader } : {}) }
  return new CadRuntime(ports, 'auto', { cad: createApiNamespace() }, { determinism })
}

/** 最小库装载器：loadSource 返回给定库源码，loadLib 返回最小可用命名空间。autoLift 关（裸函数不作 compatOp 提升，避免测试把 null 当几何）。 */
function libLoaderWithSource(src: string): LibLoader {
  return {
    loadLib: async () => (({ contractVersion: CONTRACT_VERSION, make: () => 42 }) as unknown as StdlibNamespace),
    listLibs: () => ['@faicad/gear-demo'],
    loadSource: async () => src,
    options: { autoLift: false },
  }
}

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

describe('determinism gate integration', () => {
  it('error: Math.random stored in var → geometry → failedAt E_DETERMINISM', async () => {
    const rt = makeRuntime('error')
    const result = await rt.execute([
      'const r = Math.random() * 10',
      'const s1 = cad.sphere(r)',
    ].join('\n'))
    expect(result.failedAt).toBeDefined()
    expect(result.failedAt?.code).toBe('E_DETERMINISM')
    expect(result.failedAt?.message).toContain('Math.random')
  })

  it('error: deterministic code → executes normally', async () => {
    const rt = makeRuntime('error')
    const result = await rt.execute('const s1 = cad.box(10, 10, 10)')
    expect(result.failedAt).toBeUndefined()
    expect(result.outputs.size).toBeGreaterThan(0)
  })

  it('error: Date.now stored in var → geometry → failedAt', async () => {
    const rt = makeRuntime('error')
    const result = await rt.execute([
      'const r = Date.now() % 10 + 1',
      'const s1 = cad.cylinder(r, 5)',
    ].join('\n'))
    expect(result.failedAt?.code).toBe('E_DETERMINISM')
  })

  it('error: Date.now not flowing into geometry → safe', async () => {
    const rt = makeRuntime('error')
    const result = await rt.execute([
      'const t = Date.now()',
      'const s1 = cad.box(10, 10, 10)',
    ].join('\n'))
    expect(result.failedAt).toBeUndefined()
  })

  it('warn: violation → infos carries warning, execution proceeds', async () => {
    const rt = makeRuntime('warn')
    const result = await rt.execute([
      'const r = Math.random() * 10',
      'const s1 = cad.sphere(r)',
    ].join('\n'))
    expect(result.failedAt).toBeUndefined()
    expect(result.infos.some((i) => i.includes('determinism'))).toBe(true)
  })

  it('off: violation → not scanned, executes normally', async () => {
    const rt = makeRuntime('off')
    const result = await rt.execute([
      'const r = Math.random() * 10',
      'const s1 = cad.sphere(r)',
    ].join('\n'))
    expect(result.failedAt).toBeUndefined()
  })

  it('error: new Date() member access → geometry → failedAt', async () => {
    const rt = makeRuntime('error')
    const result = await rt.execute([
      'const d = new Date()',
      'const r = d.getSeconds()',
      'const s1 = cad.box(r, 10, 10)',
    ].join('\n'))
    expect(result.failedAt?.code).toBe('E_DETERMINISM')
  })

  it('error: TS-syntax library source → explicit SyntaxError (no stripping, no silent skip)', async () => {
    // 契约：库源码必须是编译后的纯 JS；TS 语法显式报错，不做 sucrase 剥离、不静默跳过。
    const rt = makeRuntime('error', libLoaderWithSource('export function make(n: number): number { return n }'))
    await expect(
      rt.execute("import * as gear from '@faicad/gear-demo'\nlet p = gear.make(1)"),
    ).rejects.toThrow(/library source is not valid plain JavaScript/)
  })

  it('error: plain-JS library source is scanned normally (violations still detected)', async () => {
    // strict 只对"非法 JS"显式报错；合法 JS 库源码照常扫描，违规照常检出。
    const rt = makeRuntime('error', libLoaderWithSource('export function make() { return cad.box(Math.random(), 10, 10) }'))
    const result = await rt.execute("import * as gear from '@faicad/gear-demo'\nlet p = gear.make(1)")
    expect(result.failedAt?.code).toBe('E_DETERMINISM')
  })

  it('error: clean plain-JS library source passes the gate', async () => {
    const rt = makeRuntime('error', libLoaderWithSource('export function make(n) { return n }'))
    const result = await rt.execute("import * as gear from '@faicad/gear-demo'\nlet p = gear.make(1)")
    expect(result.failedAt).toBeUndefined()
  })
})
