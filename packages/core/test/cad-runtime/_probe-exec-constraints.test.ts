/**
 * TEMP PROBE (delete after investigation): differential behaviour of the two
 * execution backends across statement shapes. Prints vm vs interpreter results.
 */
import { describe, it, beforeAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import { DirectExecutor } from '../../src/cad-runtime/direct-executor'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { computeContentKey } from '../../src/cad-runtime/content-key'
import { isMeshShape } from '../../src/mesh/types'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

function valueOf(v: unknown): string {
  if (isMeshShape(v)) return `mesh:${computeContentKey(v.positions, v.indices)}`
  if (v === undefined) return 'undefined'
  if (typeof v === 'function') return `fn:${(v as { name?: string }).name ?? ''}`
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

function fingerprint(ctx: Record<string, unknown>): string[] {
  return Object.keys(ctx)
    .sort()
    .map((k) => `${k}=${valueOf(ctx[k])}`)
}

let rt: CadRuntime
beforeAll(async () => {
  rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespaceWithEditorOps() })
  await rt.execute('let warmup = cad.box(1, 1, 1, { centered: true })')
})

async function runBoth(code: string) {
  const out: Record<string, { fp: string[]; failed?: string; keys: string[]; execLines: number[] }> = {}
  for (const backend of ['vm', 'interp'] as const) {
    const ex = new DirectExecutor({
      namespaces: { cad: createApiNamespaceWithEditorOps() },
      execBackend: backend === 'vm' ? 'vm' : 'interpreter',
    })
    const res = await ex.execute(code)
    out[backend] = {
      failed: res.failedAt ? `${(res.failedAt.error as Error | undefined)?.name ?? '?'}: ${res.failedAt.message}` : undefined,
      keys: [...ex.listCtxKeys()].sort(),
      fp: fingerprint(ex.ctx),
      execLines: res.executedLines,
    }
  }
  return out
}

const CASES: Array<[string, string]> = [
  ['1 plain const', 'let a = 1 + 2'],
  ['2 op line', 'let p = cad.box(10, 10, 10, { centered: true })'],
  ['3 bare op call (no assign)', 'cad.box(10, 10, 10, { centered: true })'],
  ['4 top-level bare expression', '1 + 2'],
  ['5 reassign plain var', 'let a = 1\nlet b = a + 1'],
  ['6 two plain stmts one line', 'let x = 5; let y = 6'],
  ['7 two op stmts one line', 'let a = cad.box(1,1,1); let b = cad.box(2,2,2)'],
  ['8 explicit await', 'let a = await cad.box(1,1,1,{centered:true})'],
  ['9 array with op', 'let arr = [cad.box(1,1,1,{centered:true})]'],
  ['10 object with op', 'let o = { s: cad.box(1,1,1,{centered:true}) }'],
  ['11 nested op call', 'let u = cad.union(cad.box(1,1,1,{centered:true}), cad.sphere({ radius: 0.5 }))'],
  ['12 conditional with op', 'let c = 1 > 0 ? cad.box(1,1,1,{centered:true}) : null'],
  ['13 member on op result', 'let v = cad.box(1,1,1,{centered:true}).volume'],
  ['14 binary op in expr', 'let n = cad.box(1,1,1,{centered:true}).volume + 1'],
  ['15 mixed one line op+plain', 'let a = cad.box(1,1,1); let z = 9'],
  ['16 top-level await stmt', 'await cad.box(1,1,1,{centered:true})'],
  ['17 function reads top-level var', 'let top = 5\nfunction f() { return top }\nlet r = f()'],
  ['18 function uses ns', 'function f(d) { return cad.box(d,d,d,{centered:true}) }\nlet s = f(3)'],
  ['19 switch default first', 'let x = 2\nlet r = 0\nswitch (x) { default: r = -1\ncase 2: r = 2 }'],
  ['20 try/catch', 'let e = 0\ntry { cad.nonexistent(1) } catch (err) { e = 1 }'],
  ['21 for-in', 'let obj = { a: 1 }\nlet k = ""\nfor (const key in obj) { k = key }'],
  ['22 sequence expr', 'let a = (1, 2)'],
  ['23 labeled loop', 'let t = 0\nlbl: for (let i=0;i<3;i++) { if (i===1) continue lbl; t = t + i }'],
  ['24 arrow expr body', 'const f = (x) => x + 1\nlet v = f(2)'],
  ['25 string literal with var name', 'let a = cad.box(1,1,1,{centered:true})\nlet s = "a and cad"'],
  ['26 optional chain', 'let a = cad.box(1,1,1,{centered:true})\nlet b = a?.volume'],
  ['27 update expr', 'let i = 0\ni++\nlet j = ++i'],
  ['28 compound assign', 'let i = 1\ni += 2\nlet j = i'],
  ['29 array destructure', 'let a = 1\nlet arr = [a, 2]\nlet [x, y] = arr'],
  ['30 value expr uses ns member (non-call)', 'let v = cad\nlet w = 1'],
  ['31 ns member in array', 'let a = [cad.box(1,1,1,{centered:true})]\nlet n = a.length'],
  ['32 switch default first no match', 'let x = 3\nlet r = 0\nswitch (x) { default: r = -1\ncase 2: r = 2 }'],
  ['33 value coercion', 'let a = 1 + "2"\nlet b = "1" == 1\nlet c = null + 1'],
  ['34 typeof void', 'let a = typeof undefined\nlet b = void 0\nlet c = typeof 42'],
  ['35 numeric ops', 'let a = 2 ** 3\nlet b = 7 % 4\nlet c = 1 << 3\nlet d = ~5'],
  ['36 object method shorthand', 'let o = { m() { return 1 } }\nlet v = o.m()'],
  ['37 object getter', 'let o = { get x() { return 1 } }\nlet v = o.x'],
  ['38 array methods', 'let a = [1,2,3]\nlet b = a.map((x) => x * 2)\nlet c = a.length'],
  ['39 string template', 'let n = 3\nlet s = `n=${n}`'],
  ['40 do-while continue', 'let i = 0\nlet s = 0\ndo { i++\nif (i === 2) continue\ns = s + i } while (i < 4)'],
  ['41 for continue', 'let s = 0\nfor (let i = 0; i < 5; i++) { if (i % 2 === 0) continue; s = s + i }'],
  ['42 closure', 'function a(x) { return (y) => x + y }\nlet f = a(1)\nlet r = f(2)'],
  ['43 logical short circuit', 'let a = []\nlet b = a.length === 0 && "empty"'],
  ['44 computed member', 'let o = { a: 1 }\nlet k = "a"\nlet v = o[k]'],
  ['45 nested ternary', 'let x = 1\nlet r = x > 0 ? x > 5 ? "big" : "small" : "neg"'],
]

import { appendFileSync, writeFileSync } from 'node:fs'

describe('PROBE exec backend differential', () => {
  it('collect', async () => {
    writeFileSync('probe-results.txt', '')
    for (const [name, code] of CASES) {
      let r: Awaited<ReturnType<typeof runBoth>>
      try {
        r = await runBoth(code)
      } catch (e) {
        appendFileSync('probe-results.txt', `\n### ${name}\n  BOTH THROW at transform: ${(e as Error).message}\n`)
        continue
      }
      const sameKeys = JSON.stringify(r.vm.keys) === JSON.stringify(r.interp.keys)
      const sameFp = JSON.stringify(r.vm.fp) === JSON.stringify(r.interp.fp)
      const sameFail = r.vm.failed === r.interp.failed
      appendFileSync(
        'probe-results.txt',
        `\n### ${name}\n` +
          `  code: ${code.replace(/\n/g, ' | ')}\n` +
          `  diff: keys=${!sameKeys} fp=${!sameFp} fail=${!sameFail}\n` +
          `  vm    : fail=${r.vm.failed ?? '-'} keys=${JSON.stringify(r.vm.keys)} lines=${JSON.stringify(r.vm.execLines)}\n` +
          `  interp: fail=${r.interp.failed ?? '-'} keys=${JSON.stringify(r.interp.keys)} lines=${JSON.stringify(r.interp.execLines)}\n` +
          (!sameFp
            ? `  vm.fp    =${JSON.stringify(r.vm.fp.map((s) => s.slice(0, 60)))}\n` +
              `  interp.fp=${JSON.stringify(r.interp.fp.map((s) => s.slice(0, 60)))}\n`
            : ''),
      )
    }
  })
})