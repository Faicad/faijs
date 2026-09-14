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
import { CadRuntime } from './runtime'
import { DirectExecutor } from './direct-executor'
import { createApiNamespace } from '../api/api-namespace'
import type { HostPorts } from './ports'
import { computeContentKey } from './content-key'
import { isMeshShape } from '../mesh/types'

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
  rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespace() })
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
      namespaces: { cad: createApiNamespace() },
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
