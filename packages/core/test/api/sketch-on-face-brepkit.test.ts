/**
 * sketch-on-face-brepkit — engine verdict probe: does brepkit support cad.sketchOnFace?
 *
 * sketch-on-face.ts declares `engines: ['occt']` (BREP path) and
 * `meshEngines: ['brepkit']` (mesh-solid path). This test pins the *actual*
 * brepkit verdict by executing the op on a brepkit-assembled runtime:
 *
 *   1. mesh-solid path (brepkit as the mesh backend): sketchOnFace on a mesh
 *      solid must succeed — this is the documented brepkit capability.
 *   2. BREP path request under brepkit: must fail statically (E_ENGINE_*
 *      verdict), never silently fall back.
 *
 * The doc generator's engine buckets must stay consistent with these facts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { createEditorRuntime } from '../support/editor-ops'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerBrepkitMeshEngine } from '../../src/brep/engine/adapters/brepkit'
import { disposeBrepkit } from '../../src/brepkit-kernel/brepkitKernel'

function binaryStl(tris: number[][]): ArrayBuffer {
  const n = tris.length
  const buf = new ArrayBuffer(84 + n * 50)
  const view = new DataView(buf)
  view.setUint32(80, n, true)
  let off = 84
  for (const t of tris) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = t as number[]
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len
    for (const v of [nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz]) {
      view.setFloat32(off, v, true)
      off += 4
    }
    view.setUint16(off, 0, true)
    off += 2
  }
  return buf
}

function boxTriangles(dx: number, dy: number, dz: number): number[][] {
  const O = [0, 0, 0], X = [dx, 0, 0], Y = [0, dy, 0], Z = [0, 0, dz]
  const XY = [dx, dy, 0], XZ = [dx, 0, dz], YZ = [0, dy, dz], XYZ = [dx, dy, dz]
  const quad = (a: number[], b: number[], c: number[], d: number[]): number[][] => [
    [...a, ...b, ...c], [...a, ...c, ...d],
  ]
  return [
    ...quad(O, Y, XY, X),
    ...quad(O, Z, YZ, Y),
    ...quad(O, X, XZ, Z),
    ...quad(Z, XZ, XYZ, YZ),
    ...quad(X, XY, XYZ, XZ),
    ...quad(Y, YZ, XYZ, XY),
  ]
}

function portsFor(files: Record<string, ArrayBuffer>): HostPorts {
  return {
    events: { emit: () => undefined },
    assets: {
      resolveByKey: async (key: string) => {
        const bytes = files[key]
        if (!bytes) throw new Error(`[test] no asset for file: ${key}`)
        return { bytes }
      },
      resolveFile: async () => { throw new Error('[test] resolveFile unused') },
      resolveUrl: async () => { throw new Error('[test] resolveUrl unused') },
    },
  } as unknown as HostPorts
}

interface FaceRowLike {
  surfaceType?: string
  normal?: number[]
  center?: number[]
  area?: number
}

function faceRefLiteral(f: FaceRowLike): string {
  return JSON.stringify({
    kind: 'face',
    origin: 'mesh',
    role: '',
    hint: { kind: 'face', surfaceType: f.surfaceType, normal: f.normal, center: f.center },
  })
}

const BOX_STL = binaryStl(boxTriangles(10, 10, 10))
const PORTS = () => portsFor({ 'cube10.stl': BOX_STL })

/** Load the box on a brepkit mesh runtime and return the +Z face ref literal. */
async function topFaceRefOf(runtime: ReturnType<typeof createEditorRuntime>): Promise<string> {
  const loaded = await runtime.execute("let a = await cad.load({ file: 'cube10.stl' })")
  expect(loaded.failedAt?.message ?? 'no failure').toBe('no failure')
  const topo = loaded.topology?.get('a')
  expect(topo).toBeDefined()
  const faces = topo!.data.faces as unknown as FaceRowLike[]
  const top = faces.find((f) => f.normal !== undefined && (f.normal[2] ?? 0) > 0.9)
  expect(top, 'a +Z planar face exists on the box').toBeDefined()
  return faceRefLiteral(top!)
}

describe('brepkit × cad.sketchOnFace engine verdict', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitMeshEngine()
  })
  afterAll(() => { disposeBrepkit() })

  it('mesh-solid path: sketchOnFace succeeds on a brepkit mesh solid', async () => {
    const probe = createEditorRuntime(PORTS(), 'mesh')
    const ref = await topFaceRefOf(probe)

    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const result = await runtime.execute(
      "let a = await cad.load({ file: 'cube10.stl' })\n" +
      `let s = await cad.sketchOnFace({ contours: [{ segments: [{ kind: 'line', x1: -2, y1: -3, x2: 2, y2: -3 }, { kind: 'line', x1: 2, y1: -3, x2: 2, y2: 3 }, { kind: 'line', x1: 2, y1: 3, x2: -2, y2: 3 }, { kind: 'line', x1: -2, y1: 3, x2: -2, y2: -3 }] }], on: a, face: ${ref} })\n`,
    )
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expect(result.outputs.has('s')).toBe(true)
  })

  it('BREP path: sketchOnFace under brepkit fails statically, no silent fallback', async () => {
    const runtime = createEditorRuntime(PORTS(), 'brep')
    const result = await runtime.execute(
      "let a = await cad.load({ file: 'cube10.stl' })\n" +
      "let s = await cad.sketchOnFace({ contours: [{ segments: [{ kind: 'line', x1: 0, y1: 0, x2: 4, y2: 0 }, { kind: 'line', x1: 4, y1: 0, x2: 4, y2: 4 }, { kind: 'line', x1: 4, y1: 4, x2: 0, y2: 4 }, { kind: 'line', x1: 0, y1: 4, x2: 0, y2: 0 }] }], on: a, face: 0 })\n",
    )
    // The op declares engines: ['occt'] — under brepkit this must be rejected
    // up front (static verdict / failedAt), never produce a silent result.
    expect(result.failedAt).not.toBeNull()
  })
})
