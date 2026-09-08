/**
 * P4 batch-1 op tests — sphere / cylinder / rarray / chamfer / cutThruAll /
 * combine and the box each-point extension.
 *
 * Expected values are computed analytically where the geometry is exact;
 * semantic assertions (center position, solid count, face count) mirror the
 * upstream cadquery 2.8.0 tests they were verified against. Bounds-derived
 * assertions carry kernel tolerance padding (~0.003–0.006mm) so they use a
 * 0.05mm slack.
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

function solidCount(shape: Shape): number {
  return (brepjsCompat.getSolids(borrowBrepjsShape(shape) as never) as unknown[]).length
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

/** Bounding-box center via brepjs bounds (carries kernel tolerance padding). */
function center(shape: Shape): [number, number, number] {
  const b = brepjsCompat.getBounds(borrowBrepjsShape(shape) as never) as unknown as Record<string, number>
  return [(b.xMin + b.xMax) / 2, (b.yMin + b.yMax) / 2, (b.zMin + b.zMax) / 2]
}

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/cq-compat' } as never)
  const warm = await runtime.execute('let a = cad.box(1, 1, 1, { centered: true })')
  expect(warm.failedAt).toBeUndefined()
}, 120000)

describe('cq-compat P4 batch-1 ops', () => {
  it('sphere defaults: one full sphere centered at origin (upstream testSphereDefaults)', async () => {
    const s = await runShape(["let wp_out = await cq.sphere(cq.Workplane('XY'), 10)"])
    expect(solidCount(s)).toBe(1)
    expect(faceCount(s)).toBe(1)
    expect(volume(s)).toBeCloseTo((4 / 3) * Math.PI * 1000, 0)
    const c = center(s)
    for (const v of c) expect(Math.abs(v)).toBeLessThan(0.05)
  }, 60000)

  it('sphere at rect corners with combine=false -> compound of 4 (testSpherePointList)', async () => {
    const s = await runShape([
      "let wp0 = cq.rect(cq.Workplane('XY'), 4.0, 4.0, { forConstruction: true })",
      'let wp1 = cq.vertices(wp0)',
      'let wp_out = await cq.sphere(wp1, 0.25, { combine: false })',
    ])
    expect(solidCount(s)).toBe(4)
    expect(faceCount(s)).toBe(4)
  }, 60000)

  it('sphere combine=true fuses corner spheres into one solid (testSphereCombine)', async () => {
    const s = await runShape([
      "let wp0 = cq.rect(cq.Workplane('XY'), 4.0, 4.0, { forConstruction: true })",
      'let wp1 = cq.vertices(wp0)',
      'let wp_out = await cq.sphere(wp1, 2.25, { combine: true })',
    ])
    expect(solidCount(s)).toBe(1)
    expect(faceCount(s)).toBe(4)
  }, 60000)

  it('sphere centered=false offsets bbox corner to the point', async () => {
    const s = await runShape([
      'let wp_out = await cq.sphere(cq.Workplane(), 10, { centered: [false, false, false] })',
    ])
    const c = center(s)
    expect(c[0]).toBeCloseTo(10, 1)
    expect(c[1]).toBeCloseTo(10, 1)
    expect(c[2]).toBeCloseTo(10, 1)
  }, 60000)

  it('cylinder defaults: centered on origin, 3 faces (testCylinderDefaults)', async () => {
    const s = await runShape(["let wp_out = await cq.cylinder(cq.Workplane('XY'), 20, 10)"])
    expect(solidCount(s)).toBe(1)
    expect(faceCount(s)).toBe(3)
    expect(volume(s)).toBeCloseTo(Math.PI * 100 * 20, 0)
    const c = center(s)
    for (const v of c) expect(Math.abs(v)).toBeLessThan(0.05)
  }, 60000)

  it('cylinder per-axis centering matches upstream table (testCylinderCentering)', async () => {
    // centered=(False, True, False): x uncentered -> center x = radius;
    // y centered -> 0; z uncentered -> center z = h/2 (upstream expected_z table)
    const s = await runShape([
      "let wp_out = await cq.cylinder(cq.Workplane('XY'), 40, 10, { centered: [false, true, false] })",
    ])
    const c = center(s)
    expect(c[0]).toBeCloseTo(10, 1)
    expect(c[1]).toBeCloseTo(0, 1)
    expect(c[2]).toBeCloseTo(20, 1)
  }, 60000)

  it('cylinder direct=(1,0,0) rotates the axis (testCylinderCenteringAndDirection)', async () => {
    // direct=(1,0,0), centered=(True,True,True): axis along X, centered at origin
    const s = await runShape([
      "let wp_out = await cq.cylinder(cq.Workplane('XY'), 40, 10, { direct: [1, 0, 0] })",
    ])
    const c = center(s)
    for (const v of c) expect(Math.abs(v)).toBeLessThan(0.05)
    // bbox: length 40 along X, diameter 20 along Y/Z
    const b = brepjsCompat.getBounds(borrowBrepjsShape(s) as never) as unknown as Record<string, number>
    expect(Math.abs(b.xMax - b.xMin - 40)).toBeLessThan(0.05)
    expect(Math.abs(b.yMax - b.yMin - 20)).toBeLessThan(0.05)
    expect(Math.abs(b.zMax - b.zMin - 20)).toBeLessThan(0.05)
  }, 60000)

  it('rarray pushes a centered grid (upstream rarray)', async () => {
    const wp = cq.rarray(cq.Workplane('XY'), 2, 2, 3, 2)
    expect(wp.pts).toEqual([
      [-2, -1], [-2, 1], [0, -1], [0, 1], [2, -1], [2, 1],
    ])
  })

  it('rarray center=false puts the lower corner on the origin', async () => {
    const wp = cq.rarray(cq.Workplane('XY'), 2, 2, 2, 2, false)
    expect(wp.pts).toEqual([
      [0, 0], [0, 2], [2, 0], [2, 2],
    ])
  })

  it('box at rarray points with combine=false -> compound of 5 (test_getitem geometry)', async () => {
    const s = await runShape([
      'let wp0 = cq.rarray(cq.Workplane(), 2, 0, 5, 1)',
      'let wp_out = await cq.box(wp0, 1, 1, 1, { combine: false })',
    ])
    expect(solidCount(s)).toBe(5)
  }, 60000)

  it('chamfer symmetric: cube -> 10 faces (testChamfer)', async () => {
    const s = await runShape([
      "let wp0 = await cq.box(cq.Workplane('XY'), 1, 1, 1)",
      "let wp1 = cq.faces(wp0, '>Z')",
      'let wp_out = await cq.chamfer(wp1, 0.1)',
    ])
    expect(faceCount(s)).toBe(10)
  }, 60000)

  it('chamfer length2 (asymmetric) throws — occt-wasm uniform distance only', async () => {
    const code = [
      "import * as cq from '@faicad/cq-compat'",
      "let wp0 = await cq.box(cq.Workplane('XY'), 1, 1, 1)",
      "let wp1 = cq.faces(wp0, '>Z')",
      'let wp_out = await cq.chamfer(wp1, 0.1, 0.2)',
      'let result = cq.val(wp_out)',
    ].join('\n')
    const res = await runtime.execute(code)
    expect(res.failedAt).toBeDefined()
  }, 60000)

  it('cutThruAll cuts both directions (testCutThroughAll plate hole)', async () => {
    const s = await runShape([
      "let wp0 = await cq.extrude(cq.rect(cq.Workplane('XY'), 2.0, 2.0), 0.5)",
      'let wp1 = cq.circle(wp0, 0.5)',
      'let wp_out = await cq.cutThruAll(wp1)',
    ])
    // plate 2x2x0.5 with a Ø1 through hole: 4 side + top + bottom + hole wall = 7
    expect(faceCount(s)).toBe(7)
    const expected = 2 * 2 * 0.5 - Math.PI * 0.25 * 0.5
    expect(volume(s)).toBeCloseTo(expected, 3)
  }, 60000)

  it('cutThruAll without a pending profile throws', async () => {
    const code = [
      "import * as cq from '@faicad/cq-compat'",
      "let wp0 = await cq.box(cq.Workplane('XY'), 1, 1, 1)",
      'let wp_out = await cq.cutThruAll(wp0)',
      'let result = cq.val(wp_out)',
    ].join('\n')
    const res = await runtime.execute(code)
    expect(res.failedAt).toBeDefined()
  }, 60000)

  it('combine on a single fused solid cleans without changing volume', async () => {
    const s = await runShape([
      "let wp0 = await cq.extrude(cq.rect(cq.Workplane('XY'), 2.0, 2.0), 0.5)",
      "let wp1 = await cq.workplane(cq.faces(wp0, '>Z'))",
      'let wp2 = await cq.extrude(cq.rect(wp1, 1.0, 1.0), 0.5)',
      'let wp_out = await cq.combine(wp2)',
    ])
    expect(solidCount(s)).toBe(1)
    expect(volume(s)).toBeCloseTo(2 * 2 * 0.5 + 1 * 1 * 0.5, 3)
  }, 60000)
})
