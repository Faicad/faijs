/**
 * cq-compat smoke tests — Workplane carrier + basic ops through runtime.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs-core/node'
import { hasBrep, brepOf } from '@faicad/faijs-core/shape'
import { getKernel } from '@faicad/faijs-core/occt-kernel/occtKernel'
import { asPartName } from '@faicad/faijs-core/identity'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import * as cq from './index'

let runtime: ReturnType<typeof createRuntime>

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/cq-compat' } as never)
  // warm up
  const warm = await runtime.execute('let a = cad.box(1, 1, 1, { centered: true })')
  expect(warm.failedAt).toBeUndefined()
}, 120000)

describe('cq-compat Workplane basic ops', () => {
  it('box + faces + workplane + hole produces a brep shape', async () => {
    const code = [
      "import * as cq from '@faicad/cq-compat'",
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 100, 80, 10)',
      "let wp2 = cq.faces(wp1, '>Z')",
      'let wp3 = cq.workplane(wp2)',
      'let wp4 = cq.hole(wp3, 10)',
      'let result = cq.val(wp4)',
    ].join('\n')
    const res = await runtime.execute(code)
    expect(res.failedAt).toBeUndefined()
    const shape = res.outputs.get(asPartName('result')) as Shape | undefined
    expect(shape).toBeDefined()
    expect(hasBrep(shape!)).toBe(true)
  }, 60000)

  it('rect+extrude pattern via box + cutBlind', async () => {
    const code = [
      "import * as cq from '@faicad/cq-compat'",
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 60, 40, 8)',
      "let wp2 = cq.faces(wp1, '>Z')",
      'let wp3 = cq.workplane(wp2)',
      'let wp4 = cq.cutBlind(wp3, -3, { w: 20, d: 20 })',
      'let result = cq.val(wp4)',
    ].join('\n')
    const res = await runtime.execute(code)
    expect(res.failedAt).toBeUndefined()
    const shape = res.outputs.get(asPartName('result')) as Shape | undefined
    expect(shape).toBeDefined()
    expect(hasBrep(shape!)).toBe(true)
  }, 60000)

  it('pushPoints + hole (multiple holes)', async () => {
    const code = [
      "import * as cq from '@faicad/cq-compat'",
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 60, 40, 8)',
      "let wp2 = cq.faces(wp1, '>Z')",
      'let wp3 = cq.workplane(wp2)',
      'let wp4 = cq.pushPoints(wp3, [[-15, 0], [15, 0]])',
      'let wp5 = cq.hole(wp4, 5)',
      'let result = cq.val(wp5)',
    ].join('\n')
    const res = await runtime.execute(code)
    expect(res.failedAt).toBeUndefined()
    const shape = res.outputs.get(asPartName('result')) as Shape | undefined
    expect(shape).toBeDefined()
    expect(hasBrep(shape!)).toBe(true)
  }, 60000)

  it('translate + union', async () => {
    const code = [
      "import * as cq from '@faicad/cq-compat'",
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 30, 30, 10)',
      'let wp2 = cq.box(wp, 15, 15, 10)',
      'let wp3 = cq.translate(wp2, [20, 0, 0])',
      'let wp4 = cq.union(wp1, wp3)',
      'let result = cq.val(wp4)',
    ].join('\n')
    const res = await runtime.execute(code)
    expect(res.failedAt).toBeUndefined()
    const shape = res.outputs.get(asPartName('result')) as Shape | undefined
    expect(shape).toBeDefined()
    expect(hasBrep(shape!)).toBe(true)
  }, 60000)
})

/** Read volume / solid count of a runtime output shape via the OCCT kernel. */
function shapeMetrics(shape: Shape): { volume: number; solidCount: number } {
  const kernel = getKernel()
  const handle = brepOf(shape) as never
  return {
    volume: kernel.getVolume(handle),
    solidCount: kernel.getSubShapes(handle, 'solid').length,
  }
}

describe('cq-compat workplane stack (pushPoints) semantics — regression 2026-09-08', () => {
  it('cutBlind cuts at EVERY pushPoints point (2 side slots, not 1 center slot)', async () => {
    const code = [
      "import * as cq from '@faicad/cq-compat'",
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 60, 40, 8)',
      "let wp2 = cq.faces(wp1, '>Z')",
      'let wp3 = cq.workplane(wp2)',
      "let wp4 = cq.pushPoints(wp3, [[-15, 0], [15, 0]])",
      'let wp5 = cq.cutBlind(wp4, -2, { w: 20, d: 10 })',
      'let result = cq.val(wp5)',
    ].join('\n')
    const res = await runtime.execute(code)
    expect(res.failedAt).toBeUndefined()
    const shape = res.outputs.get(asPartName('result')) as Shape | undefined
    expect(shape).toBeDefined()
    const m = shapeMetrics(shape!)
    // 60*40*8 = 19200 − 2×(20×10×2) = 18400 (buggy: only 1 slot → 18800)
    expect(Math.abs(m.volume - 18400)).toBeLessThan(1)
    expect(m.solidCount).toBe(1)
  }, 60000)

  it('cboreHole drills the counterbore at EVERY pushPoints point (not only center)', async () => {
    const code = [
      "import * as cq from '@faicad/cq-compat'",
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 60, 40, 8)',
      "let wp2 = cq.faces(wp1, '>Z')",
      'let wp3 = cq.workplane(wp2)',
      "let wp4 = cq.pushPoints(wp3, [[-15, 0], [15, 0]])",
      'let wp5 = cq.cboreHole(wp4, 5, 10, 2)',
      'let result = cq.val(wp5)',
    ].join('\n')
    const res = await runtime.execute(code)
    expect(res.failedAt).toBeUndefined()
    const shape = res.outputs.get(asPartName('result')) as Shape | undefined
    expect(shape).toBeDefined()
    const m = shapeMetrics(shape!)
    // 19200 − 2×(π·2.5²·8) [through holes] − 2×(π·(5²−2.5²)·3) [counterbore annuli,
    // center already removed by the through hole] = 19200 − 667.59 = 18532.41
    // (buggy: counterbore only at center → 18885.84)
    expect(Math.abs(m.volume - 18532.41)).toBeLessThan(1)
    expect(m.solidCount).toBe(1)
  }, 60000)

  it('boss extrude unions a boss at EVERY pushPoints point (1 fused solid)', async () => {
    const code = [
      "import * as cq from '@faicad/cq-compat'",
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 60, 40, 8)',
      "let wp2 = cq.faces(wp1, '>Z')",
      'let wp3 = cq.workplane(wp2)',
      "let wp4 = cq.pushPoints(wp3, [[-15, 0], [15, 0]])",
      'let wp5 = cq.rect(wp4, 10, 10)',
      'let wp6 = cq.extrude(wp5, 10)',
      'let result = cq.val(wp6)',
    ].join('\n')
    const res = await runtime.execute(code)
    expect(res.failedAt).toBeUndefined()
    const shape = res.outputs.get(asPartName('result')) as Shape | undefined
    expect(shape).toBeDefined()
    const m = shapeMetrics(shape!)
    // 19200 + 2×(10×10×10) = 21200, fused into 1 solid
    // (buggy: only 1 boss → 20200, or floating boss → 2 solids)
    expect(Math.abs(m.volume - 21200)).toBeLessThan(1)
    expect(m.solidCount).toBe(1)
  }, 60000)

  it('workplane face-based center (CenterOfMass default) on an asymmetric shape', async () => {
    // base 60×40×8 + inner boss 20×20×10 (x∈[−10,10], y∈[−10,10], z∈[8,18]).
    // The "+Y" face is the plain plate face (y=20, z∈[0,8]); its CenterOfMass is
    // (0,20,4). A blind slot cut from it removes 10×19×8 = 1520 mm³.
    // (Buggy whole-shape-bbox center was (0,20,9): removes 570+450 = 1020 → 22180)
    const code = [
      "import * as cq from '@faicad/cq-compat'",
      "let wp = cq.Workplane('XY')",
      'let base = cq.box(wp, 60, 40, 8)',
      "let bwp = cq.workplane(cq.faces(base, '>Z'))",
      'let boss = cq.extrude(cq.rect(cq.center(bwp, 0, 0), 20, 20), 10)',
      'let joined = cq.union(base, boss)',
      "let side = cq.workplane(cq.faces(joined, '+Y'))",
      'let part = cq.cutBlind(cq.rect(cq.center(side, 0, 0), 10, 30), -8)',
      'let result = cq.val(part)',
    ].join('\n')
    const res = await runtime.execute(code)
    expect(res.failedAt).toBeUndefined()
    const shape = res.outputs.get(asPartName('result')) as Shape | undefined
    expect(shape).toBeDefined()
    const m = shapeMetrics(shape!)
    // 19200 + 4000 − 1520 = 21680
    expect(Math.abs(m.volume - 21680)).toBeLessThan(1)
    expect(m.solidCount).toBe(1)
  }, 60000)
})
