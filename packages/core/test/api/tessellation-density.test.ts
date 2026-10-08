/**
 * Tessellation density control (proposal 2026-10-07, docs/plans/
 * 2026-10-07-faijs-tessellation-density-proposal.md).
 *
 * Hosts (e.g. faijs-openscad parity runner) need coarse BREP triangulation to
 * match OpenSCAD $fa/$fs facet density. `CadRuntimeOptions.tessellation` sets
 * the global default deflection; per-primitive `segments` must still win
 * (OpenSCAD $fn override semantics).
 *
 * GOTCHA: the default must stay 2π/64 rad / 0.1 mm — existing hosts and
 * parity baselines depend on the current 64-segment tessellation density.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { createRuntime } from '../../src/index'
import { createNodePorts } from '../../src/node'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { configureTessellation, getTessellation } from '../../src/runtime-state'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

/** Triangle count of the cached output shape of a statement. */
function triCountOf(runtime: ReturnType<typeof createRuntime>, varName: string): number {
  const shape = runtime.getCachedOutput(varName as never) as { indices: Uint32Array } | undefined
  if (!shape) throw new Error(`no cached output for ${varName}`)
  return shape.indices.length / 3
}

async function sphereTriCount(code: string, tessellation?: { angularDeflection?: number; linearDeflection?: number }): Promise<number> {
  // index.ts re-exports createRuntimeWithCad(ports, mode?, options?) — options is
  // the 3rd arg (GOTCHA: the pure engine createRuntime has libs as 3rd).
  const runtime = createRuntime(createNodePorts(), 'brep', { tessellation })
  try {
    await runtime.execute(code)
    return triCountOf(runtime, 'part0')
  } finally {
    runtime.dispose()
  }
}

describe('tessellation density (proposal 2026-10-07)', () => {
  it('GOTCHA: default (no tessellation option) keeps the 64-segment baseline sphere density', async () => {
    // 64 segments: sphere lat/long mesh ≈ 64×32 quads → ~4096 tris. Lock the
    // coarse band so a silent default change fails here.
    const tris = await sphereTriCount('const part0 = cad.sphere(10)')
    expect(tris).toBeGreaterThan(2000)
    expect(tris).toBeLessThan(20000)
  })

  it('coarse global tessellation ($fa=12° / $fs=2mm) yields far fewer triangles on union of spheres', async () => {
    const code = 'const part0 = cad.union(cad.sphere(10), cad.sphere(10, { at: [8, 0, 0] }))'
    const fine = await sphereTriCount(code)
    const coarse = await sphereTriCount(code, {
      angularDeflection: (12 * Math.PI) / 180,
      linearDeflection: 2.0,
    })
    expect(coarse).toBeLessThan(fine * 0.6)
  })

  it('per-primitive segments still wins over global tessellation ($fn override)', async () => {
    // GOTCHA: OCCT angularDeflection is not a literal facet count — segments=5
    // does NOT produce a 20-face icosahedron. Explicit segments must override
    // the global knob entirely (2π/5=72° is coarser than the global 12°).
    const overridden = await sphereTriCount('const part0 = cad.sphere(10, { segments: 5 })')
    const globalCoarse = await sphereTriCount('const part0 = cad.sphere(10)', {
      angularDeflection: (12 * Math.PI) / 180,
      linearDeflection: 2.0,
    })
    expect(overridden).not.toBe(globalCoarse)
    expect(overridden).toBeLessThan(globalCoarse)
  })

  it('linearDeflection is size-adaptive: smaller sphere gets fewer segments at $fs=2mm', async () => {
    // Only linearDeflection is tightened (angular relaxed to 180°) so $fs is
    // the binding constraint — mirroring OpenSCAD min(360/$fa, 2πr/$fs).
    const coarseFa = { angularDeflection: Math.PI, linearDeflection: 2.0 }
    const small = await sphereTriCount('const part0 = cad.sphere(1)', coarseFa)
    const large = await sphereTriCount('const part0 = cad.sphere(20)', coarseFa)
    expect(small).toBeLessThan(large)
  })

  it('coarse tessellation keeps inscribed-approximation direction (volume < exact sphere)', async () => {
    const runtime = createRuntime(createNodePorts(), 'brep', {
      tessellation: { angularDeflection: (12 * Math.PI) / 180, linearDeflection: 2.0 },
    })
    try {
      await runtime.execute('const part0 = cad.sphere(10)')
      const shape = runtime.getCachedOutput('part0' as never) as { positions: Float32Array; indices: Uint32Array }
      // Divergence-theorem signed volume over the triangle soup.
      let vol = 0
      const p = shape.positions
      for (let i = 0; i < shape.indices.length; i += 3) {
        const a = shape.indices[i]! * 3
        const b = shape.indices[i + 1]! * 3
        const c = shape.indices[i + 2]! * 3
        vol += (
          p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) -
          p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) +
          p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)
        ) / 6
      }
      const exact = (4 / 3) * Math.PI * 10 ** 3
      expect(vol).toBeGreaterThan(0)
      expect(vol).toBeLessThan(exact)
      // $fa=12° inscribed polyhedron should be within ~1% of the exact volume.
      expect(1 - vol / exact).toBeLessThan(0.01)
    } finally {
      runtime.dispose()
    }
  })

  it('GOTCHA: non-positive deflection is a host bug and throws at configure time', () => {
    expect(() => configureTessellation({ angularDeflection: 0 })).toThrowError(/angularDeflection/)
    expect(() => configureTessellation({ linearDeflection: -1 })).toThrowError(/linearDeflection/)
  })

  it('getTessellation falls back to built-in defaults when unset', () => {
    // Configure nothing on a fresh state read: defaults must be 2π/64 and 0.1.
    configureTessellation({})
    const t = getTessellation()
    expect(t.angularDeflection).toBeCloseTo((2 * Math.PI) / 64)
    expect(t.linearDeflection).toBeCloseTo(0.1)
  })
})
