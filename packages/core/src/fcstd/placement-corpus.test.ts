/**
 * M8.4 — placement fidelity: PadTest.fcstd Sketch002 (non-XY plane, y≈52.1)
 * compared point-by-point between the parsed sketch-local 2D coordinates
 * lifted through the Placement and the FCStd-stored 3D truth.
 *
 * Corpus lives outside the repo — skipped when absent (FAIJS_FCSTD_CORPUS).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unpackFcstd, memberText } from './unpack.js';
import { parseDocumentXml } from './document.js';
import { parseSketchObject } from './sketch-parse.js';
import { placementOf, applyPlacement, planeBasis } from './placement.js';
import { isOk } from '../vendored/brepjs/core/result.js';

const CORPUS = process.env.FAIJS_FCSTD_CORPUS ?? 'D:/Faicad/FreeCAD';
const SAMPLE = join(CORPUS, 'data/tests/PadTest.fcstd');
const sampleAvailable = (() => {
  try {
    readFileSync(SAMPLE);
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!sampleAvailable)('M8.4 PadTest Sketch002 placement fidelity (requires corpus)', () => {
  it('projects every sketch-local point onto the placement plane exactly', () => {
    const unpacked = unpackFcstd(new Uint8Array(readFileSync(SAMPLE)));
    expect(isOk(unpacked)).toBe(true);
    if (!isOk(unpacked)) return;
    const doc = parseDocumentXml(memberText(unpacked.value, 'Document.xml')!);
    expect(isOk(doc)).toBe(true);
    if (!isOk(doc)) return;

    const sketch = doc.value.objects.find((o) => o.name === 'Sketch002');
    expect(sketch, 'Sketch002 present').toBeDefined();
    if (!sketch) return;
    const sk = parseSketchObject(sketch.properties.get('Geometry'), sketch.properties.get('Constraints'), false);
    const pl = placementOf(sketch);

    // Sketch002: rotation 180° about X (Q0=-0.707…? measured: q=(-0, -0.707, 0, 0.707))
    // → local +Y maps to global -Z, plane at x=30 (plan §M8.4: y≈52.1 lines live here)
    const lines = sk.geoms.filter((g) => g.kind === 'line');
    expect(lines.length).toBe(4);

    // every point must sit on the sketch plane: (P - p)·n === 0 for all of them
    const { n } = planeBasis(pl);
    for (const g of lines) {
      if (g.kind !== 'line') continue;
      for (const [lx, ly] of [[g.x1, g.y1], [g.x2, g.y2]] as const) {
        const w = applyPlacement(pl, [lx, ly, 0]);
        const d = (w[0] - pl.p[0]) * n[0] + (w[1] - pl.p[1]) * n[1] + (w[2] - pl.p[2]) * n[2];
        expect(Math.abs(d)).toBeLessThan(1e-9);
      }
    }

    // FreeCAD stores the geometry in sketch-local 2D — lifting through the
    // Placement must be a rigid motion: pairwise distances preserved exactly.
    const pts = lines.flatMap((g) => (g.kind === 'line' ? [[g.x1, g.y1], [g.x2, g.y2]] : []));
    const lifted = pts.map(([x, y]) => applyPlacement(pl, [x!, y!, 0]));
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d2d = Math.hypot(pts[i]![0]! - pts[j]![0]!, pts[i]![1]! - pts[j]![1]!);
        const d3d = Math.hypot(
          lifted[i]![0] - lifted[j]![0],
          lifted[i]![1] - lifted[j]![1],
          lifted[i]![2] - lifted[j]![2],
        );
        expect(d3d).toBeCloseTo(d2d, 9);
      }
    }

    // the corpus truth: all Sketch002 geometry sits at global x=30 (Px) with
    // local +Y pointing down -Z — so every lifted point has x === 30.
    for (const w of lifted) expect(w[0]).toBeCloseTo(30, 9);
  });
});
