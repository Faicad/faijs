/**
 * @vitest-environment node
 *
 * smlib-edge-face-adjacency — on the SMLib kernel, face↔edge adjacency and edge
 * naming lineage must both hold.
 *
 * Reproduced defect (2026-11-21, from mweb):
 *   box → fillet → pick one edge → preview
 *   → `TopoRefError: edge naming has no adjacent-face lineage (mesh limitation)`
 *
 * Cause chain:
 *   1. `buildAssemblySelectorManifest` builds a hash table with
 *      `kernel.hashCode(edge)` and disambiguates with `isSame`, mapping "the edge
 *      handle inside a face's loop" back to "the solid's edge ordinal";
 *   2. the SMLib adapter recorded a borrowed sub-shape's deterministic hash as
 *      `(owner, index)`. The same edge is the i-th edge of a `face → edge`
 *      enumeration *and* the j-th edge of the `solid → edge` enumeration; the
 *      handles are identical, the writes raced, and the last one won — so
 *      `hashCode(faceEdge) ≠ hashCode(solidEdge)`;
 *   3. `findOrdinal` missed at the hash gate → every face had `edgeCount = 0` and
 *      every edge had `faceCount = 0`;
 *   4. `edgeFaceOrdinalsOf` yields null for any edge with `faceCount < 2` → every
 *      `EdgeNaming` row had `faces: null`, plus `origin/role: null` →
 *      `captureTopoRef` threw `E_TOPO_NOT_FOUND`, so no `EdgeTopoRef` could be
 *      built from a picked edge at all.
 *
 * This file pins the invariants at the geometry/naming layer (no UI, no web):
 *   A. box: 6 faces × 4 edges, 12 edges × 2 adjacent faces (`edgeFaceRows` = 24);
 *   B. box: every `EdgeNaming` row carries `faces` (two distinct faces) and
 *      `origin/role`, and `captureTopoRef` yields a `kind:'edge'` reference;
 *   C. cylinder: non-seam edges carry lineage too, and the lateral face keeps its
 *      identity even though SMLib reports its surface type as `'cone'`.
 *
 * Run: npx vitest run packages/core/test/topology/naming/smlib-edge-face-adjacency.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../../src/cad-runtime/runtime'
import type { HostPorts } from '../../../src/cad-runtime/ports'
import { asPartName } from '../../../src/identity'
import { __resetEngineRegistriesForTests, getActiveBrepEngineId } from '../../../src/brep/engine/registry'
import { registerSmlibBrepEngine, SMLIB_BREP_ENGINE_ID } from '../../../src/brep/engine/adapters/smlib'
import { captureTopoRef } from '../../../src/topology/naming/capture-topo-ref'
import type { PartNaming } from '../../../src/topology/naming/types'
import type { SelectorRuntimeData } from '../../../src/topology/build-selector-runtime'
import { createApiNamespaceWithEditorOps } from '../../support/editor-ops'

function hostPorts(): HostPorts {
  return { events: { emit: () => undefined }, hostEnv: 'node' } as HostPorts
}

/** Execute a script and return the naming + topology of the requested part. */
async function run(code: string, part: string): Promise<{ naming: PartNaming; topology: SelectorRuntimeData }> {
  __resetEngineRegistriesForTests()
  await registerSmlibBrepEngine()
  expect(getActiveBrepEngineId()).toBe(SMLIB_BREP_ENGINE_ID)
  const runtime = new CadRuntime(hostPorts(), 'brep', { cad: createApiNamespaceWithEditorOps() })
  const result: ExecutionResult = await runtime.execute(code)
  expect(result.failedAt, `execution failed: ${result.failedAt?.callee} ${result.failedAt?.message}`).toBeUndefined()
  const naming = result.naming?.get(asPartName(part))
  const topology = result.topology?.get(asPartName(part))?.data
  expect(naming, `${part} has no naming data`).toBeTruthy()
  expect(topology, `${part} has no topology data`).toBeTruthy()
  return { naming: naming!, topology: topology! }
}

describe('SMLib: face↔edge adjacency and edge naming lineage', () => {
  let box: { naming: PartNaming; topology: SelectorRuntimeData }

  beforeAll(async () => {
    box = await run(
      ['let part0 = cad.box({ width: 40, depth: 30, height: 20 })', 'part0.keep()'].join('\n'),
      'part0',
    )
  }, 180_000)

  it('A1 box: each face lists its 4 edges', () => {
    const faces = box.topology.faces
    expect(faces.length).toBe(6)
    for (const f of faces) {
      expect(f.edgeCount, 'face → edge adjacency is empty (hashCode not rooted at the solid ordinal)').toBe(4)
    }
  })

  it('A2 box: each edge lists its 2 adjacent faces', () => {
    const edges = box.topology.edges
    expect(edges.length).toBe(12)
    for (const e of edges) {
      expect(e.faceCount, 'edge → face adjacency is empty (hashCode not rooted at the solid ordinal)').toBe(2)
    }
    const rows = box.topology.proxy.edgeFaceRows
    expect(rows, 'edgeFaceRows missing').toBeTruthy()
    expect(Array.from(rows as ArrayLike<number>).length).toBe(24)
  })

  it('B1 box: every edge naming row has two distinct adjacent faces, each with origin/role', () => {
    expect(box.naming.edgeNaming.length).toBe(12)
    for (const [i, row] of box.naming.edgeNaming.entries()) {
      expect(row.faces, `edge row ${i} has no adjacent-face lineage (faces=null)`).not.toBeNull()
      const pair = row.faces!
      expect(pair[0]).not.toEqual(pair[1])
      for (const side of pair) {
        expect(side.origin, `edge row ${i} has an adjacent face with no origin`).toBeTruthy()
        expect(side.role, `edge row ${i} has an adjacent face with no role`).toBeTruthy()
      }
    }
  })

  it('B2 box: captureTopoRef(edge row) yields a usable EdgeTopoRef (the exact user-facing break)', () => {
    for (const [i, row] of box.naming.edgeNaming.entries()) {
      const ref = captureTopoRef(row)
      expect(ref.kind, `edge row ${i} cannot be captured as an edge reference`).toBe('edge')
    }
  })

  it('C1 cylinder: non-seam edges carry lineage too, and the lateral face keeps its identity', async () => {
    const cyl = await run(
      ['let part0 = cad.cylinder({ radius: 8, height: 30 })', 'part0.keep()'].join('\n'),
      'part0',
    )
    const withLineage = cyl.naming.edgeNaming.filter((r) => r.faces !== null)
    expect(withLineage.length, 'cylinder has no edge with lineage → edge tools unusable').toBeGreaterThan(0)
    for (const row of withLineage) {
      expect(captureTopoRef(row).kind).toBe('edge')
    }
    // The lateral face must keep its identity even though SMLib models a cylinder's
    // lateral surface as a cone with equal radii and reports surfaceType 'cone'.
    // Role assignment therefore keys on the op semantics (anything that is not an
    // end cap is the lateral face), never on the kernel's surface-type wording.
    expect(cyl.naming.faceNaming.length).toBe(3)
    const lateral = cyl.naming.faceNaming.filter((r) => r.role === 'lateral')
    expect(lateral.length, 'cylinder lateral face lost its role → face identity lost').toBe(1)
    expect(lateral[0]!.origin).not.toBeNull()
  })
})
