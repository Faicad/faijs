/**
 * M3.5 — solved-vs-stored comparison (D2/V2).
 *
 * The on-disk coordinates ARE FreeCAD's last solution, so a correct pipeline
 * re-derives (nearly) the same geometry. maxPointDistance is the V2 metric;
 * its tolerance T1 is calibrated from the sample-set distribution, not
 * pre-set (plan §8).
 */
import type { SketchGeom } from './sketch-parse.js';
import type { SolveOutcome } from './sketch-solver.js';

function anchorPoints(g: SketchGeom): { x: number; y: number }[] {
  switch (g.kind) {
    case 'point':
      return [{ x: g.x, y: g.y }];
    case 'line':
      return [{ x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 }];
    case 'circle':
      return [{ x: g.cx, y: g.cy }];
    case 'arc':
      return [{ x: g.cx, y: g.cy }, { x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 }];
    case 'ellipse':
      return [{ x: g.cx, y: g.cy }];
  }
}

/** Maximum anchor-point distance between two geometry lists (same indexing). */
export function maxPointDistance(a: SketchGeom[], b: SketchGeom[]): number {
  let max = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const pa = anchorPoints(a[i]!);
    const pb = anchorPoints(b[i]!);
    const m = Math.min(pa.length, pb.length);
    for (let k = 0; k < m; k++) {
      const d = Math.hypot(pa[k]!.x - pb[k]!.x, pa[k]!.y - pb[k]!.y);
      if (Number.isFinite(d) && d > max) max = d;
    }
  }
  return max;
}

export interface SketchVerdict {
  level: 'L0' | 'L1' | 'L2';
  reason?: string;
  /** max anchor distance between re-solved and stored geometry */
  maxDelta?: number;
}

/**
 * Three-level downgrade (D3). L0 = solved & matches stored (delta <= T1).
 * L1 = solver result kept but flagged, stored coords used instead.
 * L2 = baked (unsupported geometry/constraints, external geometry).
 */
export function classifySketch(
  outcome: SolveOutcome | undefined,
  stored: SketchGeom[],
  t1: number,
  preBlocked?: string,
): SketchVerdict {
  if (preBlocked) return { level: 'L2', reason: preBlocked };
  if (!outcome) return { level: 'L2', reason: 'no-solver-result' };
  if (!outcome.converged) {
    return { level: 'L1', reason: outcome.reason ?? 'solve-failed' };
  }
  const maxDelta = maxPointDistance(outcome.geoms, stored);
  if (maxDelta <= t1) return { level: 'L0', maxDelta };
  return { level: 'L1', reason: 'delta-exceeds-t1', maxDelta };
}
