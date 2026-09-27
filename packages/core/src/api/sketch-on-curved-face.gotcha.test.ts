/**
 * @vitest-environment node
 *
 * G2 residual — `fixWireOnFace 曲面贴合` exploration, PINNED as a known
 * hard-blocked boundary (not a bug-chase).
 *
 * `cad.sketchOnFace` places a closed 2D contour onto the UV space of an existing
 * face and wraps the sample→UV→interpolate 3D wire as a face. This works for a
 * PLANAR face (`sketch-on-face-e2e.test.ts` proves centre→extrude volume, wire,
 * bounds). For a CURVED (cylindrical) host face the on-surface wire is an
 * interpolated set of BSpline edges on the cylinder, and OCCT cannot reconstruct
 * an exact face from that wire (`BRepBuilderAPI_MakeFace` succeeds only when the
 * wire lies on a planar fit or an already-known surface). So:
 *
 *   cur⧋ extrude from a sketchOn curved face  →  CONSTRUCTION_FAILED: makeFace:
 *   construction failed  (hard-blocked at the face-construction stage)
 *
 * G2 ("曲面草图 e2e", extrude/punchHole off a curved face) and E3's
 * `fixWireOnFace 曲面贴合` residual are therefore genuinely open: they need an
 * OCCT surface-fitting / `makeFaceOnSurface` capability this repo's brep adapter
 * does not yet provide. This test PINNS that boundary so a future change to the
 * adapter (or OCCT surface reconstruction) is caught as a regression flip.
 *
 * GOTCHA: keep this mirroring the planar-gate sanity in the same harness so a
 * harness break isn't mistaken for a curved-surface fix.
 *
 * Run: npx vitest run src/api/sketch-on-curved-face.gotcha.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../cad-runtime/runtime'
import type { ExecutionResult } from '../cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../cad-runtime/ports'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import { __resetEngineRegistriesForTests } from '../brep/engine/registry'
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

/** Ordinal (1-based) of a host face whose OCCT surfaceType is `cylindrical`. */
async function curvedFaceOrdinal(): Promise<number> {
  const base = await exec('const p0 = cad.cylinder(5, 20)\n')
  if (base.failedAt) throw new Error(base.failedAt.message)
  const h = handleOf(base, 'p0')
  const faces = getBrepApi().getSubShapes(h, 'face' as never) as never[]
  for (let i = 0; i < faces.length; i++) {
    const t: string = getBrepApi().surfaceType(faces[i]!) as string
    if (t.toLowerCase().includes('cylind')) return i + 1
  }
  throw new Error('no cylindrical face found on cad.cylinder')
}

describe('cad.sketchOnFace on a curved face — pinned boundary (G2/fixWireOnFace)', () => {
  it('curved(cylindrical) host face → sketchOnFace throws CONSTRUCTION_FAILED makeFace', async () => {
    const ord = await curvedFaceOrdinal()
    const result = await exec(
      `const p0 = cad.cylinder(5, 20)\n` +
        `const sk = cad.sketchOnFace({ contours: ${JSON.stringify([sq(1, 2, 2)])}, on: p0, face: ${ord}, scaleMode: 'original' })\n`,
    )
    // The contour (u∈[1,4],v∈[2,5]) is well inside the UV bounds; the failure is
    // the exact-surface reconstruction of the interpolated on-surface wire, NOT
    // an out-of-bounds contour. This pins the current G2 hard boundary.
    expect(result.failedAt).toBeTruthy()
    expect(result.failedAt?.message ?? '').toMatch(/CONSTRUCTION_FAILED|makeFace/)
  })

  it('control: planar top-face sketchOnFace still extrudes (harness + planar valid)', async () => {
    const base = await exec('const p0 = cad.box(20, 20, 10)\n')
    if (base.failedAt) throw new Error(base.failedAt.message)
    const box = handleOf(base, 'p0')
    const faces = getBrepApi().getSubShapes(box, 'face' as never) as never[]
    let top = 1
    for (let i = 0; i < faces.length; i++) {
      const n = getBrepApi().surfaceNormal(faces[i]!, 0, 0)
      if (Math.abs(n.z - 1) < 1e-6) {
        top = i + 1
        break
      }
    }
    const result = await exec(
      `const p0 = cad.box(20, 20, 10)\n` +
        `const sk = cad.sketchOnFace({ contours: ${JSON.stringify([sq(5, 5, 5)])}, on: p0, face: ${top}, scaleMode: 'original' })\n` +
        `const part1 = cad.extrude(sk, [0, 0, 3])`,
    )
    if (result.failedAt) throw new Error(`planar sketchOnFace failed: ${result.failedAt.message}`)
    const solids = solidsOf(handleOf(result, 'part1'))
    expect(solids).toHaveLength(1)
    expect(getBrepApi().getVolume(solids[0]!)).toBeGreaterThan(0)
  })
})
