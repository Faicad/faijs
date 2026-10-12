/**
 * step-edge-2d probe tests — plan 2026-10-12-step-export-edge-2d.md §3.3.
 *
 * P1: what STEP entities does XCAF write for an edge compound?
 * P2: can the result be read back / compared by topology counts?
 * P3: does the free lower-level top-up (free-face fix) also cover free edges
 *     in a mixed compound (solid + free edges)?
 *
 * Probe conclusions are frozen here as permanent assertions (repo rule:
 * verified negative conclusions must stay as tests).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initOcctWasm, getKernel, disposeOcctWasm } from '../../../src/occt-kernel/occtKernel'
import { importAssemblyFromStep, releaseAssemblyTree } from '../../../src/occt-kernel/occtKernel'
import type { OcctKernel } from 'occt-wasm'
import type { BrepHandle } from '../../../src/brep/engine/types'
import type { BrepEngineApi } from '../../../src/brep/engine/primitives'
import { exportStepFromSolids } from '../../../src/brep/export/step'

let kernel: BrepEngineApi

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel() as unknown as BrepEngineApi
}, 120000)

afterAll(() => {
  disposeOcctWasm()
})

function decodeStep(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(new Uint8Array(buffer))
}

/** The 4 top edges of a unit-ish box (mirrors cadquery `edges('>Z')` on box(3,2,1)). */
function topEdgesOfBox(): { box: BrepHandle; edges: BrepHandle[] } {
  const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 3, y: 2, z: 1 })
  const corners = [
    { x: 0, y: 0, z: 1 }, { x: 3, y: 0, z: 1 },
    { x: 3, y: 2, z: 1 }, { x: 0, y: 2, z: 1 },
  ]
  const edges: BrepHandle[] = []
  for (let i = 0; i < 4; i++) {
    edges.push(kernel.makeLineEdge(corners[i], corners[(i + 1) % 4]))
  }
  return { box, edges }
}

describe('STEP edge-2d export probes (plan 2026-10-12)', () => {
  it('P1: edge compound export — which STEP entities does XCAF write?', async () => {
    const { box, edges } = topEdgesOfBox()
    const compound = kernel.makeCompound(edges)
    try {
      const buffer = exportStepFromSolids(kernel, [{ solid: compound, name: 'edges4' }])
      const text = decodeStep(buffer)
      // P1 findings (frozen): record which entity types appear.
      const counts = {
        geometricCurveSet: (text.match(/GEOMETRIC_CURVE_SET/g) ?? []).length,
        edgeBasedWireframeModel: (text.match(/EDGE_BASED_WIREFRAME_MODEL/g) ?? []).length,
        edgeCurve: (text.match(/EDGE_CURVE/g) ?? []).length,
        advancedFace: (text.match(/ADVANCED_FACE/g) ?? []).length,
        manifoldSolidBrep: (text.match(/MANIFOLD_SOLID_BREP/g) ?? []).length,
        shellBasedSurfaceModel: (text.match(/SHELL_BASED_SURFACE_MODEL/g) ?? []).length,
      }
      console.log('[P1] edge compound STEP entity counts:', JSON.stringify(counts))
      // Frozen assertions — refined after first run.
      expect(counts.manifoldSolidBrep).toBe(0)
      expect(counts.advancedFace).toBe(0)
    } finally {
      kernel.release(box)
      for (const e of edges) kernel.release(e)
      kernel.release(compound)
    }
  })

  it('P2: edge compound STEP round-trips through importAssemblyFromStep', async () => {
    const { box, edges } = topEdgesOfBox()
    const compound = kernel.makeCompound(edges)
    try {
      const buffer = exportStepFromSolids(kernel, [{ solid: compound, name: 'edges4' }])
      const nodes = await importAssemblyFromStep(buffer)
      try {
        const flat: { name: string }[] = []
        const walk = (ns: typeof nodes): void => {
          for (const n of ns) {
            if (n.isAssembly) walk(n.children)
            else flat.push({ name: n.name })
          }
        }
        walk(nodes)
        console.log('[P2] readback leaves:', JSON.stringify(flat))
        // Frozen (P2): cascade picks the edge level, flattens N edges into N
        // labels under the `name [n]` convention — identity loop holds for
        // 2D-only files, with one leaf per edge.
        expect(flat).toEqual([
          { name: 'edges4 [1]' },
          { name: 'edges4 [2]' },
          { name: 'edges4 [3]' },
          { name: 'edges4 [4]' },
        ])
      } finally {
        releaseAssemblyTree(kernel as unknown as OcctKernel, nodes)
      }
    } finally {
      kernel.release(box)
      for (const e of edges) kernel.release(e)
      kernel.release(compound)
    }
  })

  it('P3: mixed compound (solid + free edges) — free edges must also be written', async () => {
    const { box, edges } = topEdgesOfBox()
    // box is one of the 4 top edges' owner; build a compound holding the box
    // plus a FREE edge floating above it (not part of the box).
    const freeEdge = kernel.makeLineEdge({ x: 10, y: 10, z: 10 }, { x: 13, y: 10, z: 10 })
    const mixed = kernel.makeCompound([box, freeEdge])
    try {
      const buffer = exportStepFromSolids(kernel, [{ solid: mixed, name: 'mixed' }])
      const text = decodeStep(buffer)
      const counts = {
        manifoldSolidBrep: (text.match(/MANIFOLD_SOLID_BREP/g) ?? []).length,
        advancedFace: (text.match(/ADVANCED_FACE/g) ?? []).length,
        edgeCurve: (text.match(/EDGE_CURVE/g) ?? []).length,
        geometricCurveSet: (text.match(/GEOMETRIC_CURVE_SET/g) ?? []).length,
      }
      console.log('[P3] mixed compound STEP entity counts:', JSON.stringify(counts))
      // The solid itself is written, and the free edge must not be dropped
      // (frozen P3): the solid appears as MANIFOLD_SOLID_BREP, the free edge
      // as its own GEOMETRIC_CURVE_SET label (same form as P1).
      expect(counts.manifoldSolidBrep).toBe(1)
      expect(counts.geometricCurveSet).toBe(1)
    } finally {
      kernel.release(box)
      for (const e of edges) kernel.release(e)
      kernel.release(freeEdge)
      kernel.release(mixed)
    }
  })
})
