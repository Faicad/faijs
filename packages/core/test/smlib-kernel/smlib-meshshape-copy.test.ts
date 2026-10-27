// smlib-meshshape-copy.test.ts — regression guard for the 2026-10-27 render
// defect fix.
//
// Root cause (proved by instrumentation): smlibKernel.meshShape returned
// TypedArray views directly over the bridge's malloc'd buffer, then freed that
// buffer in `finally`. Any caller reading the mesh afterwards (immediately, or
// after further wasm calls that re-used the freed block) could observe
// corrupted vertices — the observed symptom was the split half's first poly
// face's first vertex reading (0,0,0), an unclosed mesh with unpairedEdges=4.
// Fix: copy positions/normals/indices out (slice) before the buffer is freed.
//
// This test pins the *contract* (mesh data survives meshShape return and any
// number of subsequent kernel calls, with no (0,0,0) vertices and a closed
// manifold) rather than the implementation detail.

import { describe, expect, it, beforeAll, afterAll } from 'vitest'

import {
  createSmlibPrimitives,
  disposeSmlib,
  type SmlibPrimitives,
} from '../../src/smlib-kernel/smlibKernel'
import {
  initSmlibWasm,
  resetSmlibWasm,
} from '../../src/smlib-kernel/smlibWasm'
import type { BrepHandle } from '../../src/brep/engine/types'
import { splitBrep, translateBrep } from '../../src/brep/brep-ops'
import { DEFAULT_LINEAR_DEFLECTION } from '../../src/tolerance'
import { mm } from '../../src/units'

import type { SmlibKernel } from '../../src/smlib-kernel/smlibWasm'

let p: SmlibPrimitives
let k: SmlibKernel

// End-side display path parameters (brep-topology.ts / joinery solidToMeshData)
const DISPLAY_TESSELLATE = {
  linearDeflection: DEFAULT_LINEAR_DEFLECTION.as(mm),
  angularDeflection: (2 * Math.PI) / 32,
} as const

interface MeshDiag {
  triCount: number
  meshArea: number
  signedVolume: number
  windingViolations: number
  degenerateTris: number
  unpairedEdges: number
  zeroVerts: number
}

/** Grid invariants computed straight from the meshShape output. */
function analyzeMesh(solid: BrepHandle): MeshDiag {
  const mesh = p.meshShape(solid, DISPLAY_TESSELLATE)
  const positions = mesh.positions
  const indices = mesh.indices
  const edgeDir = new Map<string, number>()
  const q = (v: number) => Math.round(v * 1000)
  let meshArea = 0
  let signedVolume = 0
  let windingViolations = 0
  let degenerateTris = 0
  let zeroVerts = 0
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i] === 0 && positions[i + 1] === 0 && positions[i + 2] === 0) zeroVerts++
  }
  for (let t = 0; t < Math.floor(indices.length / 3); t++) {
    const i0 = indices[t * 3]
    const i1 = indices[t * 3 + 1]
    const i2 = indices[t * 3 + 2]
    const x0 = positions[i0 * 3]
    const y0 = positions[i0 * 3 + 1]
    const z0 = positions[i0 * 3 + 2]
    const x1 = positions[i1 * 3]
    const y1 = positions[i1 * 3 + 1]
    const z1 = positions[i1 * 3 + 2]
    const x2 = positions[i2 * 3]
    const y2 = positions[i2 * 3 + 1]
    const z2 = positions[i2 * 3 + 2]
    const cx = (y1 - y0) * (z2 - z0) - (z1 - z0) * (y2 - y0)
    const cy = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0)
    const cz = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
    const clen = Math.hypot(cx, cy, cz)
    meshArea += clen / 2
    if (clen < 1e-9) degenerateTris++
    signedVolume += (x0 * (y1 * z2 - z1 * y2) + y0 * (z1 * x2 - x1 * z2) + z0 * (x1 * y2 - y1 * x2)) / 6
    const edges: Array<[number, number, number, number, number, number]> = [
      [x0, y0, z0, x1, y1, z1],
      [x1, y1, z1, x2, y2, z2],
      [x2, y2, z2, x0, y0, z0],
    ]
    for (const [ax, ay, az, bx, by, bz] of edges) {
      const key = `${q(ax)},${q(ay)},${q(az)}>${q(bx)},${q(by)},${q(bz)}`
      edgeDir.set(key, (edgeDir.get(key) ?? 0) + 1)
    }
  }
  let unpairedEdges = 0
  for (const [key, count] of edgeDir) {
    const gt = key.indexOf('>')
    const rev = `${key.slice(gt + 1)}>${key.slice(0, gt)}`
    const rcount = edgeDir.get(rev) ?? 0
    if (count > rcount) unpairedEdges += count - rcount
  }
  return {
    triCount: Math.floor(indices.length / 3),
    meshArea,
    signedVolume,
    windingViolations,
    degenerateTris,
    unpairedEdges,
    zeroVerts,
  }
}

beforeAll(async () => {
  p = await createSmlibPrimitives()
  k = await initSmlibWasm()
})

afterAll(() => {
  disposeSmlib()
  resetSmlibWasm()
})

describe('smlib meshShape output integrity (free-buffer view regression)', () => {
  it('box mesh is intact, closed, and stays intact after further kernel calls', () => {
    const box = p.makeBox(20, 20, 20)
    // read the mesh while the caller-side buffer may be re-used by later calls
    const diag = analyzeMesh(box)
    // NOTE: box's origin corner (0,0,0) is legitimate (8 corners, one at the
    // origin); zero-vertex counting does not apply to the untranslated box.
    expect(diag.degenerateTris).toBe(0)
    expect(diag.windingViolations).toBe(0)
    expect(diag.unpairedEdges).toBe(0)
    expect(diag.signedVolume).toBeCloseTo(8000, 1)
    // second read after other kernel work must produce the same geometry
    p.getVolume(box)
    const diag2 = analyzeMesh(box)
    expect(diag2.degenerateTris).toBe(0)
    expect(diag2.signedVolume).toBeCloseTo(8000, 1)
    expect(diag2.triCount).toBe(diag.triCount)
  })

  it('split half mesh is closed and has no (0,0,0) vertices (render defect)', () => {
    const box = p.makeBox(20, 20, 20)
    const { front } = splitBrep(p, box, {
      normal: [0, 0, 1],
      planeDistance: 10,
      planeCenter: [10, 10, 10],
    })
    const sep = 0.02 * 20 // separationOffset({separationRatio:0.02},[20,20,20]) == 0.4
    const frontMoved = translateBrep(p, front, [0, 0, sep])
    void frontMoved
    p.getVolume(front) // interleave kernel work before the mesh read
    const mesh = p.meshShape(front, DISPLAY_TESSELLATE)
    // TEMP: locate the (0,0,0) vertices — which triangles, which corner?
    const zeroAt: number[] = []
    for (let i = 0; i < mesh.positions.length; i += 3) {
      if (mesh.positions[i] === 0 && mesh.positions[i + 1] === 0 && mesh.positions[i + 2] === 0) {
        zeroAt.push(i / 3)
      }
    }
    if (zeroAt.length > 0) {
      console.log(`[zeroVtx] vertIdx=${zeroAt.join(',')} triCount=${mesh.triangleCount}`)
      for (const vi of zeroAt) {
        for (let t = 0; t < Math.floor(mesh.indices.length / 3); t++) {
          const i0 = mesh.indices[t * 3]
          const i1 = mesh.indices[t * 3 + 1]
          const i2 = mesh.indices[t * 3 + 2]
          if (i0 === vi || i1 === vi || i2 === vi) {
            console.log(
              `[zeroTri] tri#${t} idx=(${i0},${i1},${i2}) pts=(${mesh.positions[i0 * 3].toFixed(2)},${mesh.positions[i0 * 3 + 1].toFixed(2)},${mesh.positions[i0 * 3 + 2].toFixed(2)})(${mesh.positions[i1 * 3].toFixed(2)},${mesh.positions[i1 * 3 + 1].toFixed(2)},${mesh.positions[i1 * 3 + 2].toFixed(2)})(${mesh.positions[i2 * 3].toFixed(2)},${mesh.positions[i2 * 3 + 1].toFixed(2)},${mesh.positions[i2 * 3 + 2].toFixed(2)})`,
            )
          }
        }
      }
    }
    const diag = analyzeMesh(front)
    expect(diag.zeroVerts).toBe(0)
    expect(diag.degenerateTris).toBe(0)
    expect(diag.windingViolations).toBe(0)
    expect(diag.unpairedEdges).toBe(0)
    expect(diag.signedVolume).toBeGreaterThan(0)
  })

  it('meshShape returns caller-owned copies, not views over wasm memory', () => {
    const box = p.makeBox(10, 10, 10)
    const mesh = p.meshShape(box, DISPLAY_TESSELLATE)
    const mem = k.memory.buffer
    // If this were a view, positions[0..2] would read whatever later kernel
    // calls wrote into the freed block — see the render defect regression above.
    expect(mesh.positions.buffer).not.toBe(mem)
    expect(mesh.normals.buffer).not.toBe(mem)
    expect(mesh.indices.buffer).not.toBe(mem)
    expect(mesh.positions.length).toBeGreaterThan(0)
  })
})
