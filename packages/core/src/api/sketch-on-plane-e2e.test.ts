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
import { assertProfileParams, toContourBlueprints } from './profile'
import { createApiNamespaceWithEditorOps } from '../test-support/editor-ops'
import { asPartName } from '../identity'
import { roundedRectangleBlueprint } from '../geometry2d/canned-blueprints'
import { Blueprint } from '../geometry2d/blueprint'
import { BaseSketcher2d } from '../geometry2d/pen-sketcher'
import { buildShapeFromBlueprints, buildSketchOnPlaneWith, resolvePlane } from './sketch-on-plane'

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

  // F6 draw→placement seam: a draw-package contour is literally a core
  // geometry2d `Blueprint` (the draw factory calls `roundedRectangleBlueprint`).
  // Placing a `Blueprint` through the shared placement core and extruding along
  // the plane normal must yield a positive-volume solid — proving the draw
  // entrance funnels into the same pipeline as `cad.sketchOnPlane`.
  it('draw Blueprint (rounded rectangle) → buildShapeFromBlueprints → extrude → solid', () => {
    const bp = roundedRectangleBlueprint(20, 10, 3) // same Blueprint shape the draw package produces
    const plane = resolvePlane({ name: 'XY' })
    const shape = buildShapeFromBlueprints(getBrepApi(), plane, [bp], 'face')
    const face = brepOf(shape) as never
    const solid = getBrepApi().extrude(face, 0, 0, 5)
    expect(getBrepApi().getVolume(solid)).toBeGreaterThan(0)
  })
})

/**
 * 2026-09-28 — `contours` accepts a DRAWN contour (`cad.draw`'s product), not
 * only segment-loop data.
 *
 * Why this is not a nicety: the plan's Draft chain is "draw → `sketchOnPlane` →
 * `extrude`", and `cad.draw` yields a pure-data `Blueprint` with NO OCCT handle.
 * Without this acceptance there is no op in the whole repo that can turn a drawn
 * contour into a Shape — measured: `cad.extrude(drawn, dir)` fails with
 * `E_BREP_INPUT: argument carries no BREP handle`, `cad.sweep(drawn, …)` with
 * `INVALID_SHAPE_ID`.
 */
describe('drawn-contour acceptance (a `cad.draw` product as `contours`)', () => {
  /** One closed contour as the pen produces it (exactly what `cad.draw` returns). */
  function drawnSquare(w = 20, h = 10): Blueprint {
    const pen = new BaseSketcher2d()
    pen.polyline([[0, 0], [w, 0], [w, h], [0, h], [0, 0]])
    return new Blueprint(pen.curves())
  }

  it('GOTCHA: a drawn Blueprint carries no BREP handle — extruding it directly is the failure this bridge removes', () => {
    expect(brepOf(drawnSquare() as unknown as Shape)).toBeUndefined()
  })

  it('places a drawn Blueprint handed in as `contours`, then extrudes to the expected solid', () => {
    const shape = buildSketchOnPlaneWith(getBrepApi(), {
      contours: drawnSquare(),
      plane: { name: 'XY' },
    })
    const face = brepOf(shape) as never
    const solid = getBrepApi().extrude(face, 0, 0, 5)
    expect(getBrepApi().getVolume(solid)).toBeCloseTo(20 * 10 * 5, 3)
  })

  it('accepts an ARRAY of drawn contours — one per loop, kept as separate islands', () => {
    const a = drawnSquare(20, 10)
    const b = (() => {
      const pen = new BaseSketcher2d()
      pen.polyline([[100, 0], [110, 0], [110, 10], [100, 10], [100, 0]])
      return new Blueprint(pen.curves())
    })()
    const shape = buildSketchOnPlaneWith(getBrepApi(), {
      contours: [a, b],
      plane: { name: 'XY' },
    })
    const solid = getBrepApi().extrude(brepOf(shape) as never, 0, 0, 5)
    // two disjoint 20×10 and 10×10 islands ⇒ both must survive as one compound
    expect(getBrepApi().getVolume(solid)).toBeCloseTo((200 + 100) * 5, 3)
  })

  it('GOTCHA: loops and drawn contours must not be mixed — rejected, not half-read', () => {
    expect(() =>
      assertProfileParams({ contours: [sq(0, 0, 10), drawnSquare()] }),
    ).toThrow(/E_PROFILE_MIXED_CONTOURS/)
  })

  it('a segment-loop array still reaches the same Blueprint set (no regression)', () => {
    const [bp] = toContourBlueprints([sq(0, 0, 10)])
    expect(bp).toBeInstanceOf(Blueprint)
    expect(bp!.curves).toHaveLength(4)
  })

  it('an empty contour set is still refused', () => {
    expect(() => assertProfileParams({ contours: [] })).toThrow(/E_PROFILE_NO_CONTOURS/)
    expect(() => toContourBlueprints([])).toThrow(/E_PROFILE_NO_CONTOURS/)
  })
})