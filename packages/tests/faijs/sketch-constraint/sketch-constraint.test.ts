/**
 * cad.sketch script-face e2e — the sketch constraint op exercised through the
 * full script pipeline (.fai.js source → VM → solve → contour → profile face),
 * NOT the library-level `solveSketch` (covered in packages/sketch).
 *
 * Five scenarios per the plan (§9 step 8):
 * 1. horizontal/vertical rectangle pulled to exact size
 * 2. length-driven line
 * 3. underconstrained sketch (free DoF, no error)
 * 4. redundant over-constraint (dropped, no error)
 * 5. conflicting over-constraint (best-effort solve, no error)
 *
 * The host wiring here mirrors the documented pattern: merge the sketch op into
 * `cad`, register symbols, install the planegcs solver (Node wasm path).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRuntime } from '@faicad/faijs/cad-runtime/runtime'
import { createNodePorts } from '@faicad/faijs/node'
import { registerOcctBrepEngine } from '@faicad/faijs'
import {
  createSketchCadNamespace, registerSketchSymbols, unregisterSketchSymbols,
  installSketchSolver, uninstallSketchSolver,
} from '@faicad/faijs-sketch'
import { createNodePlanegcsSolver } from '@faicad/faijs-sketch/node'
import { asPartName, type PartName } from '@faicad/faijs/identity'
import type { Shape } from '@faicad/faijs/mesh/types'

beforeAll(async () => {
  await registerOcctBrepEngine()
  registerSketchSymbols()
  installSketchSolver(createNodePlanegcsSolver)
}, 120000)

afterAll(() => {
  unregisterSketchSymbols()
  uninstallSketchSolver()
})

async function runScript(code: string): Promise<{
  shape: Shape | undefined
  failedAt: unknown
}> {
  const runtime = createRuntime(createNodePorts(), 'brep', {
    cad: createSketchCadNamespace(),
  })
  const result = await runtime.execute(code)
  const outputs = Array.from(result.outputs.entries())
  const last = outputs[outputs.length - 1]
  const shape = last ? (last[1] as Shape) : undefined
  return { shape, failedAt: result.failedAt }
}

/** Axis-aligned bbox size of a meshed shape. */
function bboxSize(shape: Shape): [number, number, number] {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  const p = shape.positions
  for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i])
    minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1])
    minZ = Math.min(minZ, p[i + 2]); maxZ = Math.max(maxZ, p[i + 2])
  }
  return [maxX - minX, maxY - minY, maxZ - minZ]
}

const RECT = (w: number, h: number, dw: number) => `
let sk0 = cad.sketch({
  geoms: [
    { tag: 'bottom', kind: 'line', x1: 0, y1: 0, x2: ${w + dw}, y2: 0 },
    { tag: 'right',  kind: 'line', x1: ${w + dw}, y1: 0, x2: ${w + dw}, y2: ${h} },
    { tag: 'top',    kind: 'line', x1: ${w + dw}, y1: ${h}, x2: 0, y2: ${h} },
    { tag: 'left',   kind: 'line', x1: 0, y1: ${h}, x2: 0, y2: 0 },
  ],
  constraints: [
    { kind: 'horizontal', of: { tag: 'bottom' } },
    { kind: 'horizontal', of: { tag: 'top' } },
    { kind: 'vertical',   of: { tag: 'right' } },
    { kind: 'vertical',   of: { tag: 'left' } },
    { kind: 'coincident', a: { tag: 'bottom', at: 'end' }, b: { tag: 'right', at: 'start' } },
    { kind: 'coincident', a: { tag: 'right', at: 'end' }, b: { tag: 'top', at: 'start' } },
    { kind: 'coincident', a: { tag: 'top', at: 'end' }, b: { tag: 'left', at: 'start' } },
    { kind: 'coincident', a: { tag: 'left', at: 'end' }, b: { tag: 'bottom', at: 'start' } },
    { kind: 'length', of: { tag: 'bottom' }, value: ${w} },
    { kind: 'length', of: { tag: 'right' }, value: ${h} },
  ],
})
let part0 = cad.extrude(sk0, [0, 0, 10])
`

describe('cad.sketch script-face e2e', () => {
  it('1. horizontal/vertical + length: rectangle pulled to exact size, extruded', async () => {
    // initial width off by 3mm; constraints must pull it to exactly 80×50
    const { shape, failedAt } = await runScript(RECT(80, 50, 3))
    expect(failedAt).toBeUndefined()
    expect(shape).toBeDefined()
    const [sx, sy, sz] = bboxSize(shape!)
    expect(sx).toBeCloseTo(80, 4)
    expect(sy).toBeCloseTo(50, 4)
    expect(sz).toBeCloseTo(10, 4)
  }, 120000)

  it('2. length-driven: single line stretched to exact length, extruded', async () => {
    // a single line does not close a contour → use a rectangle driven only by
    // length constraints on two edges (initial width off by 70mm)
    const code = `
let sk0 = cad.sketch({
  geoms: [
    { tag: 'bottom', kind: 'line', x1: 0, y1: 0, x2: 30, y2: 0 },
    { tag: 'right',  kind: 'line', x1: 30, y1: 0, x2: 30, y2: 20 },
    { tag: 'top',    kind: 'line', x1: 30, y1: 20, x2: 0, y2: 20 },
    { tag: 'left',   kind: 'line', x1: 0, y1: 20, x2: 0, y2: 0 },
  ],
  constraints: [
    { kind: 'coincident', a: { tag: 'bottom', at: 'end' }, b: { tag: 'right', at: 'start' } },
    { kind: 'coincident', a: { tag: 'right', at: 'end' }, b: { tag: 'top', at: 'start' } },
    { kind: 'coincident', a: { tag: 'top', at: 'end' }, b: { tag: 'left', at: 'start' } },
    { kind: 'coincident', a: { tag: 'left', at: 'end' }, b: { tag: 'bottom', at: 'start' } },
    { kind: 'horizontal', of: { tag: 'bottom' } },
    { kind: 'vertical',   of: { tag: 'left' } },
    { kind: 'length', of: { tag: 'bottom' }, value: 100 },
    { kind: 'length', of: { tag: 'left' }, value: 20 },
  ],
})
let part0 = cad.extrude(sk0, [0, 0, 5])
`
    const { shape, failedAt } = await runScript(code)
    expect(failedAt).toBeUndefined()
    expect(shape).toBeDefined()
    const [sx, sy, sz] = bboxSize(shape!)
    expect(sx).toBeCloseTo(100, 4)
    expect(sy).toBeCloseTo(20, 4)
    expect(sz).toBeCloseTo(5, 4)
  }, 120000)

  it('3. underconstrained: no error, geometry output at declared initial values', async () => {
    const code = `
let sk0 = cad.sketch({
  geoms: [
    { tag: 'bottom', kind: 'line', x1: 0, y1: 0, x2: 30, y2: 0 },
    { tag: 'right',  kind: 'line', x1: 30, y1: 0, x2: 30, y2: 20 },
    { tag: 'top',    kind: 'line', x1: 30, y1: 20, x2: 0, y2: 20 },
    { tag: 'left',   kind: 'line', x1: 0, y1: 20, x2: 0, y2: 0 },
  ],
  constraints: [
    { kind: 'coincident', a: { tag: 'bottom', at: 'end' }, b: { tag: 'right', at: 'start' } },
    { kind: 'coincident', a: { tag: 'right', at: 'end' }, b: { tag: 'top', at: 'start' } },
    { kind: 'coincident', a: { tag: 'top', at: 'end' }, b: { tag: 'left', at: 'start' } },
    { kind: 'coincident', a: { tag: 'left', at: 'end' }, b: { tag: 'bottom', at: 'start' } },
    { kind: 'horizontal', of: { tag: 'bottom' } },
    { kind: 'vertical',   of: { tag: 'left' } },
  ],
})
let part0 = cad.extrude(sk0, [0, 0, 5])
`
    const { shape, failedAt } = await runScript(code)
    expect(failedAt).toBeUndefined()
    expect(shape).toBeDefined()
    const [sx, sy, sz] = bboxSize(shape!)
    // remaining DoF absorbed by the declared initial coordinates
    expect(sx).toBeCloseTo(30, 4)
    expect(sy).toBeCloseTo(20, 4)
    expect(sz).toBeCloseTo(5, 4)
  }, 120000)

  it('4. redundant over-constraint: duplicate length dropped, no error', async () => {
    // H+V on every edge + 4 coincidences; the duplicate length is redundant
    // but must not fail the script
    const redundant = `
let sk0 = cad.sketch({
  geoms: [
    { tag: 'bottom', kind: 'line', x1: 0, y1: 0, x2: 80, y2: 0 },
    { tag: 'right',  kind: 'line', x1: 80, y1: 0, x2: 80, y2: 50 },
    { tag: 'top',    kind: 'line', x1: 80, y1: 50, x2: 0, y2: 50 },
    { tag: 'left',   kind: 'line', x1: 0, y1: 50, x2: 0, y2: 0 },
  ],
  constraints: [
    { kind: 'horizontal', of: { tag: 'bottom' } },
    { kind: 'horizontal', of: { tag: 'top' } },
    { kind: 'vertical',   of: { tag: 'right' } },
    { kind: 'vertical',   of: { tag: 'left' } },
    { kind: 'coincident', a: { tag: 'bottom', at: 'end' }, b: { tag: 'right', at: 'start' } },
    { kind: 'coincident', a: { tag: 'right', at: 'end' }, b: { tag: 'top', at: 'start' } },
    { kind: 'coincident', a: { tag: 'top', at: 'end' }, b: { tag: 'left', at: 'start' } },
    { kind: 'coincident', a: { tag: 'left', at: 'end' }, b: { tag: 'bottom', at: 'start' } },
    { kind: 'length', of: { tag: 'bottom' }, value: 80 },
    { kind: 'length', of: { tag: 'bottom' }, value: 80 },
  ],
})
let part0 = cad.extrude(sk0, [0, 0, 5])
`
    const { shape, failedAt } = await runScript(redundant)
    expect(failedAt).toBeUndefined()
    expect(shape).toBeDefined()
    const [sx, sy, sz] = bboxSize(shape!)
    expect(sx).toBeCloseTo(80, 4)
    expect(sy).toBeCloseTo(50, 4)
    expect(sz).toBeCloseTo(5, 4)
  }, 120000)

  it('5. conflicting over-constraint: best-effort solve, no error', async () => {
    // two different lengths demanded of the same edge → solver returns a
    // best-effort result; the script must still produce geometry
    const code = `
let sk0 = cad.sketch({
  geoms: [
    { tag: 'bottom', kind: 'line', x1: 0, y1: 0, x2: 80, y2: 0 },
    { tag: 'right',  kind: 'line', x1: 80, y1: 0, x2: 80, y2: 50 },
    { tag: 'top',    kind: 'line', x1: 80, y1: 50, x2: 0, y2: 50 },
    { tag: 'left',   kind: 'line', x1: 0, y1: 50, x2: 0, y2: 0 },
  ],
  constraints: [
    { kind: 'horizontal', of: { tag: 'bottom' } },
    { kind: 'horizontal', of: { tag: 'top' } },
    { kind: 'vertical',   of: { tag: 'right' } },
    { kind: 'vertical',   of: { tag: 'left' } },
    { kind: 'coincident', a: { tag: 'bottom', at: 'end' }, b: { tag: 'right', at: 'start' } },
    { kind: 'coincident', a: { tag: 'right', at: 'end' }, b: { tag: 'top', at: 'start' } },
    { kind: 'coincident', a: { tag: 'top', at: 'end' }, b: { tag: 'left', at: 'start' } },
    { kind: 'coincident', a: { tag: 'left', at: 'end' }, b: { tag: 'bottom', at: 'start' } },
    { kind: 'length', of: { tag: 'bottom' }, value: 80 },
    { kind: 'length', of: { tag: 'top' }, value: 60 },
  ],
})
let part0 = cad.extrude(sk0, [0, 0, 5])
`
    const { shape, failedAt } = await runScript(code)
    expect(failedAt).toBeUndefined()
    expect(shape).toBeDefined()
    expect(shape!.positions.length).toBeGreaterThan(0)
  }, 120000)

  it('GOTCHA: as:\'wire\' returns a wire (1D), not a faced shape', async () => {
    const code = `
let sk0 = cad.sketch({
  geoms: [
    { tag: 'bottom', kind: 'line', x1: 0, y1: 0, x2: 80, y2: 0 },
    { tag: 'right',  kind: 'line', x1: 80, y1: 0, x2: 80, y2: 50 },
    { tag: 'top',    kind: 'line', x1: 80, y1: 50, x2: 0, y2: 50 },
    { tag: 'left',   kind: 'line', x1: 0, y1: 50, x2: 0, y2: 0 },
  ],
  constraints: [
    { kind: 'horizontal', of: { tag: 'bottom' } },
    { kind: 'vertical',   of: { tag: 'right' } },
    { kind: 'coincident', a: { tag: 'bottom', at: 'end' }, b: { tag: 'right', at: 'start' } },
    { kind: 'length', of: { tag: 'bottom' }, value: 80 },
  ],
  as: 'wire',
})
let part0 = sk0
`
    const { shape, failedAt } = await runScript(code)
    expect(failedAt).toBeUndefined()
    expect(shape).toBeDefined()
    // a wire has no faces: no volume mesh, only curve geometry
    expect(shape!.indices.length).toBe(0)
  }, 120000)
})
