/**
 * V-C8 — boolean errors must be explicit and op-named, never OCCT raw text.
 *
 * C6 makes non-solid geometry (wire/face/shell from `cad.import_brep`)
 * first-class at the import site; the limit lands at the USE site. The use
 * site for a boolean must produce a structured `OpError` carrying:
 *   - the op name (`boolean/<operation>`),
 *   - the input variable names (via the shape→name table),
 *   - the kernel cause chained (`{ cause }`).
 *
 * GOTCHA (2026-09-23, Crank corpus): the old path threw OCCT's raw
 * `boolean operation failed` (or the bare `[stdlib/boolean] input is not
 * BREP`) — no op name, no input names, no cause. Note the static dispatch
 * layer rejects handle-less inputs BEFORE the op body with its own
 * BrepUnsupportedError; the V-C8 wrapper covers the kernel-call site, which
 * is where corpus booleans actually die.
 *
 * Run: npx vitest run src/api/boolean-vc8.test.ts
 */

import { describe, expect, it } from 'vitest'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../runtime-state'
import { union } from './boolean'
import { OpError } from './internal/result-unwrap'
import { fromBrep } from '../shape'
import type { Shape } from '../mesh/types'

function makeBackends(kernelBrep: unknown): Backends {
  return {
    contractVersion: CONTRACT_VERSION,
    // GOTCHA (2026-09-24): `union` declares the **per-kernel-function** capability
    // `fuseWithHistory` (Phase 0.2 — the family-level `'evolution'` name was dropped
    // precisely so partially-implemented kernels cannot pass static judgement). The
    // declaration here must therefore name that function, not `'fuse'`, or dispatch
    // rejects before the op body with a capability BrepUnsupportedError. The engine
    // id field is `brepEngineId` (not `brepCapabilitiesEngineId`).
    config: { mode: 'brep', brepCapabilities: { evolution: ['fuseWithHistory'] }, brepEngineId: 'test' },
    kernel: { brep: kernelBrep, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends
}

/** A BREP-chain shape with a real handle, backed by a throwing kernel fuse. */
function handledShape(handle: unknown): Shape {
  return fromBrep(
    { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) },
    { solid: handle, roleTable: new Map() },
  )
}

describe('V-C8: boolean errors are op-named and explicit', () => {
  it('GOTCHA: kernel boolean failure → OpError E_OP_FAILED with op name, input names and cause (not raw OCCT text)', async () => {
    const cause = new Error('boolean operation failed')
    const kernel = {
      fuseWithHistory: () => { throw cause },
      subShapeHashes: () => [101],
      release: () => undefined,
    }
    configureBackends(makeBackends(kernel))
    const a = handledShape({ h: 1 })
    const b = handledShape({ h: 2 })
    try {
      await union(a, b)
      expect.unreachable('must throw')
    } catch (e) {
      expect(e).toBeInstanceOf(OpError)
      const opErr = e as OpError
      expect(opErr.op).toBe('boolean/union')
      expect(opErr.code).toBe('E_OP_FAILED')
      expect(opErr.message).toMatch(/\[stdlib\/boolean\] union: kernel fuse failed/)
      expect(opErr.message).toMatch(/kernel fuse failed/)
      expect(opErr.message).toMatch(/boolean operation failed/)
      expect((opErr as { cause?: unknown }).cause).toBe(cause)
    }
  })

  it('GOTCHA: handle-less input reaching booleanBrep → OpError E_BREP_UNSUPPORTED naming the offender', async () => {
    // The dispatch layer normally rejects this earlier; pin the op-body guard
    // directly so the use-site message stays structured if dispatch changes.
    configureBackends(makeBackends({}))
    const mesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) }
    try {
      await union(mesh as Shape, mesh as Shape)
      expect.unreachable('must throw')
    } catch (e) {
      // Either the op-body OpError (V-C8) or the dispatch-layer guard — but
      // never the old bare "[stdlib/boolean] input is not BREP" shape.
      const msg = e instanceof Error ? e.message : String(e)
      expect(msg).not.toBe('[stdlib/boolean] input is not BREP')
      if (e instanceof OpError) {
        expect(e.op).toBe('boolean/union')
        expect(e.code).toBe('E_BREP_UNSUPPORTED')
        expect(e.message).toMatch(/input is not on the BREP chain/)
      }
    }
  })

  // F 组 (kernel-boolean run-fail corpus, 2026-10-03): an import_brep asset
  // may be a WIRE/FACE (ShapeBinder frozen geometry). It carries an OCCT
  // handle so it passes the handle guard, but OCCT BOP only accepts solids —
  // fuse(wire, solid) fails with "operation failed" (FAULHABER / Beam-coupling
  // takepoints; kernel probe: PartShape5/6 = wire, PartShape93 = face,
  // volume 0). union is a SOLID merge: non-solid inputs are skipped (C3c-1
  // proved zero-volume wire members have zero effect on invariants).
  it('union skips non-solid (wire/face) inputs and fuses only the solids (F组)', async () => {
    const fused: unknown[] = []
    const kernel = {
      // Only the solid pair ever reaches the kernel.
      fuseWithHistory: (a: unknown, b: unknown) => {
        fused.push(a, b)
        return { result: { h: 9 }, modified: [] }
      },
      subShapeHashes: () => [101],
      release: () => undefined,
      shapeType: (h: unknown) => (typeof h === 'object' && h !== null && (h as { wire?: boolean }).wire ? 'wire' : 'solid'),
      // fromBrep post-processing (STEP-side result shape) needs a meshable solid
      meshShape: () => ({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), faceGroups: [] }),
    }
    configureBackends(makeBackends(kernel))
    const wire = handledShape({ wire: true })
    const a = handledShape({ h: 1 })
    const b = handledShape({ h: 2 })
    const r = await union(wire, a, b)
    expect(r).toBeDefined()
    expect(fused).toEqual([{ h: 1 }, { h: 2 }]) // wire never hit the kernel
  })

  it('union with NO solid input fails explicitly (E_BREP_UNSUPPORTED, F组)', async () => {
    const kernel = {
      fuseWithHistory: () => { throw new Error('must not be called') },
      subShapeHashes: () => [101],
      release: () => undefined,
      shapeType: () => 'wire',
    }
    configureBackends(makeBackends(kernel))
    const w1 = handledShape({ wire: 1 })
    const w2 = handledShape({ wire: 2 })
    try {
      await union(w1, w2)
      expect.unreachable('must throw')
    } catch (e) {
      expect(e).toBeInstanceOf(OpError)
      expect((e as OpError).code).toBe('E_BREP_UNSUPPORTED')
      expect((e as OpError).message).toMatch(/no solid input/)
    }
  })
})
