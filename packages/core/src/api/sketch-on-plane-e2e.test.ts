/**
 * @vitest-environment node
 *
 * E2 `cad.sketchOnPlane` placement e2e (occt platform surface).
 *
 * This op is the shared placement step of the unified profile/draw/sketch
 * pipeline — the same contour-loop input as `cad.profile`, but lifted onto an
 * arbitrary plane (named or explicit frame). Extruding the placed face along the
 * plane normal must give a positive volume. `as:'wire'` returns a 1D curve.
 *
 * GOTCHA: the plane frame coords come from `.fai.js` literals as **arrays**
 * (`{ origin: [10,0,0], normal: [0,0,1] }`), and `makePlane`/`namedPlane` must
 * normalize the array form — passing `{x,y,z}` only previously produced
 * `undefined` coords → NaN wire → `makeFace` CONSTRUCTION_FAILED.
 *
 * Run: npx vitest run src/api/sketch-on-plane-e2e.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../cad-runtime/runtime'
import type { ExecutionResult } from '../cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../cad-runtime/ports'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import { __resetEngineRegistriesForTests } from '../brep/engine/registry'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf } from '../shape'
import type { Shape } from '../mesh/types'
import type { ProfileLoop } from './profile'
import { createApiNamespaceWithEditorOps } from '../test-support/editor-ops'
import { asPartName } from '../identity'

beforeAll(async () => {
  await initOcctWasm()
  await registerOcctBrepEngine()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

async function exec(code: string): Promise<ExecutionResult> {
  return new CadRuntime(ports(), 'brep' as ExecutionMode, {
    cad: createApiNamespaceWithEditorOps(),
  }).execute(code)
}

/** 轴对齐正方形环（size 为边长）。 */
function sq(x: number, y: number, s: number): ProfileLoop {
  return {
    segments: [
      { kind: 'line', x1: x, y1: y, x2: x + s, y2: y },
      { kind: 'line', x1: x + s, y1: y, x2: x + s, y2: y + s },
      { kind: 'line', x1: x + s, y1: y + s, x2: x, y2: y + s },
      { kind: 'line', x1: x, y1: y + s, x2: x, y2: y },
    ],
  }
}

function handleOf(result: ExecutionResult, part: string): never {
  const s = result.outputs.get(asPartName(part)) as Shape | undefined
  if (!s) throw new Error(`no output for ${part}`)
  return brepOf(s) as never
}

function solidsOf(handle: never): never[] {
  return getBrepApi().getSubShapes(handle, 'solid' as never) as never[]
}

function facesOf(handle: never): never[] {
  return getBrepApi().getSubShapes(handle, 'face' as never) as never[]
}

/** `part0 = cad.sketchOnPlane(...)` then `part1 = cad.extrude(part0, dir)`; throws on failure. */
function placeAndExtrude(planeLiteral: string, dirLiteral: string) {
  return exec(
    `const part0 = cad.sketchOnPlane({ contours: ${JSON.stringify([sq(0, 0, 20)])}, plane: ${planeLiteral} })\n` +
      `const part1 = cad.extrude(part0, [${dirLiteral.split(',').join(', ')}])`,
  )
}

describe('cad.sketchOnPlane placement e2e (E2, occt)', () => {
  it('XY named plane: extrude along +Z → 20×20×5 solid', async () => {
    const result = await placeAndExtrude('{ name: \'XY\' }', '0, 0, 5')
    if (result.failedAt) throw new Error(result.failedAt.message)
    expect(facesOf(handleOf(result, 'part0'))).toHaveLength(1)
    const solids = solidsOf(handleOf(result, 'part1'))
    expect(solids).toHaveLength(1)
    expect(getBrepApi().getVolume(solids[0]!)).toBeCloseTo(20 * 20 * 5, 0)
  })

  it('XZ named plane: 2D y is drawn as world Z; extrude along +Y gives same volume', async () => {
    const result = await placeAndExtrude('{ name: \'XZ\' }', '0, 5, 0')
    if (result.failedAt) throw new Error(result.failedAt.message)
    const solids = solidsOf(handleOf(result, 'part1'))
    expect(solids).toHaveLength(1)
    expect(getBrepApi().getVolume(solids[0]!)).toBeCloseTo(20 * 20 * 5, 0)
  })

  it('explicit frame with array-origin coords (GOTCHA array form) → extrude gives a solid', async () => {
    const result = await placeAndExtrude('{ origin: [10, 0, 0], normal: [0, 0, 1], xAxis: [1, 0, 0] }', '0, 0, 5')
    if (result.failedAt) throw new Error(`sketch failed: ${result.failedAt.message}`)
    const solids = solidsOf(handleOf(result, 'part1'))
    expect(solids).toHaveLength(1)
    expect(getBrepApi().getVolume(solids[0]!)).toBeCloseTo(20 * 20 * 5, 0)
  })

  it('named XY plane + offset z-origin (placement honors spec.origin)', async () => {
    const result = await placeAndExtrude('{ name: \'XY\', origin: [0, 0, 7] }', '0, 0, 5')
    if (result.failedAt) throw new Error(`sketch failed: ${result.failedAt.message}`)
    const solids = solidsOf(handleOf(result, 'part1'))
    expect(solids).toHaveLength(1)
    expect(getBrepApi().getVolume(solids[0]!)).toBeCloseTo(20 * 20 * 5, 0)
  })

  it('custom oblique plane (normal along (1,1,1)) → 2D contour lifted onto it (on-plane dot=0)', async () => {
    const result = await placeAndExtrude('{ origin: [0,0,0], normal: [1, 1, 1], xAxis: [1, -1, 0] }', '1, 1, 1')
    if (result.failedAt) throw new Error(result.failedAt.message)
    const solids = solidsOf(handleOf(result, 'part1'))
    expect(solids).toHaveLength(1)
    const v = getBrepApi().getVolume(solids[0]!)
    expect(v).toBeGreaterThan(0)
  })

  it("as:'wire' returns a 1D curve whose length is the contour perimeter", async () => {
    const result = await exec(
      `const part0 = cad.sketchOnPlane({ contours: ${JSON.stringify([sq(0, 0, 20)])}, plane: { name: 'XY' }, as: 'wire' })`,
    )
    if (result.failedAt) throw new Error(result.failedAt.message)
    const s = result.outputs.get(asPartName('part0')) as Shape
    expect((s as { kind?: string }).kind).toBe('curve')
    expect(getBrepApi().getLength(handleOf(result, 'part0'))).toBeCloseTo(80, 3)
  })

  // Placed-arc coverage: the bridge `liftCurve2dToPlane` splits a full circle into
  // two swept arcs (and destructures ellipse/bspline into a sampled polyline). These
  // assert those lifting paths survive a real kernel `makeFace` + `extrude` on a plane.
  it('full-circle contour on XY plane → 2-arc wire faces + extrudes (π·r²·h)', async () => {
    const r = 10
    const circle: ProfileLoop = {
      segments: [
        { kind: 'arc', cx: 0, cy: 0, radius: r, startAngle: 0, endAngle: 2 * Math.PI, ccw: true, x1: r, y1: 0, x2: r, y2: 0 },
      ],
    }
    const result = await exec(
      `const part0 = cad.sketchOnPlane({ contours: ${JSON.stringify([circle])}, plane: { name: 'XY' } })\n` +
        `const part1 = cad.extrude(part0, [0, 0, 5])`,
    )
    if (result.failedAt) throw new Error(`sketch failed: ${result.failedAt.message}`)
    const solids = solidsOf(handleOf(result, 'part1'))
    expect(solids).toHaveLength(1)
    expect(getBrepApi().getVolume(solids[0]!)).toBeCloseTo(Math.PI * r * r * 5, 0)
  })
})