/**
 * Solid.makeCone + CQ (roadmap B1-3, G-C20 "零散 free" 第一批).
 *
 * Truth is measured, not derived from the upstream source text:
 *
 *   Solid.makeCone(0, 1.0, 2.0)   (cadquery 2.8.0, test_cadquery.py::testCone)
 *       ref out/ref/tests.test_cadquery__TestCadQuery__testCone__s.step:
 *       vol 2.09439510239  com z 1.50000000000
 *       bbox x[-1,1] y[-1,1] z[0,2]  topo f2/e3/v2/s1
 *
 * The centroid is the decisive number: an apex-DOWN cone has its centroid at
 * 3h/4 = 1.5, an apex-UP cone at h/4 = 0.5. It is what pins `radius1` to the
 * BASE plane (OCCT `BRepPrimAPI_MakeCone(r1, r2, h)` semantics) — the mirror
 * would silently build a mirrored cone if that order were flipped, and volume
 * alone could not tell the difference.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { getBrepApi } from '@faicad/faijs/brep/handle-bridge'
import { brepOf } from '@faicad/faijs/shape'
import type { BrepHandle } from '@faicad/faijs/brep/engine/types'
import { asPartName } from '@faicad/faijs/identity'
import type { Shape } from '@faicad/faijs/mesh/types'
import * as cq from './index'

let runtime: ReturnType<typeof createRuntime>

/** Run a `.fai.js` snippet whose last line binds `result`; measure the result. */
async function runMeasured(lines: string[]): Promise<{
  vol: number
  comZ: number
  faces: number
  vertices: number
}> {
  const code = ["import * as cq from '@faicad/faijs-cadquery'", ...lines].join('\n')
  const res = await runtime.execute(code)
  expect(res.failedAt).toBeUndefined()
  const shape = res.outputs.get(asPartName('result')) as Shape | undefined
  expect(shape).toBeDefined()
  const h = brepOf(shape!) as BrepHandle
  const api = getBrepApi()
  return {
    vol: api.getVolume(h),
    comZ: api.getCenterOfMass(h).z,
    faces: (api.getSubShapes(h, 'face') as unknown[]).length,
    vertices: (api.getSubShapes(h, 'vertex') as unknown[]).length,
  }
}

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/faijs-cadquery' } as never)
  const warm = await runtime.execute('let a = cad.box(1, 1, 1, { centered: true })')
  if (warm.failedAt) throw new Error(`runtime warmup failed: ${JSON.stringify(warm.failedAt)}`)
})

describe('solidMakeCone (Solid.makeCone)', () => {
  it('makeCone(0, 1, 2) is an apex-DOWN cone — ref vol 2.0943951, comZ 1.5', async () => {
    const { vol, comZ, faces, vertices } = await runMeasured([
      'let result = await cq.solidMakeCone(0, 1.0, 2.0)',
    ])
    expect(vol).toBeCloseTo(2.09439510239, 6)
    // GOTCHA: comZ 1.5 (not 0.5) — radius1 is the BASE radius, so radius1 = 0
    // puts the apex on z = 0 and the radius-1 circle on z = 2.
    expect(comZ).toBeCloseTo(1.5, 6)
    expect(faces).toBe(2)
    expect(vertices).toBe(2)
  })

  it('makeCone(1, 0, 2) flips the cone — same volume, comZ 0.5', async () => {
    // The mirror image of the case above: identical volume, mirrored centroid.
    // This is the mutation guard for the radius1/radius2 argument order.
    const { vol, comZ } = await runMeasured([
      'let result = await cq.solidMakeCone(1.0, 0, 2.0)',
    ])
    expect(vol).toBeCloseTo(2.09439510239, 6)
    expect(comZ).toBeCloseTo(0.5, 6)
  })

  it('truncated cone (frustum) volume matches the analytic value', async () => {
    // V = π/3·h·(R² + R·r + r²) = π/3·2·(1 + 0.5 + 0.25) = 3.6651914291880923
    const { vol } = await runMeasured(['let result = await cq.solidMakeCone(1.0, 0.5, 2.0)'])
    expect(vol).toBeCloseTo(3.6651914291880923, 6)
  })

  it('rejects equal radii exactly like upstream (OCCT Standard_DomainError)', () => {
    // Verified on cadquery 2.8.0: `Solid.makeCone(1.0, 1.0, 2.0)` raises
    // `Standard_DomainError: cone with two identic radii`. A cylinder is NOT a
    // zero-taper cone — build it as a cylinder.
    expect(() => cq.solidMakeCone(1, 1, 2)).toThrow(/identic radii/)
  })

  it('rejects a non-positive height', () => {
    expect(() => cq.solidMakeCone(1, 1, 0)).toThrow(/height must be > 0/)
    expect(() => cq.solidMakeCone(1, 1, -2)).toThrow(/height must be > 0/)
  })
})

describe('CQ (upstream alias of the Workplane constructor)', () => {
  it('seeds an XY workplane with the object on the stack', async () => {
    await registerOcctBrepEngine()
    const cone = cq.solidMakeCone(0, 1, 2)
    const wp = cq.CQ(cone)
    expect(wp.plane).toBe('XY')
    expect(wp.objects.length).toBe(1)
    // Upstream `Workplane.__init__` sets parent = None (cq.py:193): a workplane
    // built from a bare object STARTS a chain, it is not anybody's child.
    expect(wp.parent).toBeUndefined()
    expect(getBrepApi().getVolume(brepOf(wp.shape!) as BrepHandle)).toBeCloseTo(2.09439510239, 6)
  })

  it('CQ() with no argument is a plain empty XY workplane', () => {
    const wp = cq.CQ()
    expect(wp.plane).toBe('XY')
    expect(wp.objects.length).toBe(0)
    expect(wp.shape).toBeNull()
  })

  it('CQ(s) round-trips a shape through the CLI-like host (autoLift:false)', async () => {
    // The CLI loads @faicad/faijs-cadquery with `faijs.autoLift:false`
    // (packages/faijs-cadquery/package.json -> node-host/cli.ts autoLiftFor), so
    // `cq.*` functions are NOT lifted into ops: `CQ` is a plain function call
    // that must not depend on op registration. This is the host the parity run
    // (`tests/run-cand.ts`) uses, so this test pins exactly what the mirrors
    // exercise — it is NOT a borrowed-view test (mutation `asBrepShape` ->
    // identity leaves it green, so no claim is made about that path here).
    const cliRuntime = createRuntime(createNodePorts(), 'brep')
    cliRuntime.registerLib('cq', cq as never, {
      packageName: '@faicad/faijs-cadquery',
      autoLift: false,
    } as never)
    const res = await cliRuntime.execute(
      [
        "import * as cq from '@faicad/faijs-cadquery'",
        'let s = await cq.solidMakeCone(0, 1.0, 2.0)',
        'let t = await cq.CQ(s)',
        'let result = cq.val(t)',
      ].join('\n'),
    )
    expect(res.failedAt).toBeUndefined()
    const shape = res.outputs.get(asPartName('result')) as Shape | undefined
    expect(shape).toBeDefined()
    expect(getBrepApi().getVolume(brepOf(shape!) as BrepHandle)).toBeCloseTo(2.09439510239, 6)
  })
})
