/**
 * H14 regression (Beds, 2026-09-26) — end-to-end geometry guard for the
 * "place sketch sections before lofting" fix.
 *
 * `probe-beds-parts.ts` ran the full Beds model and introspected every output's
 * shapeType / solids / volume: before H14 the four lofts collapsed onto the
 * local XY plane and ThruSections produced degenerate zero-height solids
 * (volume 0); after H14 they became real solids
 * (374354.7 / 1197935.1×2 / 374354.7 mm³).
 *
 * This test captures that conclusion WITHOUT the external Beds artifact: two
 * identical 10×10 sketch profiles, the second rigidly placed at z=250, lofted
 * into a 10×10×250 prism. A correct loft yields a non-degenerate solid whose
 * volume is ≈ 25000 mm³; the H14 bug signature (sections not placed) yields
 * volume 0 / a degenerate face.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { createRuntime } from '../../src/index'
import { createNodePorts } from '../../src/node'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { brepOf } from '../../src/shape'
import type { Shape } from '../../src/mesh/types'

beforeAll(async () => { await initOcctWasm() }, 120000)

// 10×10 square profile in the sketch-local XY plane.
const SQUARE = `{ contours: [{ segments: [
  { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
  { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
  { kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
  { kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 }
], closed: true }] }`

describe('H14: loft of placed (non-coplanar) sketch sections yields a real solid', () => {
  it('placing the second section at z=250 before lofting gives a non-degenerate 10×10×250 prism (volume ≈ 25000)', async () => {
    const runtime = createRuntime(createNodePorts(), 'brep')
    try {
      const result = await runtime.execute(`
        const s0 = cad.profile(${SQUARE})
        const s1raw = cad.profile(${SQUARE})
        const s1 = cad.place(s1raw, { rotation: [0, 0, 0, 1], position: [0, 0, 250] })
        const part0 = cad.loft([s0, s1])
      `, { topology: 'auto' })
      expect(result.failedAt?.message ?? '(none)').toBe('(none)')

      const shape = (result.outputs as Map<string, unknown>).get('part0') as Shape
      const k = getBrepApi()!
      const h = brepOf(shape) as never
      const st = String(k.shapeType(h))
      expect(['solid', 'compound']).toContain(st)
      const vol = Number(k.getVolume(h))
      // H14 bug signature was volume 0 (all sections collapsed onto local XY).
      expect(vol, `loft must be a real solid, got volume ${vol}`).toBeGreaterThan(0)
      // 10×10×250 prism → 25000 mm³ (loose tol guards against OCCT numeric drift).
      expect(vol, `loft volume ${vol} far from expected 25000 prism`).toBeCloseTo(25000, -2)
    } finally {
      runtime.dispose()
    }
  }, 120000)
})
