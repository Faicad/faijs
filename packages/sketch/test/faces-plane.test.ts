/**
 * F4 — solved constrained sketch through the unified placement pipeline.
 *
 * `sketchFaces` now builds the solved contours via core's shared 2D→3D
 * placement (`buildSketchOnPlaneWith`), so a solved sketch can be placed on an
 * arbitrary named plane — not just the implicit z=0 frame. These e2e tests run
 * on the occt BREP engine (the sketch op is brep-only, D5):
 *
 * - a solved *constrained* rectangle placed on `'XZ'` yields a valid planar
 *   face with positive surface area (and extrudes along +Y into a solid);
 * - `as:'wire'` on a non-default plane returns a 1D curve of positive length;
 * - `assertSketchParams` rejects a non-string `plane` (`E_SKETCHC_BAD_PLANE`).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm } from '@faicad/faijs/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '@faicad/faijs/brep/engine/adapters/occt'
import { getBrepEngine } from '@faicad/faijs/brep/engine/registry'
import { getBrepApi } from '@faicad/faijs/brep/handle-bridge'
import { configureBackends, CONTRACT_VERSION } from '@faicad/faijs/runtime-state'
import { brepOf } from '@faicad/faijs/shape'
import { sketchFaces } from '../src/faces.js'
import { assertSketchParams } from '../src/op.js'
import { createNodePlanegcsSolver } from '../src/node.js'
import type { SketchSolver } from '../src/solver.js'
import type { SketchConstraint, SketchGeom } from '../src/canonical.js'

let solver: SketchSolver

beforeAll(async () => {
  await initOcctWasm()
  await registerOcctBrepEngine()
  // Bridge the registered BREP engine's primitives into the runtime backends so
  // `getBrepApi()` inside the placement pipeline returns a live kernel.
  const brep = (await getBrepEngine()).primitives
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'brep' },
    kernel: { brep, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: undefined,
    cad: undefined,
  } as never)
  solver = await createNodePlanegcsSolver()
}, 120000)

/** A closed rectangle solved to 90(length)×40(height) via H/V + length constraints. */
const GEOMS: SketchGeom[] = [
  { tag: 'bottom', kind: 'line', x1: 0, y1: 0, x2: 40, y2: 0 },
  { tag: 'right', kind: 'line', x1: 40, y1: 0, x2: 40, y2: 30 },
  { tag: 'top', kind: 'line', x1: 40, y1: 30, x2: 0, y2: 30 },
  { tag: 'left', kind: 'line', x1: 0, y1: 30, x2: 0, y2: 0 },
]

const CONSTRAINTS: SketchConstraint[] = [
  { kind: 'horizontal', of: { tag: 'bottom' } },
  { kind: 'horizontal', of: { tag: 'top' } },
  { kind: 'vertical', of: { tag: 'left' } },
  { kind: 'vertical', of: { tag: 'right' } },
  { kind: 'coincident', a: { tag: 'bottom', at: 'end' }, b: { tag: 'right', at: 'start' } },
  { kind: 'coincident', a: { tag: 'right', at: 'end' }, b: { tag: 'top', at: 'start' } },
  { kind: 'coincident', a: { tag: 'top', at: 'end' }, b: { tag: 'left', at: 'start' } },
  { kind: 'coincident', a: { tag: 'left', at: 'end' }, b: { tag: 'bottom', at: 'start' } },
  { kind: 'length', of: { tag: 'bottom' }, value: 90 },
  { kind: 'length', of: { tag: 'left' }, value: 40 },
]

describe('sketchFaces placement (F4, occt)', () => {
  it('solved constrained sketch on XZ plane → valid face with positive area', async () => {
    const shape = await sketchFaces(GEOMS, CONSTRAINTS, { solver, plane: 'XZ' })
    const handle = brepOf(shape) as never
    const faces = getBrepApi().getSubShapes(handle, 'face' as never) as never[]
    expect(faces).toHaveLength(1)
    // 90(length)×40(height) rectangle → surface area 3600 mm² (placement does not scale).
    expect(getBrepApi().getSurfaceArea(faces[0]!)).toBeCloseTo(90 * 40, 0)
    expect(getBrepApi().isValid(faces[0]!)).toBe(true)
  })

  it('solved sketch on XZ plane → extrude along +Y gives a positive-volume solid', async () => {
    const shape = await sketchFaces(GEOMS, CONSTRAINTS, { solver, plane: 'XZ' })
    const face = brepOf(shape) as never
    const solid = getBrepApi().extrude(face, 0, 5, 0)
    expect(getBrepApi().getVolume(solid)).toBeCloseTo(90 * 40 * 5, 0)
  })

  it("as:'wire' on XZ returns a 1D curve of positive length (outer loop)", async () => {
    const shape = await sketchFaces(GEOMS, CONSTRAINTS, { solver, plane: 'XZ', as: 'wire' })
    expect((shape as { kind?: string }).kind).toBe('curve')
    const wire = brepOf(shape) as never
    expect(getBrepApi().getLength(wire)).toBeCloseTo(2 * (90 + 40), 0)
  })

  it('assertSketchParams rejects a non-string plane', () => {
    expect(() => assertSketchParams({ geoms: GEOMS, plane: 7 })).toThrow(/E_SKETCHC_BAD_PLANE/)
  })
})
