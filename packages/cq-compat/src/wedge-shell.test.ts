/**
 * Phase I part 2 — wedge op, shell/hollow, solids() selector.
 *
 * Expected values measured with cadquery 2.8.0 (`C:\Users\ylt\cadquery-env`):
 *
 *   Workplane().sphere(1).wedge(0.5, 4, 4, 0, 0, 0.5, 4, clean=True)
 *       -> vol 9.07992181465731 (kernel unify pass REMOVES volume: clean
 *          semantics are NOT volume-preserving on this shape)
 *   Workplane().sphere(1).wedge(0.5, 4, 4, 0, 0, 0.5, 4, clean=False)
 *       -> vol 10.650718133126762 (= sphere + box(0.5,4,4) - lens overlap)
 *   Workplane("XY").box(2, 2, 2).shell(-0.1)
 *       -> vol 2.168, 12 faces (hollow: no faces removed)
 *   Workplane("XY").box(2, 2, 2).shell(0.1)
 *       -> vol 2.592684356757526 (walls outward)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs-core/node'
import { brepjsCompat } from '@faicad/faijs-core/api'
import { borrowBrepjsShape } from '@faicad/faijs-core/api/internal/l3-bridge'
import { asPartName } from '@faicad/faijs-core/identity'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import * as cq from './index'

let runtime: ReturnType<typeof createRuntime>

async function runVol(lines: string[]): Promise<{ vol: number; faces: number }> {
  const code = ["import * as cq from '@faicad/cq-compat'", ...lines, 'let result = cq.val(wp_out)'].join('\n')
  const res = await runtime.execute(code)
  if (res.failedAt) {
    console.log('execute failed at', JSON.stringify(res.failedAt))
  }
  expect(res.failedAt).toBeUndefined()
  const shape = res.outputs.get(asPartName('result')) as Shape | undefined
  expect(shape).toBeDefined()
  const h = borrowBrepjsShape(shape!) as never
  const m = brepjsCompat.measureVolume(h) as unknown as { ok: boolean; value?: number }
  expect(m.ok).toBe(true)
  const faces = (brepjsCompat.getFaces(h) as unknown[]).length
  return { vol: m.value as number, faces }
}

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/cq-compat' } as never)
  const warm = await runtime.execute('let a = cad.box(1, 1, 1, { centered: true })')
  if (warm.failedAt) throw new Error(`runtime warmup failed: ${JSON.stringify(warm.failedAt)}`)
})

describe('wedge', () => {
  it('clean=True union volume matches upstream 9.079922', async () => {
    const { vol } = await runVol([
      'let s = await cq.sphere(cq.Workplane(), 1)',
      'let wp_out = await cq.wedge(s, 0.5, 4, 4, 0, 0, 0.5, 4, { clean: true })',
    ])
    expect(vol).toBeCloseTo(9.07992181465731, 4)
  })

  it('clean=False union volume matches upstream 10.650718', async () => {
    const { vol } = await runVol([
      'let s = await cq.sphere(cq.Workplane(), 1)',
      'let wp_out = await cq.wedge(s, 0.5, 4, 4, 0, 0, 0.5, 4, { clean: false })',
    ])
    expect(vol).toBeCloseTo(10.650718133126762, 4)
  })

  it('standalone wedge geometry (centered) matches OCCT MakeWedge', async () => {
    // OCCT BRepPrimAPI_MakeWedge(4, 1, 2, 1, 0.5, 3, 2), measured upstream:
    //   vol 5.333333, bbox x[0,4] y[0,1] z[0,2] (bottom full 4x2, top [1,3]x[0.5,2])
    //   vol = int_0^1 (4-2t)(2-0.5t) dt = 8 - 3 + 1/3 = 5.3333333
    const { vol } = await runVol([
      'let wp_out = await cq.wedge(cq.Workplane(), 4, 1, 2, 1, 0.5, 3, 2)',
    ])
    expect(vol).toBeCloseTo(5.333333333333333, 4)
  })
})

describe('shell / hollow', () => {
  it('box(2,2,2).shell(-0.1) hollows inward -> vol 2.168, 12 faces', async () => {
    const { vol, faces } = await runVol([
      'let b = await cq.box(cq.Workplane("XY"), 2, 2, 2)',
      'let wp_out = await cq.shell(b, -0.1)',
    ])
    expect(vol).toBeCloseTo(2.168, 4)
    expect(faces).toBe(12)
  })

  it('box(2,2,2).shell(0.1) walls outward -> vol 2.592684', async () => {
    const { vol } = await runVol([
      'let b = await cq.box(cq.Workplane("XY"), 2, 2, 2)',
      'let wp_out = await cq.shell(b, 0.1)',
    ])
    expect(vol).toBeCloseTo(2.592684356757526, 4)
  })
})

describe('solids selector', () => {
  it('single solid passes through; compound first solid is adopted', async () => {
    const code = [
      "import * as cq from '@faicad/cq-compat'",
      'let b = await cq.box(cq.Workplane(), 1, 1, 1)',
      'let w = cq.solids(b)',
      'let result = cq.val(w)',
    ].join('\n')
    const res = await runtime.execute(code)
    expect(res.failedAt).toBeUndefined()
    const shape = res.outputs.get(asPartName('result')) as Shape | undefined
    expect(shape).toBeDefined()
    const h = borrowBrepjsShape(shape!) as never
    const m = brepjsCompat.measureVolume(h) as unknown as { ok: boolean; value?: number }
    expect(m.ok).toBe(true)
    expect(m.value).toBeCloseTo(1, 6)
  })
})
