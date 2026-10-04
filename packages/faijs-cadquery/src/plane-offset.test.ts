/**
 * plane / offset — B2-5 (G-C12 + G-C6).
 *
 * Free functions added 2026-10-04:
 *   plane(w, l)                 -> a finite XY Face centred on the origin
 *                                  (upstream `shapes.py:6381`)
 *   offset(s, t, {cap, both})   -> thicken a Face/Shell into a solid
 *                                  (upstream `shapes.py:6969`)
 *
 * Every expected number below is the CadQuery 2.8.0 ground truth captured with
 * the OCP interpreter (`test_free_functions.py::test_offset`), NOT derived from
 * faijs — so these assertions freeze the upstream semantics, not our own output.
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

describe('plane(w, l) — free-function planar face', () => {
  it('builds a w x l face centred on the XY origin', async () => {
    const { shape, failedAt } = await run(
      [SRC, 'let f = await cq.plane(2, 3)', 'let result = cq.val(f)'].join('\n'),
    )
    expect(failedAt?.message).toBeUndefined()
    const m = metricsOf(shape!)
    expect(m.vol).toBe(0)
    expect(m.faces).toBe(1)
    expect(m.edges).toBe(4)
    expect(m.vertices).toBe(4)
    expect(m.bb.map(round)).toEqual([-1, 1, -1.5, 1.5, 0, 0])
  })

  it('plane() with no size fails loudly (upstream ±1e60 overload unsupported)', async () => {
    const { failedAt } = await run([SRC, 'let f = await cq.plane()', 'let result = cq.val(f)'].join('\n'))
    expect(failedAt?.message).toMatch(/plane\(\) with no size/)
  })
})

describe('offset — thicken a face/shell (upstream test_offset ground truth)', () => {
  it('offset(plane(1,1), 1) -> 1x1x1 solid, bb z[0,1] (ref vol 1)', async () => {
    const { shape, failedAt } = await run(
      [
        SRC,
        'let f = await cq.plane(1, 1)',
        'let r = await cq.offset(f, 1)',
        'let result = cq.val(r)',
      ].join('\n'),
    )
    expect(failedAt?.message).toBeUndefined()
    const m = metricsOf(shape!)
    expect(m.vol).toBeCloseTo(1, 9)
    expect(m.faces).toBe(6)
    expect(m.edges).toBe(12)
    expect(m.vertices).toBe(8)
    expect(m.bb.map(round)).toEqual([-0.5, 0.5, -0.5, 0.5, 0, 1])
  })

  it('offset(shell, -0.25) -> hollow box, bb z[0,1] (ref vol 0.875, 12 faces)', async () => {
    const { shape, failedAt } = await run(
      [
        SRC,
        "let b = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })",
        'let s = cq.shells(b)',
        'let r = await cq.offset(s, -0.25)',
        'let result = cq.val(r)',
      ].join('\n'),
    )
    expect(failedAt?.message).toBeUndefined()
    const m = metricsOf(shape!)
    expect(m.vol).toBeCloseTo(0.875, 9)
    expect(m.faces).toBe(12)
    expect(m.edges).toBe(24)
    expect(m.vertices).toBe(16)
    expect(m.bb.map(round)).toEqual([-0.5, 0.5, -0.5, 0.5, 0, 1])
  })

  it('offset(face, 1, both=True) -> fuse of +t/-t, bb z[-1,1] (ref vol 2, 10 faces)', async () => {
    const { shape, failedAt } = await run(
      [
        SRC,
        'let f = await cq.plane(1, 1)',
        'let r = await cq.offset(f, 1, { both: true })',
        'let result = cq.val(r)',
      ].join('\n'),
    )
    expect(failedAt?.message).toBeUndefined()
    const m = metricsOf(shape!)
    expect(m.vol).toBeCloseTo(2, 9)
    // GOTCHA: both=True is NOT "thicken by 2*t" — it fuses two separate offsets,
    // so the seam ring survives as 4 extra faces (10, not 6).
    expect(m.faces).toBe(10)
    expect(m.bb.map(round)).toEqual([-0.5, 0.5, -0.5, 0.5, -1, 1])
  })
})

describe('offset — input contract mirrors upstream _get(s, ("Face","Shell"))', () => {
  it('rejects a Solid (upstream raises too: "Solid" is not in the requested tuple)', async () => {
    const { failedAt } = await run(
      [
        SRC,
        "let b = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })",
        'let r = await cq.offset(b, 1)',
        'let result = cq.val(r)',
      ].join('\n'),
    )
    expect(failedAt?.message).toMatch(/required Face\/Shell, encountered solid/)
  })

  it('rejects cap=False (the kernel thicken has no cap flag)', async () => {
    const { failedAt } = await run(
      [
        SRC,
        'let f = await cq.plane(1, 1)',
        'let r = await cq.offset(f, 1, { cap: false })',
        'let result = cq.val(r)',
      ].join('\n'),
    )
    expect(failedAt?.message).toMatch(/cap=False is not supported/)
  })
})
