/**
 * P22 compat-op suite — the library statement-boundary bridge.
 *
 * Coverage (plan §4.3.2 / §4.3.3 / §7.3, P22 执行卡):
 *  ① unit — borrowDeep on Shape / plain object / array / class instance; the
 *     unwrapOrThrow err→throw with the op name and BrepError code;
 *     adoptEntity triple (entity adoption / pure-data pass-through / sub-shape
 *     rejection E_SUBSHAPE_BOUNDARY) and same-handle double-adoption dedup;
 *  ② integration — a bare library (no defineOp, no contractVersion) registered
 *     through `{ autoLift: true }` runs as a `.fai.js` statement and yields a
 *     Shape with a live BREP slot (hasBrep);
 *  ③ incremental — statementKey carries the lib binding's content id
 *     (`cart.box#<libId>`); re-registering the same library keeps the key
 *     (no recompute), re-registering a changed implementation changes it and
 *     downstream statements go stale;
 *  ④ leak — 50 looped library calls through one runtime keep the disposal
 *     arena's liveHandles bounded (adoption transfers ownership, no
 *     double-tracking per call);
 *  ⑤ dual-form passthrough — the compat op runs under both call forms: the
 *     positional arg and the object-form arg with a nested Shape reach the
 *     same adapter borrowing (dispatch + borrow behave identically).
 *
 * The vendored surface asserts a bound occt kernel; registerOcctBrepEngine
 * warms both the faijs brep engine and the vendored kernel (D10 single wasm).
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { createRuntime, registerOcctBrepEngine, brepjsCompat } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { asPartName } from '@faicad/faijs-core/identity'
import { hasBrep, isShape } from '@faicad/faijs-core/shape'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import {
  borrowDeep,
  unwrapOrThrow,
  compatOp,
} from '@faicad/faijs-core/api/internal/compat-op'
import { adoptEntity } from '@faicad/faijs-core/api/internal/l3-bridge'
import { getKernel } from '@faicad/faijs-core/occt-kernel/occtKernel'
import type { CadRuntime } from '@faicad/faijs-core/cad-runtime/runtime'
beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

/** Create a brep-mode runtime and warm its BREP chain (cad.box needs it). */
async function makeBrepRuntime(): Promise<{ runtime: CadRuntime; warm: Shape }> {
  const runtime = createRuntime(createNodePorts(), 'brep')
  const res = await runtime.execute('const g = cad.box(10, 10, 10, { centered: true })')
  expect(res.failedAt).toBeUndefined()
  return { runtime, warm: res.outputs.get(asPartName('g')) as Shape }
}

describe('① compat-op units', () => {
  it('borrowDeep: a faijs Shape maps to a borrowed brepjs view with an object KernelShape (P1)', async () => {
    const { runtime, warm } = await makeBrepRuntime()
    try {
      expect(isShape(warm)).toBe(true)
      const view = borrowDeep(warm, 0) as { wrapped?: unknown }
      expect(view).toBeTruthy()
      expect('wrapped' in (view as object)).toBe(true)
      expect(view.wrapped).toBeDefined()
      // P1 regression: `wrapped` must be a structurally valid OcctWasmHandle
      // OBJECT — vendored code uses KernelShape as a WeakMap key
      // (shapeTypeCache) and reads `shape.type` directly; a raw numeric id
      // crashed with "Invalid value used as weak map key".
      const wrapped = view.wrapped as Record<string, unknown> | number
      expect(typeof wrapped).toBe('object')
      expect((wrapped as Record<string, unknown>).__occtWasm).toBe(true)
      expect(typeof (wrapped as Record<string, unknown>).id).toBe('number')
      expect((wrapped as Record<string, unknown>).type).toBe('solid')
      // and the object is actually usable as a WeakMap key
      const cache = new WeakMap<object, string>()
      cache.set(wrapped as object, 'ok')
      expect(cache.get(wrapped as object)).toBe('ok')
    } finally {
      runtime.dispose()
    }
  })

  it('borrowDeep: plain object recurses and borrows the Shape member', async () => {
    const { runtime, warm } = await makeBrepRuntime()
    try {
      const input = { a: 1, base: warm }
      const out = borrowDeep(input, 0) as { a: number; base: { wrapped?: unknown } }
      expect(out.a).toBe(1)
      expect('wrapped' in (out.base as object)).toBe(true)
    } finally {
      runtime.dispose()
    }
  })

  it('borrowDeep: arrays map element-wise', async () => {
    const { runtime, warm } = await makeBrepRuntime()
    try {
      const out = borrowDeep([warm, 42], 0) as { wrapped?: unknown }[]
      expect(out).toHaveLength(2)
      expect('wrapped' in (out[0] as object)).toBe(true)
      expect(out[1]).toBe(42)
    } finally {
      runtime.dispose()
    }
  })

  it('borrowDeep: class instances are not traversed (pass through)', async () => {
    const { runtime, warm } = await makeBrepRuntime()
    try {
      class Holder {
        constructor(public sh: Shape) {}
      }
      const h = new Holder(warm)
      expect(borrowDeep(h, 0)).toBe(h) // same instance, no walk
    } finally {
      runtime.dispose()
    }
  })

  it('unwrapOrThrow: ok → value, err → throw with op name + code', () => {
    expect(unwrapOrThrow({ ok: true, value: 42 }, 'op')).toBe(42)
    expect(() =>
      unwrapOrThrow({ ok: false, error: { code: 'E_BAD', message: 'boom' } }, 'mine'),
    ).toThrow(/mine.*E_BAD/s)
    expect(unwrapOrThrow(5, 'op')).toBe(5) // plain pass-through
  })

  it('adoptEntity: entity adoption produces a Shape with a brep slot', async () => {
    const { runtime } = await makeBrepRuntime()
    try {
      const solid = brepjsCompat.box(10, 20, 30)
      const adopted = adoptEntity(solid, 'box') as Shape
      expect(isShape(adopted)).toBe(true)
      expect(hasBrep(adopted)).toBe(true)
    } finally {
      runtime.dispose()
    }
  })

  it('adoptEntity: pure data does not lose its identity (no adopt attempt)', () => {
    const data = { k: 1, v: [1, 2] }
    expect(adoptEntity(data, 'query')).toBe(data)
  })

  it('adoptEntity: sub-shape handles are rejected at the boundary', async () => {
    const { runtime } = await makeBrepRuntime()
    try {
      const solid = brepjsCompat.box(10, 20, 30)
      const faces = brepjsCompat.getFaces(solid)
      expect(faces.length).toBeGreaterThan(0)
      const face = faces[0]
      expect(() => adoptEntity(face, 'faceOp')).toThrow(/E_SUBSHAPE_BOUNDARY/)
    } finally {
      runtime.dispose()
    }
  })

  it('adoptEntity: the same vendored handle adopted twice yields one Shape', async () => {
    const { runtime } = await makeBrepRuntime()
    try {
      const solid = brepjsCompat.box(1, 2, 3)
      const first = adoptEntity(solid, 'op')
      const second = adoptEntity(solid, 'op')
      expect(first).toBe(second) // adoptedMap dedup: no double ownership
    } finally {
      runtime.dispose()
    }
  })
})

describe('② bare-lib integration through .fai', () => {
  async function runBareLib(options?: { autoLift?: boolean; impl?: (p: { size: number }) => unknown }) {
    const runtime = createRuntime(createNodePorts(), 'auto')
    runtime.registerLib('gearbox', {
      make: options?.impl ?? (({ size }: { size: number }) => {
        return (brepjsCompat as unknown as { box: (a: number, b: number, c: number) => unknown }).box(size, size, size)
      }),
    }, { autoLift: options?.autoLift ?? true })
    const code = "import * as gearbox from 'gearbox-lib'\nconst g = gearbox.make({ size: 12 })"
    const result = await runtime.execute(code)
    return { runtime, result }
  }

  it('bare lib through `{ autoLift: true }`: g is a Shape with a brep slot', async () => {
    const { runtime, result } = await runBareLib({ autoLift: true })
    try {
      expect(result.failedAt).toBeUndefined()
      const g = result.outputs.get(asPartName('g')) as Shape | undefined
      expect(g).toBeDefined()
      expect(isShape(g!)).toBe(true)
      expect(hasBrep(g!)).toBe(true)
    } finally {
      runtime.dispose()
    }
  })
})

describe('③ incremental lib-content identity', () => {
  function libA() {
    return { box: ({ size }: { size: number }) => brepjsCompat.box(size, size, size) }
  }
  function libB() {
    // different implementation (varies the width) → different body → different libId
    return { box: ({ size }: { size: number }) => brepjsCompat.box(size * 2, size, size) }
  }

  const CODE =
    "import * as gear from 'gear-lib-demo'\nconst g = gear.box({ size: 5 })\nconst h = cad.translate(g, { offset: [1, 0, 0] })"

  it('re-registering the same library keeps statementKey (no recompute)', async () => {
    const runtime = createRuntime(createNodePorts(), 'auto')
    try {
      const lib = libA()
      runtime.registerLib('gear', lib, { autoLift: true })
      const r1 = await runtime.execute(CODE)
      expect(r1.failedAt).toBeUndefined()
      const k1 = runtime.getStatementCacheEntry(asPartName('g'))?.statementKey
      const h1 = runtime.getStatementCacheEntry(asPartName('h'))?.statementKey

      runtime.registerLib('gear', lib, { autoLift: true }) // same implementation again
      const r2 = await runtime.execute(CODE)
      expect(r2.failedAt).toBeUndefined()
      const k2 = runtime.getStatementCacheEntry(asPartName('g'))?.statementKey
      const h2 = runtime.getStatementCacheEntry(asPartName('h'))?.statementKey

      expect(k2).toBe(k1)
      expect(h2).toBe(h1)
    } finally {
      runtime.dispose()
    }
  })

  it('changing the library surface causes downstream recompute', async () => {
    const runtime = createRuntime(createNodePorts(), 'auto')
    try {
      runtime.registerLib('gear', libA(), { autoLift: true })
      const r1 = await runtime.execute(CODE)
      expect(r1.failedAt).toBeUndefined()
      const g1 = r1.outputs.get(asPartName('g')) as Shape | undefined

      // replace with the changed implementation
      runtime.registerLib('gear', libB(), { autoLift: true })
      // T5: plan() deleted with IR; use update(full-replay) to verify recompute
      const r2 = await runtime.update(CODE, CODE)
      expect(r2.failedAt).toBeUndefined()
      const g2 = r2.outputs.get(asPartName('g')) as Shape | undefined
      expect(g2).toBeDefined()
      // The geometry must change (libB uses size*2 for width).
      // Use content key comparison (positions length may be equal for different box dims).
      const { computeContentKey } = await import('@faicad/faijs-core/cad-runtime/content-key')
      const key1 = computeContentKey(g1!.positions, g1!.indices)
      const key2 = computeContentKey(g2!.positions, g2!.indices)
      expect(key2).not.toBe(key1)
    } finally {
      runtime.dispose()
    }
  })
})

describe('④ leak: 50 loopthrough executes keep the arena bounded', () => {
  it('library calls grow the kernel arena no faster than the equivalent native box', async () => {
    // The occt-wasm arena grows by construction (mesh/tessellation artifacts the
    // engine keeps); the compat bridge must not add ANY per-call growth beyond
    // what the native `cad.box` path contributes. Both calls build the same box,
    // so their arena deltas must match within a small tolerance.
    const kernel = getKernel() as unknown as { shapeCount: number }

    const nativeRuntime = createRuntime(createNodePorts(), 'auto')
    const nativeCode = 'const g = cad.box(7, 7, 7, { centered: true })'
    await nativeRuntime.execute(nativeCode)
    const nativeBase = kernel.shapeCount
    for (let i = 0; i < 50; i++) await nativeRuntime.execute(nativeCode)
    const nativeGrowth = kernel.shapeCount - nativeBase
    nativeRuntime.dispose()

    const compatRuntime = createRuntime(createNodePorts(), 'auto')
    compatRuntime.registerLib('spin', {
      box: ({ n }: { n: number }) => brepjsCompat.box(n, n, n),
    }, { autoLift: true })
    const code = "import * as spin from 'spin-lib'\nconst g = spin.box({ n: 7 })"
    await compatRuntime.execute(code)
    const compatBase = kernel.shapeCount
    for (let i = 0; i < 50; i++) await compatRuntime.execute(code)
    const compatGrowth = kernel.shapeCount - compatBase
    compatRuntime.dispose()

    // The bridge must not leak per call: its arena growth must not exceed the
    // native counterpart by the loop count (any per-call extra handle would
    // accumulate +1 per iteration here). A small delta is fine — both paths
    // build the same OCCT solid and share the engine's baseline accrual.
    expect(compatGrowth - nativeGrowth).toBeLessThanOrEqual(20)
  })
})

describe('⑤ dual-form passthrough: positional vs object-form borrow', () => {
  it('compatOp-wrapped op adopts a product under both call forms (positional vs object-form)', async () => {
    const { runtime, warm } = await makeBrepRuntime()
    try {
      // Borrowed inputs are brepjs handles ({ wrapped, delete }); the probe
      // counts the handles it receives, then hands the first one back as its
      // product so the op outputs a real geometry Shape.
      const isHandle = (v: unknown): boolean =>
        typeof v === 'object' && v !== null && 'wrapped' in v
      const probe = compatOp(
        (input: unknown) => {
          let n = 0
          let first: unknown
          const walk = (v: unknown, depth: number): void => {
            if (depth > 4 || v === null || typeof v !== 'object') return
            if (isHandle(v)) { n++; if (first === undefined) first = v; return }
            if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return }
            for (const x of Object.values(v)) walk(x, depth + 1)
          }
          walk(input, 0)
          return { ok: true, value: first }
        },
        { name: 'probe' },
      )
      const positional = (await probe(warm)) as Shape
      const objectForm = (await probe({ base: warm })) as Shape
      expect(isShape(positional)).toBe(true)
      expect(hasBrep(positional)).toBe(true)
      expect(isShape(objectForm)).toBe(true)
      expect(hasBrep(objectForm)).toBe(true) // the nested Shape reached the same borrow
      expect(positional.positions.length).toBe(objectForm.positions.length)
    } finally {
      runtime.dispose()
    }
  })
})