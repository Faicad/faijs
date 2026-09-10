/**
 * Phase H — 2D drafting ops (moveTo/lineTo/polyline/close/wire).
 *
 * Expected values measured with cadquery 2.8.0 (`C:\Users\ylt\cadquery-env`):
 *
 *   Workplane("XY").lineTo(1,0).lineTo(1,1).close().extrude(0.2)
 *       -> vol 0.100000 (triangle area 0.5 x 0.2), 5 faces
 *   Workplane("XY").polyline([(0,0),(90,0),(90,30),(30,30),(30,60),(0,60)])
 *       .close().extrude(10)                       -> vol 36000.0
 *   Workplane("XY").moveTo(2,0).lineTo(4,0).lineTo(4,2).close().extrude(1)
 *       -> vol 2.0
 *   Workplane("XY").lineTo(0,10).lineTo(5,0).close().revolve()
 *       -> vol 261.799388 (cone, pi*5^2*10/3), 2 faces / 2 edges / 2 vertices
 *
 * Semantics follow `Workplane.close` / `Workplane.wire` (cq.py): close()
 * appends the closing segment only when end point is >1e-6 from the first
 * point, then delegates to wire(); wire() is a no-op when no edges are free.
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

describe('cq-compat phase H — 2D drafting', () => {
  it('lineTo chain + close + extrude (testTriangularPrism)', async () => {
    const s = await runShape([
      "let w1 = cq.lineTo(cq.Workplane('XY'), 1, 0)",
      'let w2 = await cq.lineTo(w1, 1, 1)',
      'let w3 = await cq.close(w2)',
      'let wp_out = await cq.extrude(w3, 0.2)',
    ])
    expect(volume(s)).toBeCloseTo(0.1, 6)
    expect(faceCount(s)).toBe(5)
  })

  it('ellipse drafted + extrude (upstream ellipse(x_r, y_r) eachpoint semantics)', async () => {
    // cadquery 2.8.0: Workplane("XY").ellipse(1.5, 1).extrude(2)
    //   -> vol pi*1.5*1*2 = 9.424778, 3 faces
    const s = await runShape([
      "let w1 = cq.ellipse(cq.Workplane('XY'), 1.5, 1)",
      'let wp_out = await cq.extrude(w1, 2)',
    ])
    expect(volume(s)).toBeCloseTo(Math.PI * 1.5 * 1 * 2, 5)
    expect(faceCount(s)).toBe(3)
  })

  it('moveTo starts a new chain (upstream _findFromPoint)', async () => {
    const s = await runShape([
      "let w1 = cq.moveTo(cq.Workplane('XY'), 2, 0)",
      'let w2 = await cq.lineTo(w1, 4, 0)',
      'let w3 = await cq.lineTo(w2, 4, 2)',
      'let w4 = await cq.close(w3)',
      'let wp_out = await cq.extrude(w4, 1)',
    ])
    expect(volume(s)).toBeCloseTo(2.0, 6)
  })

  it('polyline + close + extrude (testWorkplaneCenterOptions profile)', async () => {
    const s = await runShape([
      "let w1 = cq.polyline(cq.Workplane('XY'), [[0,0],[90,0],[90,30],[30,30],[30,60],[0,60]])",
      'let w2 = await cq.close(w1)',
      'let wp_out = await cq.extrude(w2, 10)',
    ])
    expect(volume(s)).toBeCloseTo(36000, 3)
  })

  it('vLine/hLine relative drafting equals absolute lineTo', async () => {
    const a = await runShape([
      "let w1 = cq.hLine(cq.Workplane('XY'), 3)",
      'let w2 = await cq.vLine(w1, 4)',
      'let w3 = await cq.close(w2)',
      'let wp_out = await cq.extrude(w3, 1)',
    ])
    const b = await runShape([
      "let w1 = cq.lineTo(cq.Workplane('XY'), 3, 0)",
      'let w2 = await cq.lineTo(w1, 3, 4)',
      'let w3 = await cq.close(w2)',
      'let wp_out = await cq.extrude(w3, 1)',
    ])
    expect(volume(a)).toBeCloseTo(volume(b), 9)
    expect(volume(a)).toBeCloseTo(6, 6)
  })

  it('explicit wire() after close() is a no-op (close already consumed edges)', async () => {
    const s = await runShape([
      "let w1 = cq.lineTo(cq.Workplane('XY'), 1, 0)",
      'let w2 = await cq.lineTo(w1, 1, 1)',
      'let w3 = await cq.close(w2)',
      'let w4 = await cq.wire(w3)',
      'let wp_out = await cq.extrude(w4, 0.2)',
    ])
    expect(volume(s)).toBeCloseTo(0.1, 6)
  })

  it('close() without a start point throws (upstream ValueError)', async () => {
    const res = await runtime.execute(
      [
        "import * as cq from '@faicad/cq-compat'",
        "let w1 = cq.moveTo(cq.Workplane('XY'), 1, 1)",
        'let r = await cq.close(w1)',
        'let result = cq.val(r)',
      ].join('\n'),
    )
    expect(res.failedAt).toBeDefined()
  })

  it('drafted wire + revolve builds a cone (testRevolveCone)', async () => {
    const s = await runShape([
      "let w1 = cq.lineTo(cq.Workplane('XY'), 0, 10)",
      'let w2 = await cq.lineTo(w1, 5, 0)',
      'let w3 = await cq.close(w2)',
      'let wp_out = await cq.revolve(w3)',
    ])
    expect(volume(s)).toBeCloseTo(261.799388, 3)
  })

  it('drafted wire works as a cut tool (cutBlind)', async () => {
    // 10x10x10 box with a triangular prism (area 0.5 x depth 1) removed.
    const s = await runShape([
      "let b = await cq.box(cq.Workplane('XY'), 10, 10, 10)",
      "let f = await cq.faces(b, '>Z')",
      'let w = await cq.workplane(f)',
      'let w1 = await cq.lineTo(w, 1, 0)',
      'let w2 = await cq.lineTo(w1, 1, 1)',
      'let w3 = await cq.close(w2)',
      'let wp_out = await cq.cutBlind(w3, 1)',
    ])
    expect(volume(s)).toBeCloseTo(1000 - 0.5, 3)
  })
})
