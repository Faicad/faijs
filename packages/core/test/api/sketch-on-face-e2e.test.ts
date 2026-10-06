/**
 * @vitest-environment node
 *
 * E3 `cad.sketchOnFace` placement e2e (occt platform surface).
 *
 * Lays a closed 2D contour on the UV space of an existing face of a solid via
 * `geometry2d/bridge/on-surface.ts` (sample → UV map → surface eval →
 * interpolate), then wraps the placed wire as a face. Extruding that face along
 * the host face normal must give a positive volume — proving the face-sketch
 * entrance feeds the unified profile/draw/sketch placement + extrude pipeline.
 *
 * GOTCHA (occt face enumeration): the ordered face ordinal is engine-specific
 * and NOT guaranteed normal-facing, so the test probes the box's faces for the
 * +Z outward-normal one and feeds its ordinal into the `.fai.js` literal.
 *
 * Run: npx vitest run src/api/sketch-on-face-e2e.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { brepOf } from '../../src/shape'
import type { Shape } from '../../src/mesh/types'
import type { ProfileLoop } from '../../src/api/profile'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'
import { asPartName } from '../../src/identity'

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

/** Build a 20×20×10 box and return its +Z-outer-normal face ordinal (1-based). */
async function boxTopFaceOrdinal(): Promise<number> {
  const base = await exec('const p0 = cad.box(20, 20, 10)\n')
  if (base.failedAt) throw new Error(base.failedAt.message)
  const boxHandle = handleOf(base, 'p0')
  const faces = getBrepApi().getSubShapes(boxHandle, 'face' as never) as never[]
  for (let i = 0; i < faces.length; i++) {
    const n = getBrepApi().surfaceNormal(faces[i]!, 0, 0)
    if (Math.abs(n.z - 1) < 1e-6) return i + 1
  }
  throw new Error('no +Z top face found on box')
}

describe('cad.sketchOnFace placement e2e (E3, occt)', () => {
  it('places a square contour on the box top face and extrudes → positive volume', async () => {
    const topOrd = await boxTopFaceOrdinal()
    const result = await exec(
      `const p0 = cad.box(20, 20, 10)\n` +
        `const sk = cad.sketchOnFace({ contours: ${JSON.stringify([sq(5, 5, 5)])}, on: p0, face: ${topOrd}, scaleMode: 'original' })\n` +
        `const part1 = cad.extrude(sk, [0, 0, 3])`,
    )
    if (result.failedAt) throw new Error(`sketchOnFace failed: ${result.failedAt.message}`)
    const solids = solidsOf(handleOf(result, 'part1'))
    expect(solids).toHaveLength(1)
    expect(getBrepApi().getVolume(solids[0]!)).toBeGreaterThan(0)
  })

  it("as:'wire' returns a 1D curve placed on the face", async () => {
    const topOrd = await boxTopFaceOrdinal()
    const result = await exec(
      `const p = cad.box(20, 20, 10)\n` +
        `const sk = cad.sketchOnFace({ contours: ${JSON.stringify([sq(0, 0, 4)])}, on: p, face: ${topOrd}, scaleMode: 'bounds', as: 'wire' })\n`,
    )
    if (result.failedAt) throw new Error(`sketchOnFace failed: ${result.failedAt.message}`)
    const s = result.outputs.get(asPartName('sk')) as Shape
    expect((s as { kind?: string }).kind).toBe('curve')
    const len = getBrepApi().getLength(handleOf(result, 'sk'))
    // 'bounds' mode affine-fits the contour onto the top face UV bounds; a closed
    // 4×4 square must yield a non-degenerate on-face wire (length > 0).
    expect(len).toBeGreaterThan(0)
  })

  it("scaleMode 'bounds' affine-fits the contour onto the face UV bounds and still extrudes", async () => {
    const topOrd = await boxTopFaceOrdinal()
    const result = await exec(
      `const p0 = cad.box(20, 20, 10)\n` +
        `const sk = cad.sketchOnFace({ contours: ${JSON.stringify([sq(0, 0, 4)])}, on: p0, face: ${topOrd}, scaleMode: 'bounds' })\n` +
        `const part1 = cad.extrude(sk, [0, 0, 3])`,
    )
    if (result.failedAt) throw new Error(`sketchOnFace failed: ${result.failedAt.message}`)
    const solids = solidsOf(handleOf(result, 'part1'))
    expect(solids).toHaveLength(1)
    expect(getBrepApi().getVolume(solids[0]!)).toBeGreaterThan(0)
  })
})