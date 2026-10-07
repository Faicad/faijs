/**
 * M3.6 — contour extraction: solved sketch geometry → closed loops → 2D
 * contour (R6: pure data, no OCCT dependency; the cad-face wiring that turns
 * contours into Blueprint/extrude inputs happens in M4.6/M5).
 *
 * Extraction: collect endpoints of every non-construction geometry, chain
 * segments sharing endpoints (tolerance-based), keep closed loops.
 */
import type { FcstdSketchGeom } from './fcstd-types.js';
import { bsplineToSegments } from './bspline.js';

/** One segment of a 2D contour: either a straight line or a circular arc (planar, sketch-local coordinates). */
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

/** A chained run of segments; `closed` when the chain's ends meet (R6: pure data, no OCCT dependency). */
export interface Contour {
  /** chained segments in traversal order */
  segments: ContourSeg[];
  /** true when the chain's endpoints meet within JOIN_TOL */
  closed: boolean;
}

const JOIN_TOL = 1e-7;

function segEnds(g: FcstdSketchGeom): [ContourSeg, { x: number; y: number }, { x: number; y: number }] | undefined {
  switch (g.kind) {
    case 'line':
      return [
        { kind: 'line', x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 },
        { x: g.x1, y: g.y1 },
        { x: g.x2, y: g.y2 },
      ];
    case 'arc': {
      // GOTCHA (2026-10-06, G6-2b / HC-SR04 Sketch001): the arc radius/angle
      // fields ALSO differ across the projection boundary — FCStd form
      // (`radius`/`startAngle`/`endAngle`, carries x1/y1/x2/y2) vs canonical
      // form (`r`/`a0`/`a1`+`ccw`, NO endpoint fields). The original code read
      // only the FCStd spelling, so codegen-emitted arcs produced
      // `undefined` endpoints (NaN joins) and the sketch reported
      // E_SKETCHC_NO_CONTOUR although the convert-time loop discriminator
      // (sketch-loop-topology.ts, its own `g.r`/`g.a0` reads) had accepted
      // it. Accept both spellings; compute endpoints from the center/radius/
      // angles when the stored endpoint fields are absent.
      const radius = g.radius ?? (g as { r?: number }).r;
      const startAngle = g.startAngle ?? (g as { a0?: number }).a0;
      const endAngle = g.endAngle ?? (g as { a1?: number }).a1;
      if (radius === undefined || startAngle === undefined || endAngle === undefined) return undefined;
      const x1 = g.x1 ?? g.cx + radius * Math.cos(startAngle);
      const y1 = g.y1 ?? g.cy + radius * Math.sin(startAngle);
      const x2 = g.x2 ?? g.cx + radius * Math.cos(endAngle);
      const y2 = g.y2 ?? g.cy + radius * Math.sin(endAngle);
      return [
        {
          kind: 'arc', cx: g.cx, cy: g.cy, radius,
          startAngle, endAngle, ccw: true,
          x1, y1, x2, y2,
        },
        { x: x1, y: y1 },
        { x: x2, y: y2 },
      ];
    }
    case 'bspline': {
      // P4: flatten the spline into a sampled polyline. Only the FIRST
      // sub-segment is returned here so the pool gets exactly one entry per
      // geometry (no index duplication); extractContours splices the full
      // polyline run in its place (see expandBSpline below).
      const segs = bsplineToSegments({
        poles: g.poles, knots: g.knots, degree: g.degree, periodic: g.periodic,
      });
      const first = segs[0];
      const last = segs[segs.length - 1];
      if (!first || !last) return undefined;
      return [{ kind: 'line', x1: first.x1, y1: first.y1, x2: last.x2, y2: last.y2 }, { x: first.x1, y: first.y1 }, { x: last.x2, y: last.y2 }];
    }
    default:
      return undefined; // circles are closed on their own; points don't join
  }
}

/**
 * Extract closed contours (chains of segments whose endpoints meet).
 * @param geoms solved sketch geometry to chain (non-construction segments only)
 * @returns closed loops plus self-closed circles (open chains are dropped)
 */
export function extractContours(geoms: FcstdSketchGeom[]): Contour[] {
  const pool: { seg: ContourSeg; a: { x: number; y: number }; b: { x: number; y: number }; used: boolean; spline?: { x1: number; y1: number; x2: number; y2: number }[] }[] = [];
  for (const g of geoms) {
    // GOTCHA (2026-09-26): this function's doc comment always promised
    // "non-construction segments only" but nothing filtered them. FreeCAD
    // leaves construction geometry unconstrained, so its coordinates are
    // frequently leftover garbage — a reference line at `StartY = -16508`
    // sitting next to real geometry at y ≈ 1165 (Double glazed window
    // … .FCStd, Sketch095). Left in the pool it contributed two dangling
    // endpoints, and because the DFS marks pool entries `used` as it walks,
    // a construction branch could consume real segments before the actual
    // profile was ever tried — the sketch then had zero loops even though it
    // was solved.
    if (g.construction) continue;
    const s = segEnds(g);
    if (!s) continue;
    // P4: keep the full sampled polyline for splines — after chaining, the
    // winning seg is expanded back into all sub-segments (no interior loss).
    const spline = g.kind === 'bspline'
      ? bsplineToSegments({ poles: g.poles, knots: g.knots, degree: g.degree, periodic: g.periodic })
      : undefined;
    pool.push({ seg: s[0], a: s[1], b: s[2], used: false, spline });
  }

  const near = (p: { x: number; y: number }, q: { x: number; y: number }): boolean =>
    Math.hypot(p.x - q.x, p.y - q.y) <= JOIN_TOL;

  const contours: Contour[] = [];
  for (const start of pool) {
    if (start.used) continue;
    start.used = true;
    const head = start.a;
    // GOTCHA (slittingsaw corpus, 2026-09-20): junction points with free
    // branches (three+ segments sharing an endpoint) defeat first-come
    // chaining — a branch to a dead end consumed the segments and the real
    // loop never closed. DFS with backtracking: try each candidate
    // continuation; the FIRST chain that closes at the head wins; a dead
    // branch returns its segments to the pool. Closure-stop (tap GOTCHA) and
    // pool-restart are both subsumed by the DFS ordering.
    const dfs = (tail: { x: number; y: number }, walk: ContourSeg[]): ContourSeg[] | undefined => {
      if (walk.length > 0 && near(tail, head)) return walk;
      for (const cand of pool) {
        if (cand.used) continue;
        cand.used = true;
        if (near(tail, cand.a)) {
          const r = dfs(cand.b, [...walk, cand.seg]);
          if (r) return r;
        } else if (near(tail, cand.b)) {
          const r = dfs(cand.a, [...walk, reverseSeg(cand.seg)]);
          if (r) return r;
        }
        cand.used = false; // dead branch — return the segment to the pool
      }
      return undefined;
    };
    const solved = dfs(start.b, [start.seg]);
    if (solved && solved.length > 1) {
      // P4: replace spline proxy segs with their full sampled polyline runs.
      // The proxy seg for geometry index i sits in pool order; recover the
      // spline runs by matching the seg reference against pool entries.
      const expanded: ContourSeg[] = [];
      for (const seg of solved) {
        const entry = pool.find((e) => e.seg === seg && e.spline);
        if (entry?.spline) {
          for (const sub of entry.spline) {
            expanded.push({ kind: 'line', x1: sub.x1, y1: sub.y1, x2: sub.x2, y2: sub.y2 });
          }
        } else {
          expanded.push(seg);
        }
      }
      contours.push({ segments: expanded, closed: true });
    }
  }

  // circles are self-closed contours (construction circles excluded: they are
  // reference geometry, not profile holes/outer rings)
  // GOTCHA (2026-10-06, HC-SR04 Sketch008 / G6-1 NO_CONTOUR bucket): the
  // radius field name differs on the two sides of the projection boundary —
  // `radius` on the Fcstd canonical model (project.ts:170) vs `r` on the
  // canonical constraint model (canonical.ts:42). Accept BOTH: a circle
  // stored with the other spelling was silently dropped here (undefined > 0
  // is false) and the sketch reported E_SKETCHC_NO_CONTOUR even though the
  // loop topology discriminator (sketch-loop-topology.ts) accepted it via
  // its own `g.r` check.
  for (const g of geoms) {
    const radius = g.kind === 'circle' ? (g.radius ?? (g as { r?: number }).r) : undefined;
    if (g.kind === 'circle' && radius !== undefined && radius > 0 && !g.construction) {
      contours.push({
        segments: [{
          kind: 'arc', cx: g.cx, cy: g.cy, radius,
          startAngle: 0, endAngle: Math.PI * 2, ccw: true,
          x1: g.cx + radius, y1: g.cy, x2: g.cx + radius, y2: g.cy,
        }],
        closed: true,
      });
    }
  }

  // A6 (2026-09-28 plan): full ellipses were silently DROPPED before — the
  // segEnds default branch returned undefined and nothing else picked them
  // up (the "ellipse loses segments" hard bug). FCStd stores no partial
  // ellipse arcs in Geometry (the canonical FcstdSketchGeom ellipse has no
  // start/end angles), so every ellipse is a closed whole — sampled here as
  // a closed polyline run (64 chords, endpoints exact). Construction
  // ellipses are reference geometry, excluded like construction circles.
  for (const g of geoms) {
    if (g.kind !== 'ellipse' || g.minorRadius <= 0 || g.majorRadius <= 0 || g.construction) continue;
    const segments: ContourSeg[] = [];
    const N = 64;
    const ca = Math.cos(g.angleXU);
    const sa = Math.sin(g.angleXU);
    const pt = (t: number): [number, number] => {
      const px = g.majorRadius * Math.cos(t);
      const py = g.minorRadius * Math.sin(t);
      // rotate by the major-axis angle into sketch coordinates
      return [g.cx + px * ca - py * sa, g.cy + px * sa + py * ca];
    };
    let prev = pt(0);
    for (let i = 1; i <= N; i++) {
      const cur = pt((i / N) * Math.PI * 2);
      segments.push({ kind: 'line', x1: prev[0], y1: prev[1], x2: cur[0], y2: cur[1] });
      prev = cur;
    }
    contours.push({ segments, closed: true });
  }
  return contours;
}

function reverseSeg(s: ContourSeg): ContourSeg {
  if (s.kind === 'line') return { kind: 'line', x1: s.x2, y1: s.y2, x2: s.x1, y2: s.y1 };
  return { ...s, startAngle: s.endAngle, endAngle: s.startAngle, ccw: !s.ccw, x1: s.x2, y1: s.y2, x2: s.x1, y2: s.y1 };
}
