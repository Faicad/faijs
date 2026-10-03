/**
 * cutEach (roadmap B1-8, G-C14).
 *
 * Truth measured from the reference STEP, not from the upstream source text:
 *
 *   w = Workplane().box(3, 2, 2); c = Workplane().box(2, 2, 2).val()
 *   w0 = w.vertices().cutEach(lambda loc: c.located(loc))
 *       ref out/ref/tests.test_cadquery__TestCadQuery__testCutEach__w0.step:
 *       vol 4  bbox x[-0.5,0.5] y[-1,1] z[-1,1]  topo f6/e12/v8/s1
 *       (8 corner cutters of 2×2×2 leave the 1×2×2 core)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { getBrepApi } from '@faicad/faijs/brep/handle-bridge'
import { brepOf } from '@faicad/faijs/shape'
import type { BrepHandle } from '@faicad/faijs/brep/engine/types'
import { asPartName } from '@faicad/faijs/identity'
import type { Shape } from '@faicad/faijs/mesh/types'
import * as cq from './index'

let runtime: ReturnType<typeof createRuntime>

/** Run a `.fai.js` snippet whose last line binds `result`; measure the result. */
async function runMeasured(lines: string[]): Promise<{ vol: number; bbox: { xmin: number; xmax: number } }> {
  const code = ["import * as cq from '@faicad/faijs-cadquery'", ...lines].join('\n')
  const res = await runtime.execute(code)
  expect(res.failedAt).toBeUndefined()
  const shape = res.outputs.get(asPartName('result')) as Shape | undefined
  expect(shape).toBeDefined()
  const h = brepOf(shape!) as BrepHandle
  const api = getBrepApi()
  return { vol: api.getVolume(h), bbox: api.getBoundingBox(h) }
}

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/faijs-cadquery' } as never)
  const warm = await runtime.execute('let a = cad.box(1, 1, 1, { centered: true })')
  if (warm.failedAt) throw new Error(`runtime warmup failed: ${JSON.stringify(warm.failedAt)}`)
})

describe('cutEach', () => {
  it('cuts the placed item at every stack vertex — ref vol 4, bbox x[-0.5,0.5]', async () => {
    const { vol, bbox } = await runMeasured([
      'let w = await cq.box(cq.Workplane(), 3, 2, 2)',
      'let c = await cq.box(cq.Workplane(), 2, 2, 2)',
      'let wv = await cq.vertices(w)',
      'let w0 = await cq.cutEach(wv, c)',
      'let result = cq.val(w0)',
    ])
    expect(vol).toBeCloseTo(4, 6)
    expect(bbox.xmin).toBeCloseTo(-0.5, 6)
    expect(bbox.xmax).toBeCloseTo(0.5, 6)
  })

  it('cuts the pushed-point form too (no narrowing → base is findSolid)', async () => {
    // Same base/cutter pair, but the loci come from `pushPoints` instead of a
    // vertex selection: the 2×2×2 cutter is placed once at the workplane origin
    // and removed from the 3×2×2 box, leaving the two 0.5×2×2 end slabs
    // (vol 4) — the other branch of the context-solid lookup (`wp.baseShape`
    // is unset here, so `findSolid` supplies it).
    const { vol, bbox } = await runMeasured([
      'let w = await cq.box(cq.Workplane(), 3, 2, 2)',
      'let c = await cq.box(cq.Workplane(), 2, 2, 2)',
      'let wp = cq.pushPoints(w, [[0, 0]])',
      'let out = await cq.cutEach(wp, c)',
      'let result = cq.val(out)',
    ])
    expect(vol).toBeCloseTo(4, 6)
    expect(bbox.xmin).toBeCloseTo(-1.5, 6)
    expect(bbox.xmax).toBeCloseTo(1.5, 6)
  })

  it('throws when no solid can be found (upstream ValueError)', async () => {
    // Upstream: `w1 = Workplane().hLine(1).vLine(1).close()` then
    // `w1.cutEach(...)` raises ValueError — a wire carries no solid.
    await expect(
      cq.cutEach(cq.close(cq.vLine(cq.hLine(cq.Workplane(), 1), 1)), cq.solidMakeCone(1, 0.5, 1)),
    ).rejects.toThrow(/cannot find a solid on the stack/)
  })
})
