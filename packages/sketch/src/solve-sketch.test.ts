/**
 * solveSketch e2e — five constraint scenarios through the canonical API (§9 step 8).
 *
 * Each scenario projects canonical geometry + constraints through solveSketch,
 * asserting both the solved geometry and the diagnostic status (§5).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { solveSketch } from './solve.js'
import { createNodePlanegcsSolver } from './node.js'
import type { SketchSolver } from './solver.js'

let solver: SketchSolver
beforeAll(async () => {
  solver = await createNodePlanegcsSolver()
})

/** Euclidean length of a line. */
function lineLen(g: { x1: number; y1: number; x2: number; y2: number }): number {
  return Math.hypot(g.x2 - g.x1, g.y2 - g.y1)
}

describe('solveSketch e2e — five constraint scenarios', () => {
  it('horizontal/vertical: rectangle pulled to exact size by H/V + length', async () => {
    const geoms = [
      { tag: 'bottom', kind: 'line' as const, x1: 0, y1: 0, x2: 40, y2: 0 },
      { tag: 'right', kind: 'line' as const, x1: 40, y1: 0, x2: 40, y2: 30 },
      { tag: 'top', kind: 'line' as const, x1: 40, y1: 30, x2: 0, y2: 30 },
      { tag: 'left', kind: 'line' as const, x1: 0, y1: 30, x2: 0, y2: 0 },
    ]
    const constraints = [
      { kind: 'horizontal' as const, of: { tag: 'bottom' } },
      { kind: 'horizontal' as const, of: { tag: 'top' } },
      { kind: 'vertical' as const, of: { tag: 'left' } },
      { kind: 'vertical' as const, of: { tag: 'right' } },
      { kind: 'coincident' as const, a: { tag: 'bottom', at: 'end' as const }, b: { tag: 'right', at: 'start' as const } },
      { kind: 'coincident' as const, a: { tag: 'right', at: 'end' as const }, b: { tag: 'top', at: 'start' as const } },
      { kind: 'coincident' as const, a: { tag: 'top', at: 'end' as const }, b: { tag: 'left', at: 'start' as const } },
      { kind: 'coincident' as const, a: { tag: 'left', at: 'end' as const }, b: { tag: 'bottom', at: 'start' as const } },
      { kind: 'length' as const, of: { tag: 'bottom' }, value: 50 },
      { kind: 'length' as const, of: { tag: 'left' }, value: 40 },
    ]
    const out = await solveSketch(geoms, constraints, { solver })
    expect(out.converged, `reason: ${out.reason}`).toBe(true)
    expect(out.status).toBe('underconstrained')
    const bottom = out.geoms[0] as { x1: number; y1: number; x2: number; y2: number }
    expect(lineLen(bottom)).toBeCloseTo(50, 5)
    const left = out.geoms[3] as { x1: number; y1: number; x2: number; y2: number }
    expect(lineLen(left)).toBeCloseTo(40, 5)
  })

  it('length-driven: single line pulled to exact length', async () => {
    const geoms = [{ tag: 'L', kind: 'line' as const, x1: 0, y1: 0, x2: 3, y2: 4 }]
    const constraints = [
      { kind: 'horizontal' as const, of: { tag: 'L' } },
      { kind: 'length' as const, of: { tag: 'L' }, value: 10 },
    ]
    const out = await solveSketch(geoms, constraints, { solver })
    expect(out.converged, `reason: ${out.reason}`).toBe(true)
    expect(out.status).toBe('underconstrained')
    const L = out.geoms[0] as { x1: number; y1: number; x2: number; y2: number }
    expect(lineLen(L)).toBeCloseTo(10, 5)
  })

  it('underconstrained: free line has remaining DoF', async () => {
    const geoms = [{ tag: 'L', kind: 'line' as const, x1: 0, y1: 0, x2: 5, y2: 0 }]
    const constraints = [{ kind: 'horizontal' as const, of: { tag: 'L' } }]
    const out = await solveSketch(geoms, constraints, { solver })
    expect(out.converged, `reason: ${out.reason}`).toBe(true)
    expect(out.status).toBe('underconstrained')
  })

  it('redundant: duplicate length constraint is dropped', async () => {
    const geoms = [{ tag: 'L', kind: 'line' as const, x1: 0, y1: 0, x2: 5, y2: 0 }]
    const constraints = [
      { kind: 'horizontal' as const, of: { tag: 'L' } },
      { kind: 'length' as const, of: { tag: 'L' }, value: 10 },
      { kind: 'length' as const, of: { tag: 'L' }, value: 10 },
    ]
    const out = await solveSketch(geoms, constraints, { solver })
    expect(out.converged, `reason: ${out.reason}`).toBe(true)
    expect(out.status).toBe('redundant')
    expect(out.droppedConstraints.length).toBeGreaterThan(0)
  })

  it('conflicting: two different lengths on one line → status + resolved details', async () => {
    const geoms = [{ tag: 'L', kind: 'line' as const, x1: 0, y1: 0, x2: 5, y2: 0 }]
    const constraints = [
      { kind: 'horizontal' as const, of: { tag: 'L' } },
      { kind: 'length' as const, of: { tag: 'L' }, value: 10 },
      { kind: 'length' as const, of: { tag: 'L' }, value: 20 },
    ]
    const out = await solveSketch(geoms, constraints, { solver })
    // 2026-09-27裁定: conflicting is a hard error on the script face, but the
    // library-level outcome still reports it (the op boundary throws).
    expect(out.status).toBe('conflicting')
    expect(out.converged, `reason: ${out.reason}`).toBe(false)
    expect(out.conflictDetails?.length ?? 0).toBeGreaterThan(0)
    // readability: refs resolve to the tag, never a bare solver index
    expect(out.conflictDetails!.some((d) => d.kind === 'length' && d.refs.includes('L'))).toBe(true)
  })

  it('ccw:false arc keeps its orientation across the solve (A3 regression class)', async () => {
    // A clockwise arc: start at angle 0, end at angle -90° (a1 < a0). Without the
    // input-ccw carry-through in solveSketch, fromFreeCadGeoms reports ccw:true and the
    // arc would be rebuilt as the long CCW arc through arcToHandles — the A3 regression.
    // The unconstrained solve leaves the arc at its initial geometry, so orientation must round-trip.
    const geoms = [{
      kind: 'arc' as const, cx: 0, cy: 0, r: 5,
      a0: 0, a1: -Math.PI / 2, ccw: false,
      x1: 5, y1: 0, x2: 0, y2: -5,
    }]
    const out = await solveSketch(geoms, [], { solver })
    expect(out.converged, `reason: ${out.reason}`).toBe(true)
    const arc = out.geoms[0] as { kind: 'arc'; ccw: boolean }
    expect(arc.kind).toBe('arc')
    expect(arc.ccw, 'CW arc must round-trip with ccw:false').toBe(false)
    // geometry unchanged (unconstrained → solver returns initial guess); endpoints are
    // recomputed from the signed span, so assert on the canonical arc fields only.
    expect(out.geoms[0]).toMatchObject({ kind: 'arc', cx: 0, cy: 0, r: 5, a0: 0, a1: -Math.PI / 2 })
  })
})