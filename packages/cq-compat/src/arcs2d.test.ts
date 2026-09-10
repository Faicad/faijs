/**
 * Phase I — arc drafting ops (threePointArc/sagittaArc/radiusArc/
 * tangentArcPoint/spline).
 *
 * Expected values measured with cadquery 2.8.0 (`C:\Users\ylt\cadquery-env`):
 *
 *   Workplane("XY").sagittaArc((10,0),2).close().extrude(2)
 *       -> vol 27.501465787874714, 4 faces
 *   Workplane("XY").sagittaArc((10,0),2).sagittaArc((0,0),2).close().extrude(2)
 *       -> vol 55.00293157574942 (two opposite bulges)
 *   Workplane("XY").moveTo(5,0).threePointArc((0,2.5),(-5,0))
 *       .threePointArc((0,-2.5),(5,0)).close().extrude(3)
 *       -> vol 104.8348167191279
 *   Workplane("XY").moveTo(0,0).radiusArc((4,0),3).close().extrude(1)
 *       -> vol 2.095412951043117
 *   Workplane("XY").hLine(1).tangentArcPoint((1,1),relative=False)
 *       .hLineTo(0).tangentArcPoint((0,0),relative=False).close().extrude(1)
 *       -> vol 1.7853981633974483 (= 1 + pi/4)
 *   Workplane("XY").vLine(2).tangentArcPoint((1,0)).tangentArcPoint((1,0))
 *       .tangentArcPoint((1,0)).vLine(-2).close().extrude(1)
 *       -> vol 6.392699081698724 (= 6 + pi/8... upstream asserts area 2*3+0.5*pi*0.25)
 *   Workplane("XY").spline(circlePts).tangentArcPoint((0,1),relative=False)
 *       .close().extrude(1) -> vol 3.126378 (spline + tangent continuation)
 *
 * Semantics follow cq.py threePointArc/sagittaArc/radiusArc/tangentArcPoint/
 * spline (incl. the sag-vector ±90° rotation and the |r|−sqrt(r²−l²) sagitta).
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
  expect(warm.failedAt).toBeUndefined()
}, 120000)

const TOL = 1e-6

describe('arc drafting ops (phase I)', () => {
  it('sagittaArc + close makes a half-bulge disc segment', async () => {
    const { vol, faces } = await runVol([
      "let wp0 = cq.sagittaArc(cq.Workplane('XY'), [10, 0], 2)",
      'let wp1 = await cq.close(wp0)',
      'let wp_out = await cq.extrude(wp1, 2)',
    ])
    expect(Math.abs(vol - 27.501465787874714)).toBeLessThan(TOL)
    expect(faces).toBe(4)
  })

  it('two opposite sagittaArcs double the volume', async () => {
    const { vol } = await runVol([
      "let wp0 = cq.sagittaArc(cq.Workplane('XY'), [10, 0], 2)",
      "let wp1 = await cq.sagittaArc(wp0, [0, 0], 2)",
      'let wp2 = await cq.close(wp1)',
      'let wp_out = await cq.extrude(wp2, 2)',
    ])
    expect(Math.abs(vol - 55.00293157574942)).toBeLessThan(TOL)
  })

  it('threePointArc ellipse-like closed ring', async () => {
    const { vol } = await runVol([
      "let wp0 = await cq.moveTo(cq.Workplane('XY'), 5, 0)",
      "let wp1 = await cq.threePointArc(wp0, [0, 2.5], [-5, 0])",
      "let wp2 = await cq.threePointArc(wp1, [0, -2.5], [5, 0])",
      'let wp3 = await cq.close(wp2)',
      'let wp_out = await cq.extrude(wp3, 3)',
    ])
    expect(Math.abs(vol - 104.8348167191279)).toBeLessThan(TOL)
  })

  it('radiusArc derives the sagitta from the radius', async () => {
    const { vol } = await runVol([
      "let wp0 = await cq.moveTo(cq.Workplane('XY'), 0, 0)",
      "let wp1 = await cq.radiusArc(wp0, [4, 0], 3)",
      'let wp2 = await cq.close(wp1)',
      'let wp_out = await cq.extrude(wp2, 1)',
    ])
    expect(Math.abs(vol - 2.095412951043117)).toBeLessThan(TOL)
  })

  it('tangentArcPoint after hLine (absolute endpoint)', async () => {
    const { vol } = await runVol([
      "let wp0 = await cq.hLine(cq.Workplane('XY'), 1)",
      "let wp1 = await cq.tangentArcPoint(wp0, [1, 1], false, false)",
      "let wp2 = await cq.hLineTo(wp1, 0)",
      "let wp3 = await cq.tangentArcPoint(wp2, [0, 0], false, false)",
      'let wp4 = await cq.close(wp3)',
      'let wp_out = await cq.extrude(wp4, 1)',
    ])
    expect(Math.abs(vol - 1.7853981633974483)).toBeLessThan(TOL)
  })

  it('consecutive tangent arcs chain the end tangent', async () => {
    const { vol } = await runVol([
      "let wp0 = await cq.vLine(cq.Workplane('XY'), 2)",
      "let wp1 = await cq.tangentArcPoint(wp0, [1, 0])",
      "let wp2 = await cq.tangentArcPoint(wp1, [1, 0])",
      "let wp3 = await cq.tangentArcPoint(wp2, [1, 0])",
      "let wp4 = await cq.vLine(wp3, -2)",
      'let wp5 = await cq.close(wp4)',
      'let wp_out = await cq.extrude(wp5, 1)',
    ])
    expect(Math.abs(vol - 6.392699081698724)).toBeLessThan(TOL)
  })

  it('tangentArcPoint continues a spline', async () => {
    const angles = Array.from({ length: 10 }, (_, i) => (i * 1.5 * Math.PI) / 10)
    const pts = angles.map((a) => [Math.sin(a), Math.cos(a)] as [number, number])
    const ptsJson = JSON.stringify(pts)
    const { vol } = await runVol([
      "let wp0 = cq.spline(cq.Workplane('XY'), " + ptsJson + ')',
      "let wp1 = await cq.tangentArcPoint(wp0, [0, 1], false, false)",
      'let wp2 = await cq.close(wp1)',
      'let wp_out = await cq.extrude(wp2, 1)',
    ])
    // Upstream asserts approx(pi, 1) — ref probed at 3.126378.
    expect(Math.abs(vol - 3.126378)).toBeLessThan(1e-4)
  })

  it('radiusArc throws when the radius cannot reach the endpoint', async () => {
    const code = [
      "import * as cq from '@faicad/cq-compat'",
      "let wp0 = await cq.moveTo(cq.Workplane('XY'), 0, 0)",
      "let wp1 = await cq.radiusArc(wp0, [10, 0], 2)",
      'let result = cq.val(wp1)',
    ].join('\n')
    const res = await runtime.execute(code)
    expect(res.failedAt).toBeDefined()
  })
})
