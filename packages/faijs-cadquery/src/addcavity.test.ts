/**
 * addCavity — G-C8 (roadmap B2-7 收官).
 *
 * Free function added 2026-10-04:
 *   addCavity(s, ...cavities) -> solid with internal voids
 *     (upstream `Solid.addCavity`, `occ_impl/shapes.py:4740`)
 *
 * The kernel exposes no multi-shell `MakeSolid.Add` / `ShapeFix_Solid`, so the
 * faijs implementation uses the equivalent boolean cut (outer − cavity₁ − …).
 * Every expected number below is the CadQuery 2.8.0 ground truth captured with
 * the OCP interpreter (`test_shapes.py::test_addCavity` + ref STEP metrics),
 * NOT derived from faijs — so these assertions freeze the upstream semantics.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { getBrepApi } from '@faicad/faijs/brep/handle-bridge'
import { asPartName } from '@faicad/faijs/identity'
import { brepOf } from '@faicad/faijs/shape'
import type { BrepHandle } from '@faicad/faijs/brep/engine/types'
import type { Shape } from '@faicad/faijs/mesh/types'
import * as cq from './index'

interface Metrics {
  vol: number
  faces: number
  edges: number
  vertices: number
  shells: number
  bb: [number, number, number, number, number, number]
}

function metricsOf(shape: Shape): Metrics {
  const h = brepOf(shape) as BrepHandle
  const api = getBrepApi()
  const n = (k: string) => (api.getSubShapes(h, k as never) as unknown[]).length
  const b = api.getBoundingBox(h, false) as unknown as Record<string, number>
  return {
    vol: api.getVolume(h),
    faces: n('face'),
    edges: n('edge'),
    vertices: n('vertex'),
    shells: n('shell'),
    bb: [b.xmin, b.xmax, b.ymin, b.ymax, b.zmin, b.zmax],
  }
}

const round = (v: number) => Number(v.toFixed(6))

async function run(
  code: string,
): Promise<{ shape?: Shape; failedAt?: { message: string } }> {
  const cliRuntime = createRuntime(createNodePorts(), 'brep')
  cliRuntime.registerLib('cq', cq as never, {
    packageName: '@faicad/faijs-cadquery',
    autoLift: false,
  } as never)
  const res = await cliRuntime.execute(code)
  return {
    shape: res.outputs.get(asPartName('result')) as Shape | undefined,
    failedAt: res.failedAt as { message: string } | undefined,
  }
}

beforeAll(async () => {
  await registerOcctBrepEngine()
})

const SRC = "import * as cq from '@faicad/faijs-cadquery'"

describe('addCavity — solid with an internal void (upstream test_addCavity ground truth)', () => {
  it('outer box(2,2,2): vol 8, f6/e12/v8, bb z[0,2] (ref b1)', async () => {
    const { shape, failedAt } = await run(
      [
        SRC,
        "let b1 = await cq.box(cq.Workplane(), 2, 2, 2, { centered: [true, true, false] })",
        'let result = cq.val(b1)',
      ].join('\n'),
    )
    expect(failedAt?.message).toBeUndefined()
    const m = metricsOf(shape!)
    expect(m.vol).toBeCloseTo(8, 9)
    expect(m.faces).toBe(6)
    expect(m.edges).toBe(12)
    expect(m.vertices).toBe(8)
    expect(m.bb.map(round)).toEqual([-1, 1, -1, 1, 0, 2])
  })

  it('cavity box(1,1,1) moved z+0.5: vol 1, bb z[0.5,1.5] (ref b2)', async () => {
    const { shape, failedAt } = await run(
      [
        SRC,
        "let b = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })",
        'let b2 = await cq.translate(b, [0, 0, 0.5])',
        'let result = cq.val(b2)',
      ].join('\n'),
    )
    expect(failedAt?.message).toBeUndefined()
    const m = metricsOf(shape!)
    expect(m.vol).toBeCloseTo(1, 9)
    expect(m.bb.map(round)).toEqual([-0.5, 0.5, -0.5, 0.5, 0.5, 1.5])
  })

  it('addCavity -> vol 7, f12/e24/v16, 2 shells (ref br — upstream asserts 12 faces / 2 shells / isValid)', async () => {
    const { shape, failedAt } = await run(
      [
        SRC,
        "let b1 = await cq.box(cq.Workplane(), 2, 2, 2, { centered: [true, true, false] })",
        "let cav0 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })",
        'let cav = await cq.translate(cav0, [0, 0, 0.5])',
        'let br = await cq.addCavity(b1, cav)',
        'let result = cq.val(br)',
      ].join('\n'),
    )
    expect(failedAt?.message).toBeUndefined()
    const m = metricsOf(shape!)
    expect(m.vol).toBeCloseTo(7, 9)
    expect(m.faces).toBe(12)
    expect(m.edges).toBe(24)
    expect(m.vertices).toBe(16)
    expect(m.shells).toBe(2)
    expect(m.bb.map(round)).toEqual([-1, 1, -1, 1, 0, 2])
  })

  it('cavity protruding out of the outer solid fails loudly', async () => {
    const { failedAt } = await run(
      [
        SRC,
        "let b1 = await cq.box(cq.Workplane(), 2, 2, 2, { centered: [true, true, false] })",
        "let cav0 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })",
        'let cav = await cq.translate(cav0, [0, 0, 1.7])',
        'let br = await cq.addCavity(b1, cav)',
        'let result = cq.val(br)',
      ].join('\n'),
    )
    expect(failedAt?.message).toMatch(/not enclosed/)
  })
})
