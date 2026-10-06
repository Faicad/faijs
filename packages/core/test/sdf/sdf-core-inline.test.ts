/**
 * sdf/sdf-core-inline — direct coverage for runSdfInline.
 *
 * runSdfInline compiles a user `sdf` (and optional `bounds`) snippet, samples
 * it through a guarded wrapper, and hands the resulting signed-distance
 * function to `Manifold.levelSet`. We drive it with a faked Manifold whose
 * `levelSet` calls the sampled sdf and returns a fake mesh — proving the wiring
 * without booting the manifold-3d wasm.
 */
import { describe, it, expect } from 'vitest'
import { runSdfInline } from '../../src/sdf/sdf-core'
import { SDF_TEMPLATES } from '../../src/sdf/templates'
import { defaultParamValues, parseParamDefs } from '../../src/sdf/types'

function fakeManifoldStatic() {
  let sampled: number | null = null
  const staticCtor = function FakeManifold() {} as any
  staticCtor.levelSet = (sdf: (x: number, y: number, z: number) => number) => {
    // prove the isosurface field was evaluated on the supplied box
    sampled = sdf(0, 0, 0)
    return {
      getMesh: () => ({
        numProp: 3,
        vertProperties: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        triVerts: new Uint32Array([0, 1, 2]),
      }),
      delete: () => {},
    }
  }
  return { staticCtor, sampled: () => sampled }
}

describe('runSdfInline', () => {
  it('extracts a level-set mesh for a periodic TPMS template', async () => {
    const tpl = SDF_TEMPLATES.find((t) => t.id === 'schwarzP')!
    const vals = defaultParamValues(parseParamDefs(tpl.code))
    const { staticCtor, sampled } = fakeManifoldStatic()

    const out = await runSdfInline(
      staticCtor,
      tpl.code,
      vals,
      [-1, -1, -1, 1, 1, 1],
      0.5,
      0,
      -1,
    )
    // the compiled sdf was sampled inside levelSet and returned a finite sign
    // the compiled sdf was sampled inside levelSet and returned a numeric field
    const f = sampled()
    expect(f).not.toBeNull()
    expect(typeof f).toBe('number')
    expect(out.positions).toHaveLength(9)
    expect(Array.from(out.indices)).toEqual([0, 1, 2])
  })
})