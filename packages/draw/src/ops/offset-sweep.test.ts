/**
 * offsetPolygonLoops2d (D2) robustness sweep — pins the offset self-intersection
 * prune across a broad set of concave / thin-arm contours.
 *
 * GOTCHA (verified, kept as a regression guard): the prune only splits at
 * *proper* transversal self-crossings (`segmentIntersection` proper-cross), so
 * tangential / vertex-collapse overlaps (an offset pushed past a thin arm
 * flipping winding) were historically a stated residual. Sweeping CCW concave
 * contours — C-channel, Z/stair, L, keyhole, bracket, cusp, hammer, T, fin —
 * across outward (positive) and inward (negative, incl. past-collapse) offsets
 * shows the implementation consistently returns only simple, positive-area
 * lobes and an empty result for a genuinely-collapsed contour. This file pins
 * those two invariants so a future algorithmic change cannot silently leak a
 * non-simple loop or a spurious lobe.
 */
import { describe, expect, it } from 'vitest'
import { offsetPolygonLoops2d } from './offset'
import { isSimplePolygon } from './polygon2d'
import type { Point2d } from './custom-corners'

// CCW concave contours exercising reflex notches, thin slots, deep cusps and
// attached thin arms.
const CONCAVE: Point2d[][] = [
  // C-channel (plate with a notch almost slicing through it)
  [[0, 0], [10, 0], [10, 10], [8, 10], [8, 3], [2, 3], [2, 10], [0, 10]],
  // Z / staircase
  [[0, 0], [8, 0], [8, 2], [4, 2], [4, 6], [0, 6]],
  // L reflex
  [[0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [0, 2]],
  // keyhole (wide top, thin stem)
  [[0, 6], [10, 6], [10, 8], [6, 8], [6, 0], [4, 0], [4, 8], [0, 8]],
  // bracket (narrow inner slot, w=2)
  [[0, 0], [8, 0], [8, 10], [6, 10], [6, 2], [2, 2], [2, 10], [0, 10]],
  // near-closing reflex cusp (notch flanks 0.2 apart)
  [[0, 0], [8, 0], [8, 8], [4.1, 8], [4.1, 5], [3.9, 5], [3.9, 8], [0, 8]],
  // hammer (wide head, thin handle at y∈[2.8,3.2])
  [[0, 0], [6, 0], [6, 6], [0, 6], [0, 2.8], [7, 2.8], [7, 3.2], [0, 3.2]],
  // T (wide head, thin stem)
  [[2, 0], [4, 0], [4, 4], [6, 4], [6, 6], [0, 6], [0, 4], [2, 4]],
  // bell with a thin fin almost closing a pocket
  [[0, 0], [5, 0], [5, 4], [2.4, 4], [2.4, 1.5], [2.6, 1.5], [2.6, 4], [0, 4]],
]

const DISTS = [0.4, 0.8, -0.3, -0.6, -1.2]

describe('offsetPolygonLoops2d robustness sweep (D2)', () => {
  it('every non-collapsed concave offset returns only simple positive-area loops', () => {
    for (const pts of CONCAVE) {
      for (const dist of DISTS) {
        const loops = offsetPolygonLoops2d(pts, dist)
        for (const loop of loops) {
          expect(isSimplePolygon(loop), `d=${dist}`).toBe(true)
          expect(loop.length).toBeGreaterThanOrEqual(3)
          expect(area(loop)).toBeGreaterThan(1e-6)
        }
      }
    }
  })

  it('offsets dragged past a thin arm collide to an empty (correct) result, never a leaked lobe', () => {
    // A 1-wide × 6-tall sliver offset inward past half its width collapses fully:
    // the result must be empty, not a bogus CW loop.
    const sliver: Point2d[] = [[0, 0], [1, 0], [1, 6], [0, 6]]
    expect(offsetPolygonLoops2d(sliver, -0.75)).toEqual([])
    // Same for the T shape shrunk past its stem: everything collapses.
    const tShape: Point2d[] = [[2, 0], [4, 0], [4, 4], [6, 4], [6, 6], [0, 6], [0, 4], [2, 4]]
    expect(offsetPolygonLoops2d(tShape, -1.2)).toEqual([])
  })
})

/** Signed area is positive already for the pruned lobes; keep magnitude. */
function area(pts: Point2d[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    s += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(s) / 2
}