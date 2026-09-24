/**
 * Phase 1 semantic probes — `sectionByPlane` / `splitByPlane` occt-side reachability
 * (plan §2026-09-24-brep-engine-api-narrowing-native-access §3.6 / §3.7).
 *
 * Question under test: can the occt kernel produce the *brepkit plane-cut semantics*
 * (section by an infinite plane / split a solid into two halves) using a planar face
 * as the boolean tool?
 *
 * | # | probe | branch A (reachable) | branch B (not reachable) | measured |
 * |---|---|---|---|---|
 * | 1 | `section(solid, bigPlanarFace)` yields section edges/vertices | A → `sectionByPlane` enters L1 | B → demoted brepkit-only (§3.7) | **A** |
 * | 2 | `split(solid, [bigPlanarFace])` yields two solid halves | A → `splitByPlane` enters L1 | B → demoted brepkit-only (§3.7) | **A** |
 *
 * Both probes run against the real occt-wasm kernel (Node branch, same as
 * evolution-bindings.test.ts). Findings are pinned by positive assertions; if a
 * future kernel version breaks the assumption, these tests go red and the map
 * entries in engine-method-map.json must be re-judged.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm, getKernel } from '../../occt-kernel/occtKernel'
import type { ShapeHandle } from 'occt-wasm'

beforeAll(async () => {
  await initOcctWasm()
})

/** Build a large planar face (tool) covering the solid from a point + normal. */
function makePlanarFaceTool(point: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number }): ShapeHandle {
  const k = getKernel()
  // Plane face built in the XY plane at origin, then translated to `point`.
  // Probe constructs only a +Z normal case; orientation generality is the
  // adapter's concern (probe only pins "planar face tool reaches splitter").
  const face = k.makeFace(k.makeWire([k.makeLineEdge({ x: -50, y: -50, z: 0 }, { x: 50, y: -50, z: 0 }), k.makeLineEdge({ x: 50, y: -50, z: 0 }, { x: 50, y: 50, z: 0 }), k.makeLineEdge({ x: 50, y: 50, z: 0 }, { x: -50, y: 50, z: 0 }), k.makeLineEdge({ x: -50, y: 50, z: 0 }, { x: -50, y: -50, z: 0 })]))
  if (normal.z < 0) {
    // Keep the probe simple: flip face orientation by reversing wire is not
    // needed for the splitter probe; assert the caller passed +Z-ish normal.
    throw new Error('probe helper supports +Z normals only')
  }
  void point
  return k.translate(face, point.x, point.y, point.z)
}

describe('Phase 1 probe: sectionByPlane (planar face as section tool)', () => {
  it('PROBE: section(box, planarFace) yields section geometry (branch A vs B)', () => {
    const k = getKernel()
    const box = k.makeBox(10, 10, 10)
    // Tool: large planar face at z = 5, normal +Z.
    const plane = makePlanarFaceTool({ x: 5, y: 5, z: 5 }, { x: 0, y: 0, z: 1 })
    const sectionResult = k.section(box, plane)
    // Branch A judgement: result is non-null and contains edges (section wire).
    const isNull = k.isNull(sectionResult)
    const edges = isNull ? [] : k.getSubShapes(sectionResult, 'edge')

    console.log('[probe:sectionByPlane]', JSON.stringify({ isNull, edgeCount: edges.length }))
    expect(isNull).toBe(false)
    expect(edges.length).toBeGreaterThan(0)
  })
})

describe('Phase 1 probe: splitByPlane (planar face as split tool)', () => {
  it('PROBE: split(box, [planarFace]) yields two solid halves (branch A vs B)', () => {
    const k = getKernel()
    const box = k.makeBox(10, 10, 10)
    const plane = makePlanarFaceTool({ x: 5, y: 5, z: 5 }, { x: 0, y: 0, z: 1 })
    const splitResult = k.split(box, [plane])
    const isNull = k.isNull(splitResult)
    const solids = isNull ? [] : k.getSubShapes(splitResult, 'solid')

    console.log('[probe:splitByPlane]', JSON.stringify({ isNull, solidCount: solids.length }))
    // Branch A judgement: splitter fragments into (at least) two solids.
    expect(isNull).toBe(false)
    expect(solids.length).toBe(2)
  })
})
