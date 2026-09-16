/**
 * M3.6 — contour extraction: solved sketch geometry → closed loops → 2D
 * contour (R6: pure data, no OCCT dependency; the cad-face wiring that turns
 * contours into Blueprint/extrude inputs happens in M4.6/M5).
 *
 * Extraction: collect endpoints of every non-construction geometry, chain
 * segments sharing endpoints (tolerance-based), keep closed loops.
 */
import type { SketchGeom } from './sketch-parse.js';

export type ContourSeg =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | {
      kind: 'arc';
      cx: number;
      cy: number;
      radius: number;
      startAngle: number;
      endAngle: number;
      ccw: boolean;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    };

export interface Contour {
  segments: ContourSeg[];
  closed: boolean;
}

const JOIN_TOL = 1e-7;

function segEnds(g: SketchGeom): [ContourSeg, { x: number; y: number }, { x: number; y: number }] | undefined {
  switch (g.kind) {
    case 'line':
      return [
        { kind: 'line', x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 },
        { x: g.x1, y: g.y1 },
        { x: g.x2, y: g.y2 },
      ];
    case 'arc':
      return [
        {
          kind: 'arc', cx: g.cx, cy: g.cy, radius: g.radius,
          startAngle: g.startAngle, endAngle: g.endAngle, ccw: true,
          x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2,
        },
        { x: g.x1, y: g.y1 },
        { x: g.x2, y: g.y2 },
      ];
    default:
      return undefined; // circles are closed on their own; points don't join
  }
}

/** Extract closed contours (chains of segments whose endpoints meet). */
export function extractContours(geoms: SketchGeom[]): Contour[] {
  const pool: { seg: ContourSeg; a: { x: number; y: number }; b: { x: number; y: number }; used: boolean }[] = [];
  for (const g of geoms) {
    const s = segEnds(g);
    if (s) pool.push({ seg: s[0], a: s[1], b: s[2], used: false });
  }

  const near = (p: { x: number; y: number }, q: { x: number; y: number }): boolean =>
    Math.hypot(p.x - q.x, p.y - q.y) <= JOIN_TOL;

  const contours: Contour[] = [];
  for (const start of pool) {
    if (start.used) continue;
    start.used = true;
    const segments: ContourSeg[] = [start.seg];
    let tail = start.b;
    const head = start.a;
    let extended = true;
    while (extended) {
      extended = false;
      for (const cand of pool) {
        if (cand.used) continue;
        if (near(tail, cand.a)) {
          cand.used = true;
          segments.push(cand.seg);
          tail = cand.b;
          extended = true;
        } else if (near(tail, cand.b)) {
          cand.used = true;
          segments.push(reverseSeg(cand.seg));
          tail = cand.a;
          extended = true;
        }
      }
    }
    const closed = near(tail, head);
    if (segments.length > 0 && closed) {
      contours.push({ segments, closed: true });
    }
  }

  // circles are self-closed contours
  for (const g of geoms) {
    if (g.kind === 'circle' && g.radius > 0) {
      contours.push({
        segments: [{
          kind: 'arc', cx: g.cx, cy: g.cy, radius: g.radius,
          startAngle: 0, endAngle: Math.PI * 2, ccw: true,
          x1: g.cx + g.radius, y1: g.cy, x2: g.cx + g.radius, y2: g.cy,
        }],
        closed: true,
      });
    }
  }
  return contours;
}

function reverseSeg(s: ContourSeg): ContourSeg {
  if (s.kind === 'line') return { kind: 'line', x1: s.x2, y1: s.y2, x2: s.x1, y2: s.y1 };
  return { ...s, startAngle: s.endAngle, endAngle: s.startAngle, ccw: !s.ccw, x1: s.x2, y1: s.y2, x2: s.x1, y2: s.y1 };
}
