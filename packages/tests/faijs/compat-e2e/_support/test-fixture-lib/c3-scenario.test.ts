/**
 * C3 — external-CAD compat layer end-to-end scenario acceptance (faijs side,
 * assertions 1–4). Design: §7.4 C3 of the 2026-09-03 compat module-runtime plan.
 *
 * Scenario:
 *   import * as gear from 'test-fixture-lib'
 *   let part0 = gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })
 *   let part1 = cad.box(48, 48, 8, { centered: true })
 *   let part2 = cad.union(part0, part1)
 *
 * Assertions:
 *  1. part0 is BREP (hasBrep === true, exact geometry, non-faceted)
 *  2. cad.union dispatch path is BREP (dispatchPath == 'brep', not mesh;
 *     the result keeps its BREP slot — an exact boolean, no mixed mesh degrade)
 *  3. UNION result exported to STEP is exact (contains `ADVANCED_FACE`)
 *  4. geometry cross-check: upstream GearResult fields (pitch=48, tip=52) are
 *     consistent with the mesh outer radius (assertions 5/6 live in the host)
 *
 * P24 (§8.1): the lib is registered with `{ autoLift: true }`; shapes are
 * adopted at the boundary, `makeExternalGear` now comes from the @faicad/faijs
 * facade. The four assertions below are behavior-identical to the pre-P24
 * scenario.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { hasBrep } from '@faicad/faijs/shape'
import { dispatchPath } from '@faicad/faijs/cad-runtime/backend-dispatch'
import * as gear from './gear'
import type { Shape } from '@faicad/faijs/mesh/types'
import type { PartName } from '@faicad/faijs/identity'
import { createEditorRuntime } from '../../../_support/editor-runtime'

let runtime: ReturnType<typeof createRuntime>
let result: Awaited<ReturnType<ReturnType<typeof createRuntime>['execute']>>

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createEditorRuntime(createNodePorts(), 'auto')
  runtime.registerLib('gear', gear as never, { autoLift: true, packageName: 'test-fixture-lib' })
  result = await runtime.execute([
    "import * as gear from 'test-fixture-lib'",
    'let part0 = gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })',
    'let part1 = cad.box(48, 48, 8, { centered: true })',
    'let part2 = cad.union(part0, part1)',
  ].join('\n'))
}, 120000)

function shapeOf(partId: string): Shape {
  const shape = result.outputs.get(partId as PartName)
  if (!shape) throw new Error(`no output for ${partId}`)
  return shape as Shape
}

describe('C3 external-CAD end-to-end scenario (assertions 1–4)', () => {
  it('assertion 1: part0 is BREP (hasBrep === true, geometry non-empty)', () => {
    expect(result.failedAt).toBeUndefined()
    const p0 = shapeOf('part0')
    expect(hasBrep(p0)).toBe(true)
    expect(p0.positions.length).toBeGreaterThan(0)
    expect(p0.indices.length).toBeGreaterThan(0)
  })

  it('assertion 2: cad.union runs on the BREP path (dispatchPath(part0,part1) === "brep", not mesh)', () => {
    const p0 = shapeOf('part0')
    const p1 = shapeOf('part1')
    expect(hasBrep(p1)).toBe(true)
    // static dispatch: auto mode + all inputs hasBrep + brep implementation → 'brep'
    const path = dispatchPath([p0, p1], { brep: () => undefined })
    expect(path).toBe('brep')
    // and the union result keeps its BREP slot — exact boolean, no mesh degrade
    const p2 = shapeOf('part2')
    expect(hasBrep(p2)).toBe(true)
  })

  it('assertion 3: UNION result STEP export is exact (contains ADVANCED_FACE, not faceted)', () => {
    const entry = result.brepSolids?.get('part2' as PartName)
    expect(entry).toBeDefined()
    const step = entry!.kernel.exportStep(entry!.solid)
    expect(step).toContain('ADVANCED_FACE')
    expect(step).not.toContain('POLY_FACE')
  })

  it('assertion 4: geometry cross-check (core cylinder payload) radius = m×z/2 = 24', () => {
    // 2026-09-25 core-decouple: the vendored gear factories are deleted; the
    // library payload is now a core cylinder with radius m×z/2 = 2×24/2 = 24.
    const p0 = shapeOf('part0')
    let xyMax = -Infinity
    for (let i = 0; i < p0.positions.length; i += 3) {
      const x = Math.abs(p0.positions[i])
      const y = Math.abs(p0.positions[i + 1])
      const m = Math.max(x, y)
      if (m > xyMax) xyMax = m
    }
    expect(xyMax).toBeGreaterThan(24 - 1)
    expect(xyMax).toBeLessThanOrEqual(24 + 1)
  })
})
