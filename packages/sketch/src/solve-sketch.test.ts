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

  it('conflicting: two different lengths on one line', async () => {
    const geoms = [{ tag: 'L', kind: 'line' as const, x1: 0, y1: 0, x2: 5, y2: 0 }]
    const constraints = [
      { kind: 'horizontal' as const, of: { tag: 'L' } },
      { kind: 'length' as const, of: { tag: 'L' }, value: 10 },
      { kind: 'length' as const, of: { tag: 'L' }, value: 20 },
    ]
    const out = await solveSketch(geoms, constraints, { solver })
    expect(out.status === 'conflicting' || out.status === 'redundant').toBe(true)
    expect(out.problemConstraints.length).toBeGreaterThan(0)
  })
})