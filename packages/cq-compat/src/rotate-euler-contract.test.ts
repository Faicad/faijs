/**
 * GOTCHA 2026-09-29: `cad.rotate_euler` only accepts the `angles` key
 * (degrees, XYZ order). The arg table silently DROPS unknown keys, so writing
 * `anglesDeg` does not fail at the call site — it fails one layer down inside
 * `assertVec3(params.angles)`, which reports "angles must be a vec3 … got
 * undefined" and hides the real culprit. This exact misspelling shipped in
 * `cq-compat/src/workplane.ts` (3 call sites) and turned 21 tests red before it
 * was fixed (see .agents/notes/implemented/bug-fix/
 * 2026-09-29-rotate-euler-angles-deg-gotcha.md).
 *
 * The second half pins the *observable* consequence: `orientZTo` is the shared
 * "aim a Z-axis tool along the workplane normal" helper. On an axis-aligned
 * normal it happens to be a no-op (`angles` = [0,0,0]), so a broken key would
 * still pass the X/Y/Z-face-light tests. The >X face needs a 90° Y rotation
 * (non-trivial angles), so every hole-family path (hole / cboreHole / cskHole /
 * cutThruAll / cylinder) is checked there — a wrong key collapses all of them.
 */

import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { getBrepApi } from '@faicad/faijs/brep/handle-bridge'
import { brepOf } from '@faicad/faijs/shape'
import type { BrepHandle } from '@faicad/faijs/brep/engine/types'
import { asPartName } from '@faicad/faijs/identity'
import type { Shape } from '@faicad/faijs/mesh/types'
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
  return (getBrepApi().getSubShapes(brepOf(shape) as BrepHandle, 'solid') as unknown[]).length
}

function volume(shape: Shape): number {
  return getBrepApi().getVolume(brepOf(shape) as BrepHandle)
}

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/cq-compat' } as never)
  const warm = await runtime.execute('let a = cad.box(1, 1, 1, { centered: true })')
  expect(warm.failedAt).toBeUndefined()
}, 120000)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('cad.rotate_euler contract — `angles`, never `anglesDeg`', () => {
  it('rejects the misspelled `anglesDeg` key (dropped by the arg table → assertVec3 throws)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await runtime.execute(
      [
        'let part0 = cad.box(2, 2, 2, { centered: true })',
        'let result = cad.rotate_euler(part0, { anglesDeg: [0, 0, 45] })',
      ].join('\n'),
    )
    expect(res.failedAt).toBeDefined()
    expect(warn).toBeDefined()
    expect(error).toBeDefined()
  }, 60000)

  it('accepts the `angles` key and rotates about Z', async () => {
    const res = await runtime.execute(
      [
        'let part0 = cad.box(2, 4, 2, { centered: true })',
        'let result = cad.rotate_euler(part0, { angles: [0, 0, 90] })',
      ].join('\n'),
    )
    expect(res.failedAt).toBeUndefined()
    const shape = res.outputs.get(asPartName('result')) as Shape | undefined
    expect(shape).toBeDefined()
    // A 90° Z rotation turns the 2×4 footprint into 4×2; the volume is invariant.
    const bbox = getBrepApi().getBoundingBox(brepOf(shape!) as BrepHandle)
    expect(bbox.xmax - bbox.xmin).toBeCloseTo(4, 1)
    expect(bbox.ymax - bbox.ymin).toBeCloseTo(2, 1)
  }, 60000)
})

describe('orientZTo on a non-axis-aligned normal (the >X face needs a 90° Y rotation)', () => {
  const BOX_VOL = 60 * 40 * 8

  it('hole() drills 2mm into the >X face along the face normal', async () => {
    const shape = await runShape([
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 60, 40, 8)',
      "let wp2 = cq.faces(wp1, '>X')",
      'let wp3 = cq.workplane(wp2)',
      'let wp4 = cq.hole(wp3, 6, 2)',
      'let wp_out = wp4',
    ])
    expect(solidCount(shape)).toBe(1)
    expect(volume(shape)).toBeCloseTo(BOX_VOL - Math.PI * 9 * 2, 0)
  }, 60000)

  it('cutThruAll() drills a φ6 hole through the 60mm >X face span', async () => {
    const shape = await runShape([
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 60, 40, 8)',
      "let wp2 = cq.faces(wp1, '>X')",
      'let wp3 = cq.workplane(wp2)',
      'let wp4 = cq.circle(wp3, 3)',
      'let wp5 = cq.cutThruAll(wp4)',
      'let wp_out = wp5',
    ])
    expect(solidCount(shape)).toBe(1)
    expect(volume(shape)).toBeCloseTo(BOX_VOL - Math.PI * 9 * 60, 0)
  }, 60000)

  it('cskHole() cuts a through hole + 90° countersink on the >X face', async () => {
    const shape = await runShape([
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 60, 40, 8)',
      "let wp2 = cq.faces(wp1, '>X')",
      'let wp3 = cq.workplane(wp2)',
      'let wp4 = cq.cskHole(wp3, 4, 8, 90)',
      'let wp_out = wp4',
    ])
    expect(solidCount(shape)).toBe(1)
    const through = Math.PI * 2 * 2 * 60
    const coneNet = (Math.PI * 32) / 3
    expect(volume(shape)).toBeCloseTo(BOX_VOL - through - coneNet, 0)
  }, 60000)

  it('cboreHole() cuts a through hole + counterbore on the >X face', async () => {
    const shape = await runShape([
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 60, 40, 8)',
      "let wp2 = cq.faces(wp1, '>X')",
      'let wp3 = cq.workplane(wp2)',
      'let wp4 = cq.cboreHole(wp3, 4, 7, 2)',
      'let wp_out = wp4',
    ])
    expect(solidCount(shape)).toBe(1)
    // φ4 through 60mm, plus the φ7 counterbore 2mm deep minus the φ4 already removed.
    const removed = Math.PI * 4 * 60 + Math.PI * 12.25 * 2 - Math.PI * 4 * 2
    expect(volume(shape)).toBeCloseTo(BOX_VOL - removed, 0)
  }, 60000)

  it('cylinder() fuses along the >X face normal (半柱外凸)', async () => {
    const shape = await runShape([
      "let wp = cq.Workplane('XY')",
      'let wp1 = cq.box(wp, 60, 40, 8)',
      "let wp2 = cq.faces(wp1, '>X')",
      'let wp3 = cq.workplane(wp2)',
      'let wp4 = cq.cylinder(wp3, 8, 3)',
      'let wp_out = wp4',
    ])
    expect(solidCount(shape)).toBe(1)
    // Centred on the face plane: half the 8mm cylinder sticks out (+X).
    expect(volume(shape)).toBeCloseTo(BOX_VOL + Math.PI * 9 * 4, 0)
  }, 60000)
})