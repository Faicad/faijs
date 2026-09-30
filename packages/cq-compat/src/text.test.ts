/**
 * text — cq-compat wiring of faijs-extra's BREP text op.
 *
 * Verifies that `cad.text` (the editor-owned, three-free brep path) is reachable
 * from cq-compat's `cad` singleton and that `Workplane.text` produces a valid
 * extruded text solid placed on the workplane.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { hasBrep, brepOf } from '@faicad/faijs/shape'
import { asPartName } from '@faicad/faijs/identity'
import type { Shape } from '@faicad/faijs/mesh/types'
import * as cq from './index'
import { setupCqFont } from './font-loader'

let runtime: ReturnType<typeof createRuntime>

beforeAll(async () => {
  await registerOcctBrepEngine()
  // faijs-extra's textBrep needs a font loader injected (node side).
  await setupCqFont()
  runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/cq-compat' } as never)
}, 120000)

describe('cq-compat Workplane.text (faijs-extra wiring)', () => {
  it('produces a valid brep text solid via the cq namespace', async () => {
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

  it('extrudes along the workplane normal with depth ≈ requested', async () => {
    const wp = await cq.text(cq.Workplane('XY'), 'ABC', 12, 4)
    // size() → [dx, dy, dz]; for the XY plane the extrude axis is +Z (dz).
    const [dx, dy, dz] = cq.size(wp)
    expect(dx).toBeGreaterThan(0)
    expect(dy).toBeGreaterThan(0)
    // depth is the Z extent of the extruded text.
    expect(dz).toBeGreaterThan(3.5)
    expect(dz).toBeLessThan(4.5)
  }, 60000)

  it('places text along the workplane normal (top, normal +Y)', async () => {
    const wp = await cq.text(cq.Workplane('top'), 'X', 8, 2)
    const [dx, dy, dz] = cq.size(wp)
    expect(dx).toBeGreaterThan(0)
    expect(dy).toBeGreaterThan(0)
    expect(dz).toBeGreaterThan(0)
    // Extent of the solid along the workplane normal must equal the depth.
    const n = wp.normal
    const along = Math.abs(dx * n[0]) + Math.abs(dy * n[1]) + Math.abs(dz * n[2])
    expect(along).toBeGreaterThan(1.5)
    expect(along).toBeLessThan(2.5)
  }, 60000)
})
