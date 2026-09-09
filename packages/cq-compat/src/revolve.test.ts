/**
 * F2 revolve op tests — semantics verified against cadquery 2.8.0
 * (cadquery-env, empirically measured volumes, not analytic guesses):
 *
 *   rect(10,10).revolve()                          → vol 3141.592654, 3 faces
 *   rect(10,10).revolve(270,(-5,-5),(-5,5),False)  → vol 2356.194490, 5 faces
 *   rect(10,10).revolve(360,(20,0),(20,10))        → vol 12566.370614, 4 faces
 *   box.transformed((90,0,0)).move(5,0).rect(3,4,centered=False)
 *     .revolve(360,(0,0,0),(0,1,0),combine="cut")  → vol  914.159265
 *   (move(5,0) ≡ pushPoints([(5,0)]) for rect positioning — verified equal)
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

async function runShape(lines: string[]): Promise<Shape> {
  const code = ["import * as cq from '@faicad/cq-compat'", ...lines, 'let result = cq.val(wp_out)'].join('\n')
  const res = await runtime.execute(code)
  expect(res.failedAt).toBeUndefined()
  const shape = res.outputs.get(asPartName('result')) as Shape | undefined
  expect(shape).toBeDefined()
  return shape!
}

function faceCount(shape: Shape): number {
  return (brepjsCompat.getFaces(borrowBrepjsShape(shape) as never) as unknown[]).length
}

function volume(shape: Shape): number {
  const r = brepjsCompat.measureVolume(borrowBrepjsShape(shape) as never) as unknown as {
    ok: boolean
    value?: number
  }
  expect(r.ok).toBe(true)
  return r.value as number
}

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/cq-compat' } as never)
  const warm = await runtime.execute('let a = cad.box(1, 1, 1, { centered: true })')
  expect(warm.failedAt).toBeUndefined()
}, 120000)

describe('cq-compat F2 revolve', () => {
  it('KNOWN KERNEL LIMIT: revolve of an axis-crossing face throws (upstream OCCT accepts it)', async () => {
    // Upstream cadquery 2.8.0: rect(10,10) centered on the revolve axis crosses
    // the axis; full OCCT 7.x revolves it into a self-intersecting solid (vol
    // 3141.592654, 3 faces). The vendored occt-wasm revolveVec rejects this with
    // REVOLVE_FAILED (verified deterministic, 3/3 probe rounds). No mirror needs
    // this geometry — testRevolveCylinder__result corresponds to the test's LAST
    // assignment (270-degree, non-crossing axis). Documented, not worked around.
    const res = await runtime.execute(
      [
        "import * as cq from '@faicad/cq-compat'",
        "let wp1 = cq.rect(cq.Workplane('XY'), 10, 10)",
        'let wp2 = await cq.revolve(wp1)',
      ].join('\n'),
    )
    expect(res.failedAt).toBeDefined()
    expect(JSON.stringify(res.failedAt)).toContain('REVOLVE_FAILED')
  }, 60000)

  it('default revolve of a non-crossing profile: cylinder r=10 h=10 (upstream default-axis semantics)', async () => {
    // Same default axis as upstream `.revolve()` (local origin -> local (0,1)),
    // with the profile shifted off the axis so the kernel accepts it.
    const s = await runShape([
      "let wp1 = cq.rect(cq.Workplane('XY'), 10, 10, { centered: false })",
      'let wp_out = await cq.revolve(wp1)',
    ])
    // rect corner at origin spans x 0..10, y 0..10 -> cylinder r=10, h=10.
    expect(volume(s)).toBeCloseTo(Math.PI * 100 * 10, 3)
    expect(faceCount(s)).toBe(3)
  }, 60000)

  it('270-degree revolve with explicit axis and combine=false (testRevolveCylinder last branch)', async () => {
    const s = await runShape([
      "let wp1 = cq.rect(cq.Workplane('XY'), 10, 10)",
      'let wp_out = await cq.revolve(wp1, 270, [-5, -5], [-5, 5], false)',
    ])
    expect(volume(s)).toBeCloseTo(2356.194490, 3)
    expect(faceCount(s)).toBe(5)
  }, 60000)

  it('square donut: revolve around off-plane axis (testRevolveDonut)', async () => {
    const s = await runShape([
      "let wp1 = cq.rect(cq.Workplane('XY'), 10, 10)",
      'let wp_out = await cq.revolve(wp1, 360, [20, 0], [20, 10])',
    ])
    expect(volume(s)).toBeCloseTo(12566.370614, 3)
    expect(faceCount(s)).toBe(4)
  }, 60000)

  it('combine="cut": revolved tube subtracted from base box (testRevolveCut)', async () => {
    const s = await runShape([
      'let box = await cq.box(cq.Workplane(), 10, 10, 10)',
      'let t = await cq.transformed(box, { rotate: [90, 0, 0] })',
      'let p = cq.pushPoints(t, [[5, 0]])',
      'let r = cq.rect(p, 3, 4, { centered: false })',
      "let wp_out = await cq.revolve(r, 360, [0, 0, 0], [0, 1, 0], 'cut')",
    ])
    expect(volume(s)).toBeCloseTo(914.159265, 3)
  }, 60000)
})
