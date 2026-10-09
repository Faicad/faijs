/**
 * sketch-on-face-brepkit — engine verdict probe: does brepkit support cad.sketchOnFace?
 *
 * After the 2026-10-09 split `cad.sketchOnFace` is **planar-only and carries no
 * `engines` declaration** (common op). This test pins the *actual* brepkit
 * verdict by executing the op on a brepkit-assembled runtime:
 *
 *   1. mesh-solid path (brepkit as the mesh backend): sketchOnFace on a mesh
 *      solid must succeed — this is the documented brepkit capability.
 *   2. BREP path on a brepkit planar face: must succeed — the new common-engine
 *      capability (planar sketchOnFace now runs on the brepkit BREP engine too).
 *   3. BREP path on a brepkit CURVED face: must fail statically, directed to
 *      `cad.sketchOnSurface` (sketchOnFace is planar-only) — never silently
 *      degrade.
 *
 * The doc generator's engine buckets must stay consistent with these facts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { createEditorRuntime } from '../support/editor-ops'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerBrepkitMeshEngine, registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { disposeBrepkit } from '../../src/brepkit-kernel/brepkitKernel'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { brepOf } from '../../src/shape'
import type { Shape } from '../../src/mesh/types'
import { asPartName } from '../../src/identity'

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

/** A 4×6 square centred at the origin (4 closed line segments). */
function squareContour(): string {
  return JSON.stringify([{
    segments: [
      { kind: 'line', x1: -2, y1: -3, x2: 2, y2: -3 },
      { kind: 'line', x1: 2, y1: -3, x2: 2, y2: 3 },
      { kind: 'line', x1: 2, y1: 3, x2: -2, y2: 3 },
      { kind: 'line', x1: -2, y1: 3, x2: -2, y2: -3 },
    ],
  }])
}

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

/** 1-based ordinal of the box face whose outward normal is +Z (brepkit BREP engine). */
async function boxTopFaceOrdinal(runtime: ReturnType<typeof createEditorRuntime>): Promise<number> {
  const base = await runtime.execute('const p0 = cad.box(10, 10, 10)\n')
  if (base.failedAt) throw new Error(base.failedAt.message)
  const s = base.outputs.get(asPartName('p0')) as Shape | undefined
  if (!s) throw new Error('no box output')
  const h = brepOf(s) as never
  const faces = getBrepApi().getSubShapes(h, 'face' as never) as never[]
  for (let i = 0; i < faces.length; i++) {
    const n = getBrepApi().surfaceNormal(faces[i]!, 0, 0) as { x: number; y: number; z: number }
    if (Math.abs(n.z - 1) < 1e-6) return i + 1
  }
  throw new Error('no +Z planar face on box')
}

/** 1-based ordinal of a cylindrical face on a brepkit cylinder. */
async function cylinderFaceOrdinal(runtime: ReturnType<typeof createEditorRuntime>): Promise<number> {
  const base = await runtime.execute('const p0 = cad.cylinder(5, 20)\n')
  if (base.failedAt) throw new Error(base.failedAt.message)
  const s = base.outputs.get(asPartName('p0')) as Shape | undefined
  if (!s) throw new Error('no cylinder output')
  const h = brepOf(s) as never
  const faces = getBrepApi().getSubShapes(h, 'face' as never) as never[]
  for (let i = 0; i < faces.length; i++) {
    const t = (getBrepApi().surfaceType(faces[i]!) as string).toLowerCase()
    if (t.includes('cylind')) return i + 1
  }
  throw new Error('no cylindrical face on cad.cylinder')
}

describe('brepkit × cad.sketchOnFace engine verdict', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitMeshEngine()
    await registerBrepkitBrepEngine()
  })
  afterAll(() => { disposeBrepkit() })

  it('mesh-solid path: sketchOnFace succeeds on a brepkit mesh solid', async () => {
    const runtime = createEditorRuntime(PORTS(), 'mesh')
    const ref = await topFaceRefOf(runtime)
    const result = await runtime.execute(
      "let a = await cad.load({ file: 'cube10.stl' })\n" +
      `let s = await cad.sketchOnFace({ contours: ${squareContour()}, on: a, face: ${ref} })\n`,
    )
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expect(result.outputs.has('s')).toBe(true)
  })

  it('BREP path: sketchOnFace succeeds on a brepkit PLANAR BREP face (common op, no engine declaration)', async () => {
    const runtime = createEditorRuntime(PORTS(), 'brep')
    const top = await boxTopFaceOrdinal(runtime)
    const result = await runtime.execute(
      `const p0 = cad.box(10, 10, 10)\n` +
        `const sk = cad.sketchOnFace({ contours: ${squareContour()}, on: p0, face: ${top} })\n`,
    )
    expect(result.failedAt?.message ?? 'no failure').toBe('no failure')
    expect(result.outputs.has('sk')).toBe(true)
  })

  it('BREP path: sketchOnFace rejects a brepkit CURVED face (must use cad.sketchOnSurface)', async () => {
    const runtime = createEditorRuntime(PORTS(), 'brep')
    const curved = await cylinderFaceOrdinal(runtime)
    const result = await runtime.execute(
      `const p0 = cad.cylinder(5, 20)\n` +
        `const sk = cad.sketchOnFace({ contours: ${squareContour()}, on: p0, face: ${curved} })\n`,
    )
    expect(result.failedAt, 'curved face must be rejected by planar-only sketchOnFace').toBeTruthy()
    expect(result.failedAt?.message ?? '').toContain('sketchOnSurface')
  })
})
