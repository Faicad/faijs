/**
 * M3.6/M3.7 tests — contour extraction from solved geometry and the
 * three-level downgrade ledger entry (D3).
 */
import { describe, it, expect } from 'vitest';
import { extractContours } from './contour.js';
import { classifySketch } from './sketch-verify.js';
import type { SketchGeom } from './sketch-parse.js';

describe('contour extraction (M3.6)', () => {
  it('chains a rectangle from 4 line segments into one closed contour', () => {
    const geoms: SketchGeom[] = [
      { kind: 'line', index: 0, x1: 0, y1: 0, x2: 10, y2: 0 },
      { kind: 'line', index: 1, x1: 10, y1: 0, x2: 10, y2: 5 },
      { kind: 'line', index: 2, x1: 10, y1: 5, x2: 0, y2: 5 },
      { kind: 'line', index: 3, x1: 0, y1: 5, x2: 0, y2: 0 },
    ];
    const contours = extractContours(geoms);
    expect(contours.length).toBe(1);
    expect(contours[0]!.closed).toBe(true);
    expect(contours[0]!.segments.length).toBe(4);
  });

  it('yields one self-closed contour per circle', () => {
    const geoms: SketchGeom[] = [{ kind: 'circle', index: 0, cx: 1, cy: 2, radius: 3 }];
    const contours = extractContours(geoms);
    expect(contours.length).toBe(1);
    expect(contours[0]!.segments[0]!.kind).toBe('arc');
  });

  it('leaves open chains out of the contour set', () => {
    const geoms: SketchGeom[] = [
      { kind: 'line', index: 0, x1: 0, y1: 0, x2: 10, y2: 0 },
      { kind: 'line', index: 1, x1: 10, y1: 0, x2: 10, y2: 5 },
    ];
    expect(extractContours(geoms).length).toBe(0);
  });

  it('chains a line+arc contour regardless of segment order', () => {
    const geoms: SketchGeom[] = [
      // arc from (10,0) to (0,0), semicircle over the line
      { kind: 'arc', index: 0, cx: 5, cy: 0, radius: 5, startAngle: 0, endAngle: Math.PI, x1: 10, y1: 0, x2: 0, y2: 0 },
      { kind: 'line', index: 1, x1: 0, y1: 0, x2: 10, y2: 0 },
    ];
    const contours = extractContours(geoms);
    expect(contours.length).toBe(1);
    expect(contours[0]!.closed).toBe(true);
  });
});

describe('three-level downgrade (M3.7, D3)', () => {
  it('classifies solved+matching as L0', () => {
    const v = classifySketch({ geoms: [], converged: true, problemConstraints: [], droppedConstraints: [] }, [], 1e-6);
    expect(v.level).toBe('L0');
  });
  it('classifies divergence as L1 with reason', () => {
    const stored: SketchGeom[] = [{ kind: 'line', index: 0, x1: 0, y1: 0, x2: 10, y2: 0 }];
    const solved: SketchGeom[] = [{ kind: 'line', index: 0, x1: 0, y1: 0, x2: 50, y2: 0 }];
    const v = classifySketch({ geoms: solved, converged: true, problemConstraints: [], droppedConstraints: [] }, stored, 1e-6);
    expect(v.level).toBe('L1');
    expect(v.reason).toBe('delta-exceeds-t1');
  });
});
