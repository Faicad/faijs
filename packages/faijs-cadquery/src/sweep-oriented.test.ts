/**
 * sweep() orientation modes — `normal` (FixedUp) implemented, `auxSpine` rejected.
 *
 * Truth captured with cadquery 2.8.0 (`C:\Users\ylt\cadquery-env`, one-shot probe):
 *
 *   TestCadQuery.testSweep, the `normal=` branch:
 *     path = Workplane("XZ").spline([(0,0),(0,1),(1,2),(2,4)])
 *     Workplane().circle(0.5).sweep(path, normal=Vector(0,0,1))
 *       -> vol 3.1415917532896636, 3 faces, 3 edges, 2 vertices
 *
 *   test_free_functions.test_sweep_aux:
 *     plane(1,1) swept along a length-1 Z spine with a length-1 aux guide
 *       -> vol 0.9991567936618069, 6 faces (2 PLANE), 12 edges, 8 vertices
 *
 * `auxSpine` is NOT graded here: CadQuery applies the guide with
 * `SetMode(aux, CurvilinearEquivalence=True)` (occ_impl/shapes.py:4587) and the
 * kernel's SweepMode.Auxiliary is not equivalent (TestCadQuery.testSweep's aux
 * case: kernel 17759.16 vs CadQuery 20218.35). It only agrees when the guide's
 * reparametrisation is a no-op, so `sweep(auxSpine=…)` rejects loudly — pinned
 * below. Full evidence: tests/mark-blocked.ts + workplane.ts `sweep`.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { getBrepApi } from '@faicad/faijs/brep/handle-bridge'
import { brepOf } from '@faicad/faijs/shape'
import type { BrepHandle } from '@faicad/faijs/brep/engine/types'
import { asPartName } from '@faicad/faijs/identity'
import type { Shape } from '@faicad/faijs/mesh/types'
import * as cq from './index'

interface Metrics {
  vol: number
  faces: number
  edges: number
  vertices: number
  length: number
}

function metricsOf(shape: Shape): Metrics {
  const h = brepOf(shape) as BrepHandle
  const n = (k: string) => (getBrepApi().getSubShapes(h, k as never) as unknown[]).length
  return {
    vol: getBrepApi().getVolume(h),
    faces: n('face'),
    edges: n('edge'),
    vertices: n('vertex'),
    length: getBrepApi().getLength(h),
  }
}

/** Run mirror-style source under the CLI loader settings (autoLift:false). */
async function run(code: string): Promise<{ shape?: Shape; failedAt?: { message: string } }> {
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

describe('sweep normal= (SweepMode.FixedUp)', () => {
  it('circle r=0.5 along an XZ spline matches the upstream capture', async () => {
    const { shape, failedAt } = await run(
      [
        "import * as cq from '@faicad/faijs-cadquery'",
        "let p = cq.circle(cq.Workplane('XY'), 0.5)",
        'let path = cq.splineWire3D([[0,0,0],[0,0,1],[1,0,2],[2,0,4]])',
        'let r = await cq.sweep(p, path, { normal: [0, 0, 1] })',
        'let result = cq.val(r)',
      ].join('\n'),
    )
    expect(failedAt?.message).toBeUndefined()
    expect(shape).toBeDefined()
    const m = metricsOf(shape!)
    expect(m.vol).toBeCloseTo(3.1415917532896636, 5)
    expect(m.faces).toBe(3)
    expect(m.edges).toBe(3)
    expect(m.vertices).toBe(2)
  })
})

describe('splineWire3D', () => {
  it('builds a bare spline wire (1 edge, unit length for a unit segment)', async () => {
    const { shape, failedAt } = await run(
      [
        "import * as cq from '@faicad/faijs-cadquery'",
        'let w = cq.splineWire3D([[0,0,0],[0,0,1]])',
        'let result = cq.val(w)',
      ].join('\n'),
    )
    expect(failedAt?.message).toBeUndefined()
    const m = metricsOf(shape!)
    expect(m.edges).toBe(1)
    expect(m.vertices).toBe(2)
    expect(m.length).toBeCloseTo(1, 9)
  })
})

describe('sweep auxSpine (kernel gap)', () => {
  it('rejects loudly instead of returning divergent geometry', async () => {
    // The runtime records the failure without writing to stderr; spy anyway to
    // keep the suite's stderr-zero-tolerance guarantee explicit.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { shape, failedAt } = await run(
        [
          "import * as cq from '@faicad/faijs-cadquery'",
          "let p = cq.rect(cq.Workplane('XY'), 1, 1)",
          'let spine = cq.splineWire3D([[0,0,0],[0,0,1]])',
          'let aux = cq.splineWire3D([[1,0,0],[1,0,1]], [[0,1,0],[0,-1,0]])',
          'let r = await cq.sweep(p, spine, { auxSpine: aux })',
          'let result = cq.val(r)',
        ].join('\n'),
      )
      expect(shape).toBeUndefined()
      expect(failedAt?.message).toContain('auxSpine is not supported')
      expect(failedAt?.message).toContain('kernel:sweep-aux-spine-mode')
    } finally {
      warn.mockRestore()
      error.mockRestore()
    }
  })
})
