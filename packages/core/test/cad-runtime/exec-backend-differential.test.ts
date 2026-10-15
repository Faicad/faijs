/**
 * Execution-backend differential — the `vm` and `interpreter` backends must
 * agree on every statement shape the DSL accepts.
 *
 * `DirectExecutor` ships two backends behind one `execute()` contract, so a
 * script must produce the **same binding context keys** and report the **same
 * failure** under both. This file pins that invariant across the statement
 * shapes that motivated the one-statement-per-line guard and the
 * namespace-binding-in-value-position fix (`4451498`): op lines, bare op calls,
 * namespace members in arrays / objects / ternaries / member chains, top-level
 * `await`, control flow, template literals, and so on.
 *
 * Three outcomes are distinguished, and every non-parity case pins **both** the
 * current value and the value it should have:
 *
 * - `parity`   — both backends must agree (keys + failure). This is the rule.
 * - `reject`   — the shape is rejected by the syntax guard *before* backend
 *                selection; the pinned reason is the documented DSL bounding.
 * - `divergence` — the DSL accepts the shape but the backends do not agree yet.
 *                The current value of **each** side is pinned together with the
 *                value it should take. Fixing the backend must flip these cases
 *                back to `parity`.
 *
 * Geometry parity has its own corpus in `exec-backend-diff.test.ts`; the shapes
 * here deliberately avoid geometry so a divergence names the executor, not the
 * mesh path.
 */
import { describe, it, expect } from 'vitest'
import { DirectExecutor } from '../../src/cad-runtime/direct-executor'
import { computeContentKey } from '../../src/cad-runtime/content-key'
import { isMeshShape } from '../../src/mesh/types'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

function valueOf(v: unknown): string {
  if (isMeshShape(v)) return `mesh:${computeContentKey(v.positions, v.indices)}`
  if (v === undefined) return 'undefined'
  if (typeof v === 'function') return `fn:${(v as { name?: string }).name ?? ''}`
  try {
    // `JSON.stringify` returns undefined for non-serialisable values: fall back
    // to `String(v)` so every value still collapses to one comparable token.
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return JSON.stringify(v) ?? String(v)
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return String(v)
  }
}

/** Stable per-value fingerprint of a binding context, key-sorted. */
function fingerprint(ctx: Record<string, unknown>): string[] {
  return Object.keys(ctx)
    .sort()
    .map((k) => `${k}=${valueOf(ctx[k])}`)
}

interface BackendRun {
  /** `${errorName}: ${message}` when the run failed, else undefined. */
  failed?: string
  /** Sorted context binding keys. */
  keys: string[]
  /** Sorted-key value fingerprints (diagnostic only — see the parity rule). */
  fp: string[]
  /** Lines the backend reported as executed. */
  execLines: number[]
}

/**
 * Run one script on both backends and capture the comparable facts.
 *
 * Rejections raised by the shared parse/transform stage (the syntax guard)
 * propagate out of this function — hence `reject` cases use `rejects.toThrow`.
 */
async function runBoth(code: string): Promise<Record<'vm' | 'interp', BackendRun>> {
  const out = {} as Record<'vm' | 'interp', BackendRun>
  for (const backend of ['vm', 'interp'] as const) {
    const ex = new DirectExecutor({
      namespaces: { cad: createApiNamespaceWithEditorOps() },
      execBackend: backend === 'vm' ? 'vm' : 'interpreter',
    })
    const res = await ex.execute(code)
    out[backend] = {
      failed: res.failedAt
        ? `${(res.failedAt.error as Error | undefined)?.name ?? '?'}: ${res.failedAt.message}`
        : undefined,
      keys: [...ex.listCtxKeys()].sort(),
      fp: fingerprint(ex.ctx),
      execLines: res.executedLines,
    }
  }
  return out
}

/** Human-readable divergence report carrying both backends' values. */
function report(name: string, code: string, r: Record<'vm' | 'interp', BackendRun>): string {
  return [
    `exec backend divergence — ${name}`,
    `  code  : ${code.replace(/\n/g, ' | ')}`,
    `  vm    : failed=${r.vm.failed ?? '-'} keys=${JSON.stringify(r.vm.keys)} lines=${JSON.stringify(r.vm.execLines)}`,
    `  interp: failed=${r.interp.failed ?? '-'} keys=${JSON.stringify(r.interp.keys)} lines=${JSON.stringify(r.interp.execLines)}`,
    `  vm.fp    =${JSON.stringify(r.vm.fp.map((s) => s.slice(0, 80)))}`,
    `  interp.fp=${JSON.stringify(r.interp.fp.map((s) => s.slice(0, 80)))}`,
  ].join('\n')
}

/** Both backends must agree on this shape (the rule). */
interface ParityCase {
  kind: 'parity'
  name: string
  code: string
}

/** The syntax guard rejects this shape before backend selection. */
interface RejectCase {
  kind: 'reject'
  name: string
  code: string
  /** Fragment of the documented rejection message. */
  reason: RegExp
}

/**
 * The DSL accepts this shape but the backends disagree today. Both current
 * values are pinned; `should` records the value the failing side must take once
 * the backend is fixed (flip this case to `parity` then).
 */
interface DivergenceCase {
  kind: 'divergence'
  name: string
  code: string
  /** Current `vm` context keys. */
  vmKeys: string[]
  /** Current `interpreter` context keys. */
  interpKeys: string[]
  /** Fragment of the interpreter's current failure. */
  interpFailed: RegExp
  /** What the interpreter *should* do. */
  should: string
}

type Case = ParityCase | RejectCase | DivergenceCase

/** `[case name, script source]`, one statement shape per entry. */
const CASES: Case[] = [
  { kind: 'parity', name: '1 plain const', code: 'let a = 1 + 2' },
  { kind: 'parity', name: '2 op line', code: 'let p = cad.box(10, 10, 10, { centered: true })' },
  { kind: 'parity', name: '3 bare op call (no assign)', code: 'cad.box(10, 10, 10, { centered: true })' },
  { kind: 'reject', name: '4 top-level bare expression', code: '1 + 2', reason: /bare expression statements not allowed/ },
  { kind: 'parity', name: '5 reassign plain var', code: 'let a = 1\nlet b = a + 1' },
  { kind: 'reject', name: '6 two plain stmts one line', code: 'let x = 5; let y = 6', reason: /multiple statements on line 1.*one statement per line/ },
  { kind: 'reject', name: '7 two op stmts one line', code: 'let a = cad.box(1,1,1); let b = cad.box(2,2,2)', reason: /multiple statements on line 1.*one statement per line/ },
  { kind: 'parity', name: '8 explicit await', code: 'let a = await cad.box(1,1,1,{centered:true})' },
  { kind: 'parity', name: '9 array with op', code: 'let arr = [cad.box(1,1,1,{centered:true})]' },
  { kind: 'parity', name: '10 object with op', code: 'let o = { s: cad.box(1,1,1,{centered:true}) }' },
  { kind: 'parity', name: '11 nested op call', code: 'let u = cad.union(cad.box(1,1,1,{centered:true}), cad.sphere({ radius: 0.5 }))' },
  { kind: 'parity', name: '12 conditional with op', code: 'let c = 1 > 0 ? cad.box(1,1,1,{centered:true}) : null' },
  { kind: 'parity', name: '13 member on op result', code: 'let v = cad.box(1,1,1,{centered:true}).volume' },
  { kind: 'parity', name: '14 binary op in expr', code: 'let n = cad.box(1,1,1,{centered:true}).volume + 1' },
  { kind: 'reject', name: '15 mixed one line op+plain', code: 'let a = cad.box(1,1,1); let z = 9', reason: /multiple statements on line 1.*one statement per line/ },
  { kind: 'reject', name: '16 top-level await stmt', code: 'await cad.box(1,1,1,{centered:true})', reason: /bare expression statements not allowed/ },
  { kind: 'reject', name: '17 function reads top-level var', code: 'let top = 5\nfunction f() { return top }\nlet r = f()', reason: /SEC_IDENT line 2: "top" is not allowed/ },
  { kind: 'parity', name: '18 function uses ns', code: 'function f(d) { return cad.box(d,d,d,{centered:true}) }\nlet s = f(3)' },
  { kind: 'parity', name: '19 switch default first', code: 'let x = 2\nlet r = 0\nswitch (x) { default: r = -1\ncase 2: r = 2 }' },
  { kind: 'parity', name: '20 try/catch', code: 'let e = 0\ntry { cad.nonexistent(1) } catch (err) { e = 1 }' },
  { kind: 'parity', name: '21 for-in', code: 'let obj = { a: 1 }\nlet k = ""\nfor (const key in obj) { k = key }' },
  { kind: 'parity', name: '22 sequence expr', code: 'let a = (1, 2)' },
  { kind: 'parity', name: '23 labeled loop', code: 'let t = 0\nlbl: for (let i=0;i<3;i++) { if (i===1) continue lbl; t = t + i }' },
  { kind: 'parity', name: '24 arrow expr body', code: 'const f = (x) => x + 1\nlet v = f(2)' },
  { kind: 'parity', name: '25 string literal with var name', code: 'let a = cad.box(1,1,1,{centered:true})\nlet s = "a and cad"' },
  { kind: 'parity', name: '26 optional chain', code: 'let a = cad.box(1,1,1,{centered:true})\nlet b = a?.volume' },
  { kind: 'reject', name: '27 update expr', code: 'let i = 0\ni++\nlet j = ++i', reason: /line 2: bare expression statements not allowed/ },
  { kind: 'reject', name: '28 compound assign', code: 'let i = 1\ni += 2\nlet j = i', reason: /line 2: bare expression statements not allowed/ },
  { kind: 'reject', name: '29 array destructure', code: 'let a = 1\nlet arr = [a, 2]\nlet [x, y] = arr', reason: /line 3: expected identifier on left side of const declaration/ },
  { kind: 'parity', name: '30 value expr uses ns member (non-call)', code: 'let v = cad\nlet w = 1' },
  { kind: 'parity', name: '31 ns member in array', code: 'let a = [cad.box(1,1,1,{centered:true})]\nlet n = a.length' },
  { kind: 'parity', name: '32 switch default first no match', code: 'let x = 3\nlet r = 0\nswitch (x) { default: r = -1\ncase 2: r = 2 }' },
  { kind: 'parity', name: '33 value coercion', code: 'let a = 1 + "2"\nlet b = "1" == 1\nlet c = null + 1' },
  // FIXME(parity): interpreter has no `UnaryExpression` support — `typeof` /
  // `void` must work there; when it does, this case becomes `parity`.
  {
    kind: 'divergence',
    name: '34 typeof void',
    code: 'let a = typeof undefined\nlet b = void 0\nlet c = typeof 42',
    vmKeys: ['a', 'b', 'c'],
    interpKeys: ['a', 'b'],
    interpFailed: /E_UNSUPPORTED_SYNTAX: expression UnaryExpression is not supported by the interpreter backend/,
    should: "interpreter must bind a/b/c exactly like vm (typeof undefined = 'undefined', void 0 = undefined, typeof 42 = 'number')",
  },
  { kind: 'parity', name: '35 numeric ops', code: 'let a = 2 ** 3\nlet b = 7 % 4\nlet c = 1 << 3\nlet d = ~5' },
  { kind: 'parity', name: '36 object method shorthand', code: 'let o = { m() { return 1 } }\nlet v = o.m()' },
  { kind: 'parity', name: '37 object getter', code: 'let o = { get x() { return 1 } }\nlet v = o.x' },
  // FIXME(parity): the interpreter cannot call an array method that takes a
  // callback (`a.map(fn)` → `TypeError: object is not a function`); when it can,
  // this case becomes `parity`.
  {
    kind: 'divergence',
    name: '38 array methods',
    code: 'let a = [1,2,3]\nlet b = a.map((x) => x * 2)\nlet c = a.length',
    vmKeys: ['a', 'b', 'c'],
    interpKeys: ['a'],
    interpFailed: /TypeError: object is not a function/,
    should: 'interpreter must bind b = [2,4,6] and c = 3 exactly like vm',
  },
  { kind: 'parity', name: '39 string template', code: 'let n = 3\nlet s = `n=${n}`' },
  { kind: 'parity', name: '40 do-while continue', code: 'let i = 0\nlet s = 0\ndo { i++\nif (i === 2) continue\ns = s + i } while (i < 4)' },
  { kind: 'parity', name: '41 for continue', code: 'let s = 0\nfor (let i = 0; i < 5; i++) { if (i % 2 === 0) continue; s = s + i }' },
  { kind: 'parity', name: '42 closure', code: 'function a(x) { return (y) => x + y }\nlet f = a(1)\nlet r = f(2)' },
  { kind: 'parity', name: '43 logical short circuit', code: 'let a = []\nlet b = a.length === 0 && "empty"' },
  { kind: 'parity', name: '44 computed member', code: 'let o = { a: 1 }\nlet k = "a"\nlet v = o[k]' },
  { kind: 'parity', name: '45 nested ternary', code: 'let x = 1\nlet r = x > 0 ? x > 5 ? "big" : "small" : "neg"' },
]

describe('exec backend differential (vm vs interpreter)', () => {
  for (const c of CASES) {
    it(c.name, async () => {
      if (c.kind === 'reject') {
        await expect(runBoth(c.code)).rejects.toThrow(c.reason)
        return
      }

      const r = await runBoth(c.code)
      const detail = report(c.name, c.code, r)

      if (c.kind === 'divergence') {
        // Both current values are pinned, and `c.should` states the value the
        // failing side must take. Nothing here may be relaxed without fixing the
        // backend: a change to either side fails this case on purpose.
        expect(r.vm.failed ?? null, detail).toBe(null)
        expect(r.vm.keys, detail).toEqual(c.vmKeys)
        expect(r.interp.failed ?? '', detail).toMatch(c.interpFailed)
        expect(r.interp.keys, detail).toEqual(c.interpKeys)
        return
      }

      // Observable-behaviour parity. `fp` stays in `detail` only: the two
      // backends represent *callable* values differently (the interpreter keeps
      // them as plain objects), so a whole-context fingerprint is not a valid
      // parity invariant. Geometry parity lives in `exec-backend-diff.test.ts`.
      expect(r.vm.keys, detail).toEqual(r.interp.keys)
      expect(r.vm.failed ?? null, detail).toBe(r.interp.failed ?? null)
    })
  }
})
