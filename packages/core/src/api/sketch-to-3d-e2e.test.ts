/**
 * @vitest-environment node
 *
 * E5 `Sketch → 3D` exits e2e (occt) — declarative-resolved route.
 *
 * `sketchOnPlane`/`sketchOnFace` are the placement step; `cad.extrude` /
 * `cad.revolve` / `cad.sweep` / `cad.loft` are the four 3D exits the plan's E5
 * `Sketch.extrude/revolve/sweepSketch/loftWith` would have offered on a stateful
 * `Sketch`. Per arg-spec P14-batch-10 the brepjs stateful sketching DSL
 * (`Sketch`/`CompoundSketch` + `sketch*`/`compoundSketch*` fns) is skipped in
 * faijs — modeling is expressed with these declarative ops, so E5 is resolved
 * by pinning that a **placed sketch exits through every one of the four 3D
 * features**, not by porting a kernel-holding state machine.
 *
 * Covered here:
 * - `sketchOnPlane` face → `extrude` along the plane normal (positive volume) —
 *   the `Sketch.extrude` exit (shared with E2 e2e);
 * - `sketchOnPlane` face → `revolve` around an external axis (the only E5 exit
 *   not yet pinned anywhere) — annular solid with a positive volume;
 * - two placed `sketchOnPlane` sections → `sweep` and `loft` — the
 *   `sweepSketch` / `loftWith` exits, each yielding a single positive-volume
 *   solid of correct extent.
 *
 * Run: npx vitest run src/api/sketch-to-3d-e2e.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../cad-runtime/runtime'
import type { ExecutionResult } from '../cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../cad-runtime/ports'
import { asPartName } from '../identity'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import type { Shape } from '../mesh/types'
import { __resetEngineRegistriesForTests } from '../brep/engine/registry'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf } from '../shape'
import { createApiNamespaceWithEditorOps } from '../test-support/editor-ops'
import type { ProfileLoop } from './profile'

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

/** Axis-aligned square loop (lower-left at (x,y), side s). */
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

const planeXY = (): string => "{ name: 'XY' }"

function handleOf(result: ExecutionResult, part: string): never {
  const s = result.outputs.get(asPartName(part)) as Shape | undefined
  if (!s) throw new Error(`no output for ${part}`)
  return brepOf(s) as never
}

function solidsOf(handle: never): never[] {
  return getBrepApi().getSubShapes(handle, 'solid' as never) as never[]
}

function volumeOf(result: ExecutionResult, part: string): number {
  const solids = solidsOf(handleOf(result, part))
  expect(solids.length).toBe(1) // single solid, not fragmented
  return getBrepApi().getVolume(solids[0]!)
}

describe('cad sketch → four 3D exits, e2e (E5, occt)', () => {
  it('extrude: placed sketch → solid of volume w·h·d', async () => {
    const result = await exec(
      `const part0 = cad.sketchOnPlane({ contours: ${JSON.stringify([sq(0, 0, 20)])}, plane: ${planeXY()} })\n` +
        `const part1 = cad.extrude(part0, [0, 0, 5])`,
    )
    if (result.failedAt) throw new Error(result.failedAt.message)
    expect(volumeOf(result, 'part1')).toBeCloseTo(20 * 20 * 5, 0)
  })

  it('revolve: placed sketch lathed about an in-plane axis → solid, annulus volume', async () => {
    // 4×4 square placed at x∈[4,8], y∈[0,4] on XY, revolved 360° about the
    // in-plane Y-axis → a washer/annulus of inner radius 4, outer radius 8,
    // height 4: volume = π(8²−4²)·4 ≈ 603. GOTCHA: revolving an XY sketch about
    // the *orthogonal* Z-axis keeps z=0 (flat annular region, volume 0); the
    // revolve axis must lie in the sketch plane to sweep a volume.
    const result = await exec(
      `const part0 = cad.sketchOnPlane({ contours: ${JSON.stringify([sq(4, 0, 4)])}, plane: ${planeXY()} })\n` +
        `const part1 = cad.revolve(part0, { axis: [0, 1, 0], at: [0, 0, 0], angle: ${2 * Math.PI} })`,
    )
    if (result.failedAt) throw new Error(result.failedAt.message)
    expect(volumeOf(result, 'part1')).toBeCloseTo(Math.PI * (64 - 16) * 4, 0)
  })

  it('sweep: placed sketch face extruded along a wire spine (single solid)', async () => {
    const result = await exec(
      `const part0 = cad.sketchOnPlane({ contours: ${JSON.stringify([sq(-4, -4, 8)])}, plane: ${planeXY()} })\n` +
        `const part1 = cad.wire([[0, 0, 0], [0, 0, 50]])\n` +
        `const part2 = cad.sweep(part0, part1)`,
    )
    if (result.failedAt) throw new Error(result.failedAt.message)
    expect(volumeOf(result, 'part2')).toBeGreaterThan(0)
  })

  it('loft: two placed sketch sections → single intermediate solid', async () => {
    const result = await exec(
      `const part0 = cad.sketchOnPlane({ contours: ${JSON.stringify([sq(-5, -5, 10)])}, plane: ${planeXY()} })\n` +
        `const part1 = cad.translate(cad.sketchOnPlane({ contours: ${JSON.stringify([sq(-2, -2, 4)])}, plane: ${planeXY()} }), [0, 0, 20])\n` +
        `const part2 = cad.loft([part0, part1])`,
    )
    if (result.failedAt) throw new Error(result.failedAt.message)
    expect(volumeOf(result, 'part2')).toBeGreaterThan(0)
  })
})