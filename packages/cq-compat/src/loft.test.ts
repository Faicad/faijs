/**
 * F3 loft op tests — semantics verified against cadquery 2.8.0 ref STEPs
 * (volumes probed from out/ref, upstream `loft()` default is ruled=False):
 *
 *   circle(4).workplane(5).rect(2,2).loft()            → vol 114.450906, 7 faces
 *   box.faces(">Z").workplane().circle(2)
 *     .workplane(invert=True,offset=12).rect(3,2)
 *     .loft(combine="cut")                             → vol 903.288863
 *   circle(20).workplane(10).circle(50).loft()         → vol 40840.704497 (cone)
 *   polygon(8,20).workplane(4).transformed(rotate=(0,0,15))
 *     .polygon(8,20).loft()                            → vol 1118.520674, 10 faces
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

describe('cq-compat F3 loft', () => {
  it('circle -> offset rect smooth loft (testLoft__s)', async () => {
    const s = await runShape([
      "let w1 = cq.circle(cq.Workplane('XY'), 4)",
      'let w2 = await cq.workplane(w1, { offset: 5 })',
      'let w3 = cq.rect(w2, 2, 2)',
      'let wp_out = await cq.loft(w3)',
    ])
    expect(volume(s)).toBeCloseTo(114.450906, 2)
    expect(faceCount(s)).toBe(7)
  }, 60000)

  it('combine="cut" through inverted offset workplane (testLoft__cut)', async () => {
    const s = await runShape([
      'let box = await cq.box(cq.Workplane(), 10, 10, 10)',
      'let f = cq.faces(box, ">Z")',
      'let w1 = await cq.workplane(f)',
      'let w2 = cq.circle(w1, 2)',
      'let w3 = await cq.workplane(w2, { invert: true, offset: 12 })',
      'let w4 = cq.rect(w3, 3, 2)',
      "let wp_out = await cq.loft(w4, { combine: 'cut' })",
    ])
    expect(volume(s)).toBeCloseTo(903.288863, 2)
  }, 60000)

  it('two-circle smooth loft is a truncated cone (testCup__s1)', async () => {
    const s = await runShape([
      "let w1 = cq.circle(cq.Workplane('XY'), 20)",
      'let w2 = await cq.workplane(w1, { offset: 10 })',
      'let w3 = cq.circle(w2, 50)',
      'let wp_out = await cq.loft(w3)',
    ])
    expect(volume(s)).toBeCloseTo(40840.704497, 1)
  }, 60000)

  it('twisted loft: offset plane + transformed rotate between sections (testTwistedLoft__s)', async () => {
    const s = await runShape([
      'let w1 = cq.polygon(cq.Workplane("XY"), 8, 20)',
      'let w2 = await cq.workplane(w1, { offset: 4 })',
      'let w3 = await cq.transformed(w2, { rotate: [0, 0, 15] })',
      'let w4 = cq.polygon(w3, 8, 20)',
      'let wp_out = await cq.loft(w4)',
    ])
    expect(volume(s)).toBeCloseTo(1118.520674, 2)
    expect(faceCount(s)).toBe(10)
  }, 60000)

  // ---- degenerate (vertex) sections -------------------------------------
  // Upstream: func.loft(plane(1,1), vertex(0,0,1)) -> ruled pyramid, and
  // func.loft(vertex(0,0,-1), plane(1,1), vertex(0,0,1)) -> SMOOTH spline body
  // whose volume (1.066667) exceeds the ruled double pyramid (0.666667).
  it('loft to a single end vertex is a ruled pyramid (test_loft_vertex__r2)', async () => {
    const s = await runShape([
      "let w1 = cq.rect(cq.Workplane('XY'), 1, 1)",
      'let wp_out = await cq.loft(w1, { endPoint: [0, 0, 1] })',
    ])
    expect(volume(s)).toBeCloseTo(0.3333333333333335, 6)
    expect(faceCount(s)).toBe(5)
  }, 60000)

  it('loft between two degenerate vertices is smooth, not ruled (test_loft_vertex__r3)', async () => {
    const s = await runShape([
      "let w1 = cq.rect(cq.Workplane('XY'), 1, 1)",
      'let wp_out = await cq.loft(w1, { startPoint: [0, 0, -1], endPoint: [0, 0, 1] })',
    ])
    expect(volume(s)).toBeCloseTo(1.0666666666666667, 6)
    expect(faceCount(s)).toBe(4)
  }, 60000)
})
