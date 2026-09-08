/**
 * Parity-fix regression tests — selector indexing, pushPoints cut repetition,
 * single-solid union, and cboreHole point propagation.
 *
 * Each test mirrors a bug found by the mini_lathe ⇄ CadQuery comparison
 * (docs/analysis/2026-09-08-cq-compat-union-compound-bug.md and
 * docs/plans/2026-09-08-cq-compat-cadquery-parity.md §2.3).
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

describe('cq-compat parity fixes', () => {
  it('indexed face selector: >Z lists faces ASCENDING ([0] lowest, [-1] highest) — verified vs cadquery 2.8.0', async () => {
    // Stepped plate: 100×40×10 with a 12×12×3 slot cut from the top face.
    // faces('>Z') lists Z-normal faces ASCENDING by z: bottom(0), slot
    // floor(7), top annulus(10). Verified against the installed cadquery 2.8.0:
    // '>Z[0]' picks the LOWEST face, '>Z[-1]' the HIGHEST.
    const full = 100 * 40 * 10 - 12 * 12 * 3 // 39568
    // '>Z[-1]' → top annulus; the 2mm hole falls inside the slot cavity → removes 0.
    const topProbe = await runShape([
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 100, 40, 10)',
      "let wp2 = cq.faces(wp1, '>Z')",
      'let wp3 = cq.workplane(wp2)',
      'let wp4 = cq.rect(wp3, 12, 12)',
      'let wp5 = cq.cutBlind(wp4, -3)',
      "let wp6 = cq.faces(wp5, '>Z[-1]')",
      'let wp7 = cq.workplane(wp6)',
      'let wp8 = cq.hole(wp7, 6, 2)',
      'let wp_out = wp8',
    ])
    expect(solidCount(topProbe)).toBe(1)
    expect(volume(topProbe)).toBeCloseTo(full, 0)
    // '>Z[0]' → bottom face; the hole cuts INTO the material (CadQuery hole()
    // always cuts opposite the workplane normal), removing π·3²·2.
    const bottomProbe = await runShape([
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 100, 40, 10)',
      "let wp2 = cq.faces(wp1, '>Z')",
      'let wp3 = cq.workplane(wp2)',
      'let wp4 = cq.rect(wp3, 12, 12)',
      'let wp5 = cq.cutBlind(wp4, -3)',
      "let wp6 = cq.faces(wp5, '>Z[0]')",
      'let wp7 = cq.workplane(wp6)',
      'let wp8 = cq.hole(wp7, 6, 2)',
      'let wp_out = wp8',
    ])
    expect(solidCount(bottomProbe)).toBe(1)
    expect(volume(bottomProbe)).toBeCloseTo(full - Math.PI * 9 * 2, 0)
  }, 60000)

  it('cutBlind repeats the profile at every pushPoints location', async () => {
    // Two 10x10 slots, depth 3, in a 60x40x8 plate.
    const shape = await runShape([
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 60, 40, 8)',
      "let wp2 = cq.faces(wp1, '>Z')",
      'let wp3 = cq.workplane(wp2)',
      'let wp4 = cq.pushPoints(wp3, [[-15, 0], [15, 0]])',
      'let wp5 = cq.rect(wp4, 10, 10)',
      'let wp6 = cq.cutBlind(wp5, -3)',
      'let wp_out = wp6',
    ])
    expect(solidCount(shape)).toBe(1)
    const expected = 60 * 40 * 8 - 2 * (10 * 10 * 3)
    expect(volume(shape)).toBeCloseTo(expected, 0)
  }, 60000)

  it('union of overlapping solids yields ONE solid (not a compound)', async () => {
    // Boss extrude on an existing shape: box + raised pad.
    const shape = await runShape([
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 110, 120, 8)',
      "let wp2 = cq.faces(wp1, '>Z')",
      'let wp3 = cq.workplane(wp2)',
      'let wp4 = cq.rect(wp3, 20, 10)',
      'let wp5 = cq.extrude(wp4, 5)',
      'let wp_out = wp5',
    ])
    expect(solidCount(shape)).toBe(1)
    expect(volume(shape)).toBeCloseTo(110 * 120 * 8 + 20 * 10 * 5, 0)
  }, 60000)

  it('disjoint-then-touching union stays one solid and keeps exact volume', async () => {
    const shape = await runShape([
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 30, 30, 10)',
      'let wp2 = cq.box(wp, 15, 15, 10)',
      'let wp3 = cq.translate(wp2, [20, 0, 0])',
      'let wp4 = cq.union(wp1, wp3)',
      'let wp_out = wp4',
    ])
    expect(solidCount(shape)).toBe(1)
    // box1 x -15..15; box2 (15 wide, centered) translated +20 → x 12.5..27.5.
    // Overlap = 2.5 × 15 × 10 = 375.
    const expected = 30 * 30 * 10 + 15 * 15 * 10 - 2.5 * 15 * 10
    expect(volume(shape)).toBeCloseTo(expected, 0)
  }, 60000)

  it('|Z edge selector fillets exactly the vertical edges', async () => {
    // 4 vertical edges of a 30x30x8 plate, r=2:
    // removed volume = 4 · (r² − πr²/4) · h = 4·(4−π)·8 ≈ 27.47
    const shape = await runShape([
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 30, 30, 8)',
      'let wp2 = cq.edges(wp1, "|Z")',
      'let wp3 = cq.fillet(wp2, 2)',
      'let wp_out = wp3',
    ])
    expect(solidCount(shape)).toBe(1)
    const removed = 30 * 30 * 8 - volume(shape)
    expect(removed).toBeGreaterThan(26)
    expect(removed).toBeLessThan(29)
  }, 60000)

  it('polygon cutBlind cuts a real hexagonal prism (not a cylinder)', async () => {
    // Hexagon inscribed in d=9.24 circle: area = (3√3/2)·R², R=4.62 → 55.44 mm².
    const shape = await runShape([
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 40, 20, 12)',
      "let wp2 = cq.faces(wp1, '>Z')",
      'let wp3 = cq.workplane(wp2)',
      'let wp4 = cq.polygon(wp3, 6, 9.24)',
      'let wp5 = cq.cutBlind(wp4, -4)',
      'let wp_out = wp5',
    ])
    expect(solidCount(shape)).toBe(1)
    const hexArea = (3 * Math.sqrt(3)) / 2 * 4.62 * 4.62
    const expected = 40 * 20 * 12 - hexArea * 4
    // A cylinder approximation would remove π·4.62²·4 ≈ 268 (vs hex 221.8) —
    // tolerance 2 excludes that failure mode.
    expect(volume(shape)).toBeCloseTo(expected, 1)
  }, 60000)

  it('cskHole cuts a conical countersink', async () => {
    // Through hole φ4 + 90° countersink to φ8: cone depth = 4/tan(45°) = 4.
    const shape = await runShape([
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 60, 40, 8)',
      "let wp2 = cq.faces(wp1, '>Z')",
      'let wp3 = cq.workplane(wp2)',
      'let wp4 = cq.cskHole(wp3, 4, 8, 90)',
      'let wp_out = wp4',
    ])
    expect(solidCount(shape)).toBe(1)
    const through = Math.PI * 2 * 2 * 8
    // Net cone removal beyond the through hole (cone radius ≥ hole radius for
    // z ∈ [0,2], where r_cone(z) = 4(1−z/4)):
    // ∫₀² π(r_cone² − r_hole²) dz = π(12z − 4z² + z³/3)|₀² = π·32/3
    const coneNet = (Math.PI * 32) / 3
    const expected = 60 * 40 * 8 - through - coneNet
    expect(volume(shape)).toBeCloseTo(expected, 0)
  }, 60000)

  it('cboreHole lands the counterbore on every pushed point', async () => {
    const shape = await runShape([
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 60, 40, 8)',
      "let wp2 = cq.faces(wp1, '>Z')",
      'let wp3 = cq.workplane(wp2)',
      'let wp4 = cq.pushPoints(wp3, [[-15, 0], [15, 0]])',
      'let wp5 = cq.cboreHole(wp4, 4, 7, 2)',
      'let wp_out = wp5',
    ])
    expect(solidCount(shape)).toBe(1)
    // Per point: through-hole π·2²·8 (cyl spans z -4..8, 8 inside the plate)
    // + cbore π·3.5²·3 (spans z 5..8) − π·2²·3 already removed by the hole.
    const perPoint = Math.PI * 4 * 8 + Math.PI * 12.25 * 3 - Math.PI * 4 * 3
    const expected = 60 * 40 * 8 - 2 * perPoint
    expect(volume(shape)).toBeCloseTo(expected, -1)
  }, 60000)
})
