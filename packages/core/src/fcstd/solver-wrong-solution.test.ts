/**
 * GOTCHA regression tests — solver wrong-solution fixes for the 3 L1 sketches.
 *
 * Discoveries from probes (kept as repeatable scripts):
 * - packages/core/scripts/probe-l1-diagnose.ts  (per-case delta + moved geoms)
 * - packages/core/scripts/probe-l1-ablation.ts  (per-constraint ablation)
 * - packages/core/scripts/probe-sym-min.ts      (minimal p2p_symmetric_ppp repro)
 *
 * GOTCHAs locked here:
 * G-A: planegcs `p2p_symmetric_ppp` parameter is `p_id`, NOT `p3_id` — pushing
 *      `p3_id` throws inside push_primitive and the constraint silently lands
 *      in droppedConstraints (appeared as taperedballnose dropped=[5]).
 * G-B: FreeCAD Angle constraints have 4 shapes (Sketch.cpp case Angle):
 *      Third!=GeoUndef → via-point; SecondPos!=none → l2l_angle_pppp (pos=end
 *      swaps that line's point pair); both pos none → l2l_angle_ll; only
 *      First → p2p_angle (orientation). Only shape ③ was mapped before; the
 *      others were silently skipped.
 * G-C: refs carry Third = -2000 (GeoUndef sentinel) which must be filtered
 *      before shape dispatch.
 * G-D: HAxis/VAxis (geoId -1/-2) are real Line entries in FreeCAD Geoms.
 *      Constraints reference their EDGE (pos=0) and their POINTS (pos=1/2):
 *      DistanceX(p, VAxis-edge) is an ABSOLUTE x (coordinate_x, Sketch.cpp:2053
 *      "point on fixed x-coordinate"), NOT difference vs the axis point —
 *      mapping it as difference forced x = -value (delta 2.3e1 collapse).
 * G-E: Distance(p, axis-edge) is a point-to-LINE distance (|y| or |x|), not
 *      p2p_distance to the root point (which drags the point onto a circle
 *      around the origin).
 */
import { describe, it, expect } from 'vitest';
import { parseSketchObject, ConstraintType, PointPos } from './sketch-parse.js';
import { createPlanegcsSolver } from './planegcs-backend.js';
import { maxPointDistance } from './sketch-verify.js';
import type { FcstdProperty } from './document.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const T1 = 1e-6;

/** Build a two-point line SketchGeom pair for synthetic sketches. */
function lineProps(x1: number, y1: number, x2: number, y2: number): FcstdProperty {
  // minimal synthetic property shaped like parseGeometryList expects
  return {
    name: 'Geometry',
    type: 'App::PropertyGeometryList',
    value: '',
    children: [
      {
        name: 'GeometryList',
        children: [
          {
            name: 'Geometry',
            attrs: { type: 'Part::GeomLineSegment' },
            children: [
              { name: 'X1', attrs: {}, children: [], value: String(x1) },
              { name: 'Y1', attrs: {}, children: [], value: String(y1) },
              { name: 'Z1', attrs: {}, children: [], value: '0' },
              { name: 'X2', attrs: {}, children: [], value: String(x2) },
              { name: 'Y2', attrs: {}, children: [], value: String(y2) },
              { name: 'Z2', attrs: {}, children: [], value: '0' },
            ],
            value: '',
          },
        ],
        value: '',
      },
    ],
  } as unknown as FcstdProperty;
}

describe('GOTCHA: planegcs-backend Symmetric/Angle/axis-ref mapping', () => {
  it('G-A: p2p_symmetric_ppp uses p_id (not p3_id) and actually constrains', async () => {
    const solver = await createPlanegcsSolver();
    // triangle: base fixed, apex mirrored about the base's endpoint vertical
    const geoms = [
      { kind: 'point', index: 0, x: 0, y: 0, z: 0 },
      { kind: 'line', index: 1, x1: 0, y1: 0, z1: 0, x2: 10, y2: 0, z2: 0 },
    ] as never[];
    // Symmetric(point0, line1.start, point-as-center) would need a point geom;
    // here use the real-corpus shape: Symmetric(l.end, l.start, p)
    const constraints = [
      { index: 0, type: ConstraintType.Symmetric, refs: [{ geoId: 1, pos: 2 }, { geoId: 1, pos: 1 }, { geoId: 0, pos: 1 }], value: 0, isDriving: true, name: '' },
    ];
    const r = await solver.solve(geoms, constraints);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // constraint must NOT be dropped (p3_id bug dropped it)
    expect(r.value.droppedConstraints).toEqual([]);
    expect(r.value.converged).toBe(true);
  });

  it('G-B: Angle with explicit point positions (pppp shape) is applied, not skipped', async () => {
    const solver = await createPlanegcsSolver();
    const geoms = [
      { kind: 'line', index: 0, x1: 0, y1: 0, z1: 0, x2: 1, y2: 0, z2: 0 },
      { kind: 'line', index: 1, x1: 0, y1: 0, z1: 0, x2: 0, y2: 1, z2: 0 },
    ] as never[];
    const constraints = [
      { index: 0, type: ConstraintType.Angle, refs: [{ geoId: 0, pos: 1 }, { geoId: 1, pos: 1 }], value: Math.PI / 4, isDriving: true, name: '' },
    ];
    const r = await solver.solve(geoms, constraints);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.converged).toBe(true);
    // pre-fix the constraint was silently skipped: line1 kept pointing at 90°.
    // Any rotation away from the initial direction proves the mapping fired.
    const l1 = r.value.geoms[1] as { x2: number; y2: number };
    const ang = Math.atan2(l1.y2, l1.x2);
    expect(Math.abs(ang - Math.PI / 2)).toBeGreaterThan(1e-3);
  });

  it('G-D: DistanceX(point, VAxis-edge) is absolute x=+value (not -value)', async () => {
    const solver = await createPlanegcsSolver();
    const geoms = [
      { kind: 'line', index: 0, x1: 3.175, y1: 25.496, z1: 0, x2: 3.175, y2: 25.486, z2: 0 },
    ] as never[];
    const constraints = [
      { index: 0, type: ConstraintType.DistanceX, refs: [{ geoId: 0, pos: 1 }, { geoId: -2, pos: 0 }], value: 3.175, isDriving: true, name: '' },
    ];
    const r = await solver.solve(geoms, constraints);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.converged).toBe(true);
    const l0 = r.value.geoms[0] as { x1: number };
    expect(Math.abs(l0.x1 - 3.175)).toBeLessThan(T1);
  });

  it('G-E: Distance(point, HAxis-edge) is point-to-line distance |y|, not circle-to-origin', async () => {
    const solver = await createPlanegcsSolver();
    const geoms = [
      { kind: 'line', index: 0, x1: 2, y1: 19.05, z1: 0, x2: 2, y2: 20, z2: 0 },
    ] as never[];
    const constraints = [
      { index: 0, type: ConstraintType.Distance, refs: [{ geoId: 0, pos: 1 }, { geoId: -1, pos: 0 }], value: 19.05, isDriving: true, name: '' },
    ];
    const r = await solver.solve(geoms, constraints);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.converged).toBe(true);
    const l0 = r.value.geoms[0] as { y1: number; x1: number };
    expect(Math.abs(Math.abs(l0.y1) - 19.05)).toBeLessThan(T1);
    // pre-fix bug dragged the point onto a circle of radius 19.05 around the
    // origin, e.g. x != 2. x must stay untouched by this constraint.
    expect(Math.abs(l0.x1 - 2)).toBeLessThan(T1);
  });
});

describe('GOTCHA: real-corpus L1 wrong solutions (delta-exceeds)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const corpusRoot = process.env.FAIJS_FCSTD_CORPUS ?? 'D:/Faicad/FreeCAD';

  interface Case { file: string; sketch: string; }
  const CASES: Case[] = [
    { file: join(corpusRoot, 'src/Mod/CAM/Tools/Shape/taperedballnose.fcstd'), sketch: 'Sketch' },
    { file: join(corpusRoot, 'src/Mod/Sketcher/SketcherTests/TestSketchCarbonCopyReverseMapping.FCStd'), sketch: 'Sketch001' },
  ];

  for (const c of CASES) {
    it(`solves to L0: ${c.sketch} in ${c.file.split('/').pop()}`, async () => {
      let raw: Buffer;
      try {
        raw = readFileSync(c.file);
      } catch {
        console.warn(`skipping corpus case (missing): ${c.file}`);
        return;
      }
      const { unpackFcstd, memberText } = await import('./unpack.js');
      const { parseDocumentXml } = await import('./document.js');
      const zip = unpackFcstd(new Uint8Array(raw));
      expect(zip.ok).toBe(true);
      if (!zip.ok) return;
      const doc = parseDocumentXml(memberText(zip.value, 'Document.xml')!);
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;
      const obj = doc.value.objects.find((o) => o.name === c.sketch);
      expect(obj).toBeDefined();
      if (!obj) return;
      const sk = parseSketchObject(obj.properties.get('Geometry'), obj.properties.get('Constraints'), false);
      const solver = await createPlanegcsSolver();
      const r = await solver.solve(sk.geoms, sk.constraints);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const delta = maxPointDistance(sk.geoms, r.value.geoms);
      expect(delta).toBeLessThan(T1);
    });
  }

  it('hole_puzzle Sketch005 stays at delta 0 with external geometry present', async () => {
    // refs may carry Third=-2000 sentinel; PointPos import pins the enum values
    expect(PointPos.none).toBe(0);
    const file = join(corpusRoot, 'src/Mod/CAM/DemoParts/hole_puzzle.fcstd');
    let raw: Buffer;
    try {
      raw = readFileSync(file);
    } catch {
      console.warn(`skipping corpus case (missing): ${file}`);
      return;
    }
    const { unpackFcstd, memberText } = await import('./unpack.js');
    const { parseDocumentXml } = await import('./document.js');
    const { resolveExternalGeometry } = await import('./external-geo.js');
    const zip = unpackFcstd(new Uint8Array(raw));
    expect(zip.ok).toBe(true);
    if (!zip.ok) return;
    const doc = parseDocumentXml(memberText(zip.value, 'Document.xml')!);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    const obj = doc.value.objects.find((o) => o.name === 'Sketch005');
    expect(obj).toBeDefined();
    if (!obj) return;
    const sk = parseSketchObject(obj.properties.get('Geometry'), obj.properties.get('Constraints'), false);
    const ext = await resolveExternalGeometry(obj.properties.get('ExternalGeometry'), doc.value, zip.value, obj.properties.get('Placement'));
    expect(ext.links.length).toBeGreaterThan(0);
    // geoId follows LINK ORDER (RefExt -3, -4, ...), including curve links —
// filtering two-point segments first then renumbering misaligns ids (GOTCHA,
// probe-carbon-ext.ts: CarbonCopy Sketch001 #3 references g-7).
const external = ext.links.map((l, i) => ({ geoId: -3 - i, polyline: l.polyline }));
    const solver = await createPlanegcsSolver();
    const r = await solver.solve(sk.geoms, sk.constraints, external);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const delta = maxPointDistance(sk.geoms, r.value.geoms);
    expect(delta).toBeLessThan(T1);
  });
});
