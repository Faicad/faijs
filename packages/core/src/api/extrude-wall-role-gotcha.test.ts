/**
 * GOTCHA (A2, Beds.FCStd, 2026-09-26): `cad.extrude` must name EVERY side face
 * of the prism `wall:<i>` — including the CYLINDRICAL ones an arc segment sweeps
 * out — and the extrusion axis must be the direction the op actually extruded
 * along.
 *
 * Two defects, both invisible on a plain square profile:
 *
 * 1. The side/wall test used to read the face normal only when
 *    `surfaceType === 'plane'`, so an arc-derived cylindrical side face had no
 *    normal, got no `wall:<i>`, and — worse — was SKIPPED by `wallIdx`, so the
 *    wall numbering no longer matched the profile edge order that
 *    `role-name.ts` promises ("wall:3 = the face swept from profile edge 3").
 *    Beds part28 (4 arcs): 10 faces, only 6 named (2/4/6/8 uncovered) → its
 *    fillet's `cad.edgeRef` threw
 *    `edgeRef: adjacent face ordinal 2 has no role lineage`.
 *
 * 2. The axis was "the first anti-parallel pair of planar normals". A
 *    rectangular prism has THREE such pairs (the two caps plus two pairs of
 *    opposite side walls), and the caps are not necessarily enumerated first —
 *    in Beds the X-facing side walls were found first, so `top`/`bottom` were
 *    assigned to side walls and the real caps were numbered `wall:N`.
 *    The axis is now hinted by the op's own extrusion direction and confirmed
 *    by geometry (≥2 face normals parallel to it).
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { createRuntime } from '../index'
import { createNodePorts } from '../node'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf } from '../shape'
import type { Shape } from '../mesh/types'
import { HASH_UPPER_BOUND } from '../brep/face-evolution'
import { runtimeLineage } from '../topology/naming/lineage'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

/** Square 10×10 with all four corners rounded by r=1 arcs: 4 lines + 4 arcs. */
const ROUNDED_SQUARE = `{ contours: [{ segments: [
  { kind: 'line', x1: 1, y1: 0, x2: 9, y2: 0 },
  { kind: 'arc', cx: 9, cy: 1, radius: 1, startAngle: -1.5707963267948966, endAngle: 0, ccw: true, x1: 9, y1: 0, x2: 10, y2: 1 },
  { kind: 'line', x1: 10, y1: 1, x2: 10, y2: 9 },
  { kind: 'arc', cx: 9, cy: 9, radius: 1, startAngle: 0, endAngle: 1.5707963267948966, ccw: true, x1: 10, y1: 9, x2: 9, y2: 10 },
  { kind: 'line', x1: 9, y1: 10, x2: 1, y2: 10 },
  { kind: 'arc', cx: 1, cy: 9, radius: 1, startAngle: 1.5707963267948966, endAngle: 3.141592653589793, ccw: true, x1: 1, y1: 10, x2: 0, y2: 9 },
  { kind: 'line', x1: 0, y1: 9, x2: 0, y2: 1 },
  { kind: 'arc', cx: 1, cy: 1, radius: 1, startAngle: 3.141592653589793, endAngle: 4.71238898038469, ccw: true, x1: 0, y1: 1, x2: 1, y2: 0 }
], closed: true }] }`

/** Plain square profile (the pre-A2 behaviour was already "covered" here — but wrong). */
const SQUARE = `{ contours: [{ segments: [
  { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
  { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
  { kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
  { kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 }
], closed: true }] }`

/** role → face hashes, merged over every origin in the part's role table. */
function rolesOf(part: string): Map<string, number[]> {
  const table = runtimeLineage.tableOfPart(part as never)
  expect(table, `${part} has no role table`).toBeDefined()
  const roles = new Map<string, number[]>()
  for (const m of table!.values()) for (const [role, hashes] of m) roles.set(role, [...hashes])
  return roles
}

describe('GOTCHA: extrude must name curved side faces and use the extruded axis', () => {
  it('names every face of an arc-containing profile (wall:<i> covers cylinders)', async () => {
    const runtime = createRuntime(createNodePorts(), 'brep')
    try {
      const result = await runtime.execute(`
        const part0 = cad.sketch(${ROUNDED_SQUARE})
        const part1 = cad.extrude(part0, [0, 0, 5])
      `, { topology: 'auto' })
      expect(result.failedAt?.message ?? '(none)').toBe('(none)')

      const shape = (result.outputs as Map<string, unknown>).get('part1') as Shape
      const kernel = getBrepApi()!
      const hashes = Array.from(kernel.subShapeHashes(brepOf(shape) as never, 'face', HASH_UPPER_BOUND))
      const roles = rolesOf('part1')
      const covered = new Set([...roles.values()].flat())

      // 2 caps + 8 side faces (4 planar walls + 4 cylindrical corner walls).
      expect(hashes.length).toBe(10)
      expect([...roles.keys()].sort()).toEqual(
        ['bottom', 'top', 'wall:0', 'wall:1', 'wall:2', 'wall:3', 'wall:4', 'wall:5', 'wall:6', 'wall:7'].sort(),
      )
      expect(hashes.filter((h) => !covered.has(h)).length, 'every face must have a role').toBe(0)
    } finally {
      runtime.dispose()
    }
  }, 120000)

  it('assigns top/bottom to the faces perpendicular to the extrusion axis, not to side walls', async () => {
    const runtime = createRuntime(createNodePorts(), 'brep')
    try {
      const result = await runtime.execute(`
        const part0 = cad.sketch(${SQUARE})
        const part1 = cad.extrude(part0, [0, 0, 5])
      `, { topology: 'auto' })
      expect(result.failedAt?.message ?? '(none)').toBe('(none)')

      const shape = (result.outputs as Map<string, unknown>).get('part1') as Shape
      const kernel = getBrepApi()!
      const solid = brepOf(shape) as never
      const faceHandles = kernel.getSubShapes(solid, 'face')
      const hashes = Array.from(kernel.subShapeHashes(solid, 'face', HASH_UPPER_BOUND))
      const roles = rolesOf('part1')

      const hashOfFaceWithNormal = (want: readonly [number, number, number]): number | undefined => {
        for (let i = 0; i < faceHandles.length; i++) {
          const uv = kernel.uvBounds(faceHandles[i]!)
          const n = kernel.surfaceNormal(faceHandles[i]!, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2)
          const len = Math.hypot(n.x, n.y, n.z) || 1
          const dot = (n.x * want[0] + n.y * want[1] + n.z * want[2]) / len
          if (dot > 0.999) return hashes[i]
        }
        return undefined
      }
      // GOTCHA: before the fix the axis came from the first anti-parallel planar
      // pair, which for a box-like prism can be a pair of OPPOSITE SIDE WALLS —
      // `top`/`bottom` then landed on side walls and the caps became wall:N.
      expect(roles.get('top')).toEqual([hashOfFaceWithNormal([0, 0, 1])])
      expect(roles.get('bottom')).toEqual([hashOfFaceWithNormal([0, 0, -1])])
      expect(roles.get('wall:0')).not.toEqual(roles.get('top'))
    } finally {
      runtime.dispose()
    }
  }, 120000)
})
