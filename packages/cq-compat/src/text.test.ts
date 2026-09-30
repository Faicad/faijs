/**
 * text — cq-compat's self-contained CadQuery `Workplane.text`.
 *
 * Verifies the native text builder (no `@faicad/faijs-extra` dependency):
 * CadQuery alignment semantics (`halign`/`valign`), `distance` (a positive
 * extrude, and `0` ⇒ flat faces, as `testTextAlignment` uses), and the three
 * `combine` modes ("cut" default / `true` fuse / `false` separate) against a
 * context solid. Mirrors upstream `tests/test_cadquery.py::testText` /
 * `testTextAlignment` (cadquery 2.8.0).
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { hasBrep, brepOf } from '@faicad/faijs/shape'
import { getBrepApi } from '@faicad/faijs/brep/handle-bridge'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'
import type { BrepHandle } from '@faicad/faijs/brep/engine/types'
import { asPartName } from '@faicad/faijs/identity'
import type { Shape } from '@faicad/faijs/mesh/types'
import * as cq from './index'

let runtime: ReturnType<typeof createRuntime>

beforeAll(async () => {
  await registerOcctBrepEngine()
  // createNodePorts() installs the fs FontLoader (node-host) that text needs.
  runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/cq-compat' } as never)
}, 120000)

function bboxOf(wp: cq.WorkplaneType) {
  const kernel = getBrepApi() as unknown as BrepEngineApi
  return kernel.getBoundingBox(brepOf(wp.shape!) as BrepHandle)
}
function volumeOf(wp: cq.WorkplaneType): number {
  const kernel = getBrepApi() as unknown as BrepEngineApi
  return kernel.getVolume(brepOf(wp.shape!) as BrepHandle)
}

describe('cq-compat Workplane.text (self-contained)', () => {
  it('renders a brep text solid via the cq namespace', async () => {
    const code = [
      "import * as cq from '@faicad/cq-compat'",
      "let wp = cq.Workplane('XY')",
      "let t = cq.text(wp, 'A', 10, 3)",
      'let result = cq.val(t)',
    ].join('\n')
    const res = await runtime.execute(code)
    expect(res.failedAt).toBeUndefined()
    const shape = res.outputs.get(asPartName('result')) as Shape | undefined
    expect(shape).toBeDefined()
    expect(hasBrep(shape!)).toBe(true)
    expect(brepOf(shape!)).toBeDefined()
  }, 60000)

  it('extrudes by `distance` along the workplane normal (distance > 0)', async () => {
    const wp = await cq.text(cq.Workplane('XY'), 'ABC', 12, 4)
    const b = bboxOf(wp)
    expect(b.xmax - b.xmin).toBeGreaterThan(0)
    expect(b.ymax - b.ymin).toBeGreaterThan(0)
    // XY plane: extrude axis is +Z, so the Z extent equals `distance`.
    expect(b.zmax - b.zmin).toBeGreaterThan(3.5)
    expect(b.zmax - b.zmin).toBeLessThan(4.5)
  }, 60000)

  it('distance = 0 keeps flat faces (no extrusion)', async () => {
    const wp = await cq.text(cq.Workplane('XY'), 'I', 10, 0)
    const b = bboxOf(wp)
    expect(b.xmax - b.xmin).toBeGreaterThan(0)
    expect(b.ymax - b.ymin).toBeGreaterThan(0)
    expect(Math.abs(b.zmax - b.zmin)).toBeLessThan(1e-6)
  }, 60000)

  it('halign/valign align the glyph box (CadQuery testTextAlignment)', async () => {
    const lb = bboxOf(
      await cq.text(cq.Workplane('XY'), 'I', 10, 0, 'cut', { halign: 'left', valign: 'bottom' }),
    )
    expect(lb.xmin).toBeGreaterThanOrEqual(-1e-3)
    expect(lb.ymin).toBeGreaterThanOrEqual(-1e-3)

    const c = bboxOf(
      await cq.text(cq.Workplane('XY'), 'I', 10, 0, 'cut', { halign: 'center', valign: 'center' }),
    )
    expect(Math.abs((c.xmin + c.xmax) / 2)).toBeLessThan(0.5)
    expect(Math.abs((c.ymin + c.ymax) / 2)).toBeLessThan(0.5)

    const rt = bboxOf(
      await cq.text(cq.Workplane('XY'), 'I', 10, 0, 'cut', { halign: 'right', valign: 'top' }),
    )
    expect(rt.xmax).toBeLessThanOrEqual(1e-3)
    expect(rt.ymax).toBeLessThanOrEqual(1e-3)
  }, 120000)

  it('combine "cut" (default) removes text from the context solid', async () => {
    const base = await cq.box(cq.Workplane('XY'), 4, 4, 0.5)
    const boxVol = volumeOf(base)
    const top = await cq.workplane(cq.faces(base, '>Z'))
    const res = await cq.text(top, 'CQ', 0.5, -0.05)
    expect(volumeOf(res)).toBeLessThan(boxVol)
  }, 120000)

  it('combine true fuses text with the context solid', async () => {
    const base = await cq.box(cq.Workplane('XY'), 4, 4, 0.5)
    const boxVol = volumeOf(base)
    const top = await cq.workplane(cq.faces(base, '>Z'))
    const res = await cq.text(top, 'CQ', 0.5, 0.05, true)
    expect(volumeOf(res)).toBeGreaterThan(boxVol)
  }, 120000)

  it('combine false keeps the text as a separate body', async () => {
    const base = await cq.box(cq.Workplane('XY'), 4, 4, 0.5)
    const boxVol = volumeOf(base)
    const top = await cq.workplane(cq.faces(base, '>Z'))
    const res = await cq.text(top, 'CQ', 0.5, 0.05, false)
    // The context box is NOT part of the result — only the (tiny) text remains.
    expect(volumeOf(res)).toBeLessThan(boxVol * 0.1)
  }, 120000)
})
