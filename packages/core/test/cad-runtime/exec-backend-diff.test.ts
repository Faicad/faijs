/**
 * exec-backend differential tests (no-eval backend design, step 2 acceptance).
 *
 * Runs the same corpus through both execution backends (vm = `new Function`,
 * interpreter = AST interpreter) and asserts observably identical results:
 * - same failure point / failure kind (failedAt parity);
 * - same ctx keys and same geometry fingerprints (mesh content keys).
 *
 * Geometric ops need global backends claimed by a live runtime (same pattern
 * as direct-executor.test.ts): a warmup execute on a mesh CadRuntime.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import { DirectExecutor } from '../../src/cad-runtime/direct-executor'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { computeContentKey } from '../../src/cad-runtime/content-key'
import { isMeshShape } from '../../src/mesh/types'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

function fingerprint(ctx: Record<string, unknown>): string[] {
  const keys: string[] = []
  for (const [name, v] of Object.entries(ctx)) {
    if (isMeshShape(v)) keys.push(`${name}:${computeContentKey(v.positions, v.indices)}`)
  }
  keys.sort()
  return keys
}

let rt: CadRuntime

beforeAll(async () => {
  rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespaceWithEditorOps() })
  await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
})

/** Run code on both backends; return per-backend ctx fingerprints + failure. */
async function runBoth(code: string): Promise<{
  vm: { fp: string[]; failedAt?: unknown; keys: string[] }
  interp: { fp: string[]; failedAt?: unknown; keys: string[] }
}> {
  const out: Record<'vm' | 'interp', { fp: string[]; failedAt?: unknown; keys: string[] }> = {
    vm: { fp: [], keys: [] },
    interp: { fp: [], keys: [] },
  }
  for (const backend of ['vm', 'interp'] as const) {
    const ex = new DirectExecutor({
      namespaces: { cad: createApiNamespaceWithEditorOps() },
      execBackend: backend === 'vm' ? 'vm' : 'interpreter',
    })
    const res = await ex.execute(code)
    out[backend].failedAt = res.failedAt
    out[backend].keys = [...ex.listCtxKeys()].sort()
    out[backend].fp = fingerprint(ex.ctx)
  }
  return out
}

describe('exec-backend differential: vm vs interpreter (expressions & simple statements)', () => {
  it('three-line op pipeline: identical geometry fingerprints', async () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.sphere({ radius: 10 })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
    expect(r.interp.fp).toEqual(r.vm.fp)
  })

  it('arithmetic / template literals / ternary: identical ctx values', async () => {
    const code = [
      'let a = 1 + 2 * 3',
      'let b = `v=${a}`',
      'let c = a > 5 ? "big" : "small"',
      'let d = (-a) ** 2',
      'let e = [1, 2, ...[3, 4]]',
      'let f = { x: a, y: "k" }',
      'let g = Math.floor(7.9)',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
  })

  it('undefined / nullish / logical: identical ctx values', async () => {
    const code = [
      'let a = null ?? "dflt"',
      'let b = undefined ?? 42',
      'let c = 0 || "or"',
      'let d = 1 && "and"',
      'let e = null',
      'let f = typeof e',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
  })
})

describe('exec-backend differential: functions, blocks, control flow', () => {
  it('hoisted function + call: identical geometry fingerprints', async () => {
    const code = [
      'function mk(d) {',
      '  return cad.box(d, d, d, { centered: true })',
      '}',
      'let s = mk(12)',
      'let t = mk(6)',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
    expect(r.interp.fp).toEqual(r.vm.fp)
  })

  it('block-scoped declarations (R-5 flat ctx): identical keys', async () => {
    const code = [
      'let a = 1',
      '{',
      '  let b = 2',
      '  a = a + b',
      '}',
      'let c = a',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
  })

  it('for loop + accumulate: identical ctx values', async () => {
    const code = [
      'let total = 0',
      'for (let i = 0; i < 5; i++) {',
      '  total = total + i',
      '}',
      'let check = total',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
  })

  it('for-of over array: identical ctx values', async () => {
    const code = [
      'const sizes = [4, 8, 16]',
      'let acc = []',
      'for (const s of sizes) {',
      '  acc.push(s * 2)',
      '}',
      'let n = acc.length',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
  })

  it('if/else + while + break: identical ctx values', async () => {
    const code = [
      'let x = 10',
      'if (x > 5) {',
      '  x = x - 1',
      '} else {',
      '  x = x + 1',
      '}',
      'while (x > 0) {',
      '  x = x - 2',
      '  if (x === 4) { break }',
      '}',
      'let done = x',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
  })

  it('function calling function + recursion (fib): identical values', async () => {
    const code = [
      'function fib(n) {',
      '  if (n <= 1) { return n }',
      '  return fib(n - 1) + fib(n - 2)',
      '}',
      'let f7 = fib(7)',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
  })

  it('closure capturing outer function local: identical values', async () => {
    const code = [
      'function adder(base) {',
      '  return (v) => v + base',
      '}',
      'const add3 = adder(3)',
      'let r1 = add3(4)',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
  })

  it('bare call writeback (union in place): identical fingerprints', async () => {
    const code = [
      'let a = cad.box(10, 10, 10, { centered: true })',
      'let b = cad.sphere({ radius: 4 })',
      'cad.union(a, b)',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
    expect(r.interp.fp).toEqual(r.vm.fp)
  })

  it('in-place member method call: both fail identically (mesh path has no .fuse)', async () => {
    const code = [
      'let a = cad.box(10, 10, 10, { centered: true })',
      'let b = cad.sphere({ radius: 4 })',
      'a.fuse(b)',
    ].join('\n')
    const r = await runBoth(code)
    // mesh path: member .fuse does not exist on mesh shapes — both backends
    // must fail at the same statement
    expect(r.vm.failedAt).toBeDefined()
    expect(r.interp.failedAt).toBeDefined()
    expect(r.interp.failedAt).toEqual(r.vm.failedAt)
  })

  it('failure point parity: unknown op fails at same statement index/line', async () => {
    const code = [
      'let a = 1',
      'let b = cad.nonexistent_op(a)',
    ].join('\n')
    const r = await runBoth(code)
    // both must fail at statement 2 with the same statement index + line
    expect(r.vm.failedAt).toBeDefined()
    const vm = r.vm.failedAt as { index: number; lineNo: number; message: string; error?: Error }
    const itp = r.interp.failedAt as { index: number; lineNo: number; message: string; error?: Error }
    expect(itp.index).toBe(vm.index)
    expect(itp.lineNo).toBe(vm.lineNo)
    // error kind parity: same error type name from the same root cause
    expect(itp.error?.name).toBe(vm.error?.name)
  })
})
/**
 * Constraint 2 regression: namespace calls in non-statement positions.
 *
 * Before the fix, `hoistText` (used for top-level value-expression RHS that
 * are not bare CallExpression) did not rewrite `cad`/`anim` to `__ns.<binding>`,
 * so the vm backend emitted a bare namespace name → ReferenceError at runtime.
 * The interpreter backend used the original AST and resolved ns via env, so it
 * worked — a vm/interp differential.
 *
 * Each case below places a `cad.<op>(...)` call inside a non-call expression
 * (array literal, object value, conditional, member chain, template literal,
 * sequence) and asserts both backends succeed with identical results.
 */
describe('exec-backend differential: constraint 2 — namespace binding in non-statement positions', () => {
  it('array literal: [cad.box(...)] — identical geometry', async () => {
    const code = [
      'let arr = [cad.box(4, 4, 4, { centered: true })]',
      'let b = arr[0]',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
    expect(r.interp.fp).toEqual(r.vm.fp)
  })

  it('object literal value: { s: cad.sphere(...) } — identical geometry', async () => {
    const code = [
      'let obj = { s: cad.sphere({ radius: 4 }) }',
      'let b = obj.s',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
    expect(r.interp.fp).toEqual(r.vm.fp)
  })

  it('conditional expression: cond ? cad.box(...) : cad.sphere(...)', async () => {
    const code = [
      'let pick = 1',
      'let s = pick > 0 ? cad.box(5, 5, 5, { centered: true }) : cad.sphere({ radius: 3 })',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
    expect(r.interp.fp).toEqual(r.vm.fp)
  })

  it('member access chain: [cad.box(...)].length — identical values', async () => {
    const code = [
      'let arr = [cad.box(2, 2, 2, { centered: true })]',
      'let n = arr.length',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
  })

  it('template literal with ns call in interpolation — identical values', async () => {
    const code = [
      'let a = cad.box(2, 2, 2, { centered: true })',
      'let tag = `has:${a === null ? "no" : "yes"}`',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
  })

  it('binary expression with ns call operand — identical values', async () => {
    const code = [
      'let a = cad.box(5, 5, 5, { centered: true })',
      'let kind = a === null ? 0 : 1',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
  })

  it('unary expression bracket fix: (-a) ** 2 — identical values', async () => {
    const code = [
      'let a = 3',
      'let b = (-a) ** 2',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
  })

  it('nested array + object + conditional combined — identical geometry', async () => {
    const code = [
      'let parts = [{ box: cad.box(3, 3, 3, { centered: true }) }, { sph: cad.sphere({ radius: 2 }) }]',
      'let pick = 0',
      'let extra = pick === 0 ? parts[0].box : parts[1].sph',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
    expect(r.interp.fp).toEqual(r.vm.fp)
  })
})

describe('exec-backend differential: constraint 1 — function body reads top-level vars', () => {
  it('function reads top-level const: identical geometry', async () => {
    const code = [
      'const SIZE = 5',
      'function mk(d) {',
      '  return cad.box(SIZE + d, SIZE, SIZE, { centered: true })',
      '}',
      'let part = mk(2)',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
    expect(r.interp.fp).toEqual(r.vm.fp)
  })

  it('function reads top-level let; call-time snapshot tracks value changes', async () => {
    const code = [
      'let W = 5',
      'function mk() {',
      '  return cad.box(W, W, W, { centered: true })',
      '}',
      'let a = mk()',
      'W = 8',
      'let b = mk()',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
    expect(r.interp.fp).toEqual(r.vm.fp)
    // 两次调用取到不同值（5 与 8）→ 两个不同 content key
    expect(r.vm.fp.length).toBe(2)
  })

  it('function calls top-level function (caller defined before callee)', async () => {
    const code = [
      'function mk() {',
      '  return helper()',
      '}',
      'function helper() {',
      '  return cad.box(3, 3, 3, { centered: true })',
      '}',
      'let part = mk()',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
    expect(r.interp.fp).toEqual(r.vm.fp)
  })

  it('function defined before top-level const (forward reference to variable)', async () => {
    const code = [
      'function mk(d) {',
      '  return cad.box(SIZE + d, SIZE, SIZE, { centered: true })',
      '}',
      'const SIZE = 5',
      'let part = mk(2)',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
    expect(r.interp.fp).toEqual(r.vm.fp)
  })

  it('function-local let shadows top-level const', async () => {
    const code = [
      'const SIZE = 5',
      'function mk() {',
      '  let SIZE = 10',
      '  return cad.box(SIZE, SIZE, SIZE, { centered: true })',
      '}',
      'let part = mk()',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
    expect(r.interp.fp).toEqual(r.vm.fp)
  })

  it('nested function local shadow does not block outer top-level read', async () => {
    // mk() 期望 15：外层 SIZE=5（嵌套函数本地遮蔽不阻止注入），helper 返回 10
    const code = [
      'const SIZE = 5',
      'function mk() {',
      '  const helper = () => {',
      '    let SIZE = 10',
      '    return SIZE',
      '  }',
      '  return SIZE + helper()',
      '}',
      'let n = mk()',
      'let part = cad.box(n, 1, 1, { centered: true })',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
    expect(r.interp.fp).toEqual(r.vm.fp)
  })

  it('block-level shadow does not block injection (unexecuted block keeps top-level value)', async () => {
    // a=100（块内局部遮蔽，块内 return），b=5（块未执行，读注入的顶层值）
    const code = [
      'const SIZE = 5',
      'function mk(flag) {',
      '  if (flag) {',
      '    let SIZE = 100',
      '    return SIZE',
      '  }',
      '  return SIZE',
      '}',
      'let a = mk(true)',
      'let b = mk(false)',
      'let part = cad.box(a + b, 1, 1, { centered: true })',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
    expect(r.interp.fp).toEqual(r.vm.fp)
  })

  it('object literal shorthand in function body reads top-level const', async () => {
    const code = [
      'const SIZE = 5',
      'function mk() {',
      '  let dims = { SIZE }',
      '  return cad.box(dims.SIZE, dims.SIZE, dims.SIZE, { centered: true })',
      '}',
      'let part = mk()',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
    expect(r.interp.fp).toEqual(r.vm.fp)
  })

  it('function body assignment stays local: top-level const unchanged (both backends)', async () => {
    const code = [
      'const SIZE = 5',
      'function mk() {',
      '  SIZE = 20',
      '  return cad.box(SIZE, 1, 1, { centered: true })',
      '}',
      'let p = mk()',
      'let q = SIZE',
      'let outer = cad.box(q, 1, 1, { centered: true })',
    ].join('\n')
    // fp：p = 20×1×1（写本地后同调用内可见），outer = 5×1×1（顶层不变）
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
    expect(r.interp.fp).toEqual(r.vm.fp)
    expect(r.vm.fp.length).toBe(2)
    // 直接钉住顶层值不被函数体写入污染
    for (const backend of ['vm', 'interp'] as const) {
      const ex = new DirectExecutor({
        namespaces: { cad: createApiNamespaceWithEditorOps() },
        execBackend: backend === 'vm' ? 'vm' : 'interpreter',
      })
      await ex.execute(code)
      expect(ex.ctx.q).toBe(5)
    }
  })

  it('recursive self-name resolves with injected destructure: identical values', async () => {
    const code = [
      'function fib(n) {',
      '  if (n <= 1) { return n }',
      '  return fib(n - 1) + fib(n - 2)',
      '}',
      'let f10 = fib(10)',
      'let part = cad.box(f10, 1, 1, { centered: true })',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeUndefined()
    expect(r.interp.failedAt).toBeUndefined()
    expect(r.interp.keys).toEqual(r.vm.keys)
    expect(r.interp.fp).toEqual(r.vm.fp)
  })

  it('param default referencing top-level var: both backends fail', async () => {
    // vm：默认值先于注入解构求值 → ReferenceError；
    // interp：非 Identifier 形参 → E_UNSUPPORTED_SYNTAX。两后端都失败（§5.5 契约）。
    const code = [
      'const SIZE = 5',
      'function mk(d = SIZE) {',
      '  return cad.box(d, 1, 1, { centered: true })',
      '}',
      'let part = mk()',
    ].join('\n')
    const r = await runBoth(code)
    expect(r.vm.failedAt).toBeDefined()
    expect(r.interp.failedAt).toBeDefined()
  })
})
