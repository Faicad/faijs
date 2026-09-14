/**
 * no-eval-realm proof test (step 6 of the design doc, D6 acceptance).
 *
 * Simulates a restricted realm (WeChat mini-program / strict CSP) where
 * dynamic code generation is forbidden: `new Function` and `eval` are patched
 * to throw for the duration of each test, then restored.
 *
 * Proof:
 * - interpreter backend executes a real scene WITHOUT any dynamic code
 *   generation (outputs produced, geometry present);
 * - vm backend is correctly blocked in the same realm (fails at the unit
 *   that would call `new Function`) — proving the patch actually intercepts,
 *   i.e. the interpreter pass is meaningful, not a broken harness.
 *
 * Note: dynamic `import()` cannot be patched (it is syntax, not a global);
 * the no-`import()` guarantee is covered by the static source check in the
 * design doc (grep over cad-runtime/interp/ + exec-backends/interp-backend.ts).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from './runtime'
import { createApiNamespace } from '../api/api-namespace'
import type { HostPorts } from './ports'

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

const SCENE = [
  'function dbl(x) { return x * 2 }',
  'let n = dbl(21)',
  'let part0 = cad.box(n, 10, 10, { centered: true })',
  'let part1 = cad.sphere({ radius: 4 })',
  'let part2 = cad.union(part0, part1)',
].join('\n')

let rt: CadRuntime

beforeAll(async () => {
  // Warmup must run BEFORE the realm patch: the emscripten layer of
  // manifold-3d creates JS invokers lazily via `new Function` on FIRST use of
  // a wasm binding — that is a wasm-binding concern, out of scope for the
  // engine's no-eval guarantee (production restricted realms compile the wasm
  // with -sDYNAMIC_EXECUTION=0). Warm up every op the scene uses so binding
  // invokers exist; the patch then proves the ENGINE layer needs no eval.
  rt = new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespace() })
  await rt.execute([
    'let w0 = cad.box(1, 1, 1, { centered: true })',
    'let w1 = cad.sphere({ radius: 1 })',
    'let w2 = cad.union(w0, w1)',
  ].join('\n'))
})

/** Enter a no-eval realm: patch Function/eval to throw; returns a restore fn. */
function enterNoEvalRealm(): () => void {
  const RealFunction = globalThis.Function
  const RealEval = globalThis.eval
  const boom = (): never => {
    throw new Error('E_REALM: dynamic code generation is forbidden in this realm')
  }
  // a constructor whose [[Call]]/[[Construct]] both throw
  const Forbidden = function Forbidden(..._args: unknown[]) {
    boom()
  } as unknown as FunctionConstructor
  globalThis.Function = Forbidden
  ;(globalThis as { eval: unknown }).eval = boom
  return () => {
    globalThis.Function = RealFunction
    ;(globalThis as { eval: unknown }).eval = RealEval
  }
}

describe('no-eval realm (D6): interpreter backend runs without dynamic code generation', () => {
  it('interpreter backend executes a full scene with Function/eval disabled', async () => {
    const restore = enterNoEvalRealm()
    try {
      const rtInterp = new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespace() }, { execBackend: 'interpreter' })
      const res = await rtInterp.execute(SCENE)
      expect(res.failedAt).toBeUndefined()
      expect([...res.outputs.keys()].map(String).sort()).toEqual(['part0', 'part1', 'part2'])
      const mesh = res.outputs.get('part2' as never)
      expect(mesh).toBeDefined()
    } finally {
      restore()
    }
  })

  it('vm backend is blocked in the same realm (harness sanity + differential)', async () => {
    const restore = enterNoEvalRealm()
    try {
      const rtVm = new CadRuntime(defaultPorts(), 'mesh', { cad: createApiNamespace() }) // default: vm
      const res = await rtVm.execute(SCENE)
      // DirectExecutor swallows the realm error into failedAt — the vm path
      // cannot run here, which is exactly the problem the interpreter solves
      expect(res.failedAt).toBeDefined()
      expect(String(res.failedAt?.message)).toContain('E_REALM')
    } finally {
      restore()
    }
  })
})
