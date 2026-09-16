/**
 * M6.3 verification ledger — the edge-ordinal anchoring contract and the
 * external-geometry projection pipeline, kept as repeatable tests.
 *
 * Key verified facts (first established via dbg-m6f/dbg-m6i, now pinned here):
 * 1. wireframe() edgeGroups index k corresponds to FreeCAD sub-element
 *    "Edge(k+1)" — TopExp::MapShapes + IndexedMap enumeration order, the same
 *    order getSubShapes uses (packages/core/src/occt-kernel/topologyExt.ts).
 * 2. External edges project into sketch-local 2D via the sketch Placement
 *    inverse (quaternion conjugate + translation), landing on z≈0.
 * 3. Resolved segments feed the solver as fixed lines under negative geoIds
 *    (-3, -4, ...) in ExternalGeometry link order, and PointOnObject against
 *    them converges to L0.
 *
 * OCCT wasm is initialized once in beforeAll (parity-test precedent).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { unpackFcstd, memberText } from './unpack.js';
import { parseDocumentXml } from './document.js';
import { parseSketchObject } from './sketch-parse.js';
import { createPlanegcsSolver } from './planegcs-backend.js';
import { resolveExternalGeometry } from './external-geo.js';
import { classifySketch } from './sketch-verify.js';
import { isOk } from '../vendored/brepjs/core/result.js';
import { initOcctWasm } from '../occt-kernel/occtKernel.js';

// sample corpus lives outside the repo (local FreeCAD checkout) — skip
// gracefully when absent so CI without the corpus stays green.
const SAMPLE = 'D:/Faicad/FreeCAD/src/Mod/CAM/DemoParts/hole_puzzle.fcstd';
const sampleAvailable = (() => {
  try {
    readFileSync(SAMPLE);
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!sampleAvailable)('M6.3 edge anchoring + projection (requires local FreeCAD corpus)', () => {
  let kernel: {
    fromBREP: (s: string) => unknown;
    wireframe: (s: unknown, deflection: number) => { points: Float32Array; edgeGroups: number[] };
  };

  beforeAll(async () => {
    // GOTCHA: initOcctWasm() RESOLVES to the kernel instance — the module
    // namespace has no fromBREP/wireframe. First draft assigned the import
    // namespace here and got "kernelAny.fromBREP is not a function".
    kernel = (await initOcctWasm()) as never;
  });

  it('GOTCHA: wireframe edgeGroups[k] == FreeCAD "Edge(k+1)" (IndexedMap order)', async () => {
    // First draft assumed 1-based storage or sorted-by-hash order; verified
    // against hole_puzzle: Chamfer002 Edge13 decodes to the straight edge
    // [100,-4,39]→[100,-96,39] at index 12 — matching Sketch003's stored
    // constraint geometry (own line1 at x=100 with PointOnObject onto it).
    const occt = await import('../occt-kernel/occtKernel.js');
    const k = (occt as { initOcctWasm: () => Promise<unknown> });
    void k;
    const unpacked = unpackFcstd(new Uint8Array(readFileSync(SAMPLE)));
    expect(isOk(unpacked)).toBe(true);
    if (!isOk(unpacked)) return;
    const doc = parseDocumentXml(memberText(unpacked.value, 'Document.xml')!);
    expect(isOk(doc)).toBe(true);
    if (!isOk(doc)) return;

    const src = doc.value.objects.find((o) => o.name === 'Chamfer002')!;
    const brp = memberText(unpacked.value, src.properties.get('Shape')!.children[0]!.attributes['file']!)!;
    const kernelAny = kernel ?? ((await initOcctWasm()) as never);
    const shape = kernelAny.fromBREP(brp);
    const wf = kernelAny.wireframe(shape, 0.01);

    const idx = 12; // Edge13 − 1
    const g0 = wf.edgeGroups[idx * 3]!;
    const g1 = wf.edgeGroups[idx * 3 + 1]!;
    const n = Math.floor(g1 / 3);
    const p0 = [wf.points[g0]!, wf.points[g0 + 1]!, wf.points[g0 + 2]!] as const;
    const pl = [wf.points[g0 + (n - 1) * 3]!, wf.points[g0 + (n - 1) * 3 + 1]!, wf.points[g0 + (n - 1) * 3 + 2]!] as const;
    // straight vertical edge at x=100, z=39 spanning y −4..−96 (from the
    // verified probe run); if upstream enumeration order ever changes,
    // this pins the breakage instead of silently mis-projecting.
    expect(Math.hypot(p0[0] - 100, p0[1] - -4, p0[2] - 39)).toBeLessThan(1e-3);
    expect(Math.hypot(pl[0] - 100, pl[1] - -96, pl[2] - 39)).toBeLessThan(1e-3);
  });

  it('external-geometry projection + solve upgrades Sketch003 to L0', async () => {
    const solver = await createPlanegcsSolver();
    const unpacked = unpackFcstd(new Uint8Array(readFileSync(SAMPLE)));
    if (!isOk(unpacked)) return;
    const doc = parseDocumentXml(memberText(unpacked.value, 'Document.xml')!);
    if (!isOk(doc)) return;
    const sk = doc.value.objects.find((o) => o.name === 'Sketch003')!;
    const parsed = parseSketchObject(sk.properties.get('Geometry'), sk.properties.get('Constraints'), false);
    expect(parsed.externalGeoIds.length).toBeGreaterThan(0);
    const ext = await resolveExternalGeometry(
      sk.properties.get('ExternalGeometry'), doc.value, unpacked.value, sk.properties.get('Placement'),
    );
    expect(ext.failures).toEqual([]);
    // projected external endpoints land on sketch-local z≈0 (D7 plane contract)
    for (const l of ext.links) {
      expect(l.polyline.length).toBeGreaterThanOrEqual(2);
    }
    const segs = ext.links
      .filter((l) => l.polyline.length === 2)
      .map((l, i) => ({ geoId: -3 - i, polyline: l.polyline }));
    const r = await solver.solve(parsed.geoms, parsed.constraints, segs);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const verdict = classifySketch(r.value, parsed.geoms, 1e-6);
    expect(verdict.level).toBe('L0');
  });
});
