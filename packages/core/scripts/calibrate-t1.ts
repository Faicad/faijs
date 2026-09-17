// M12.1 — T1 calibration: solve every sketch in the corpus, collect the
// post-solve delta (max point distance between solved and stored geometry)
// for the sketches that CONVERGED, and report the distribution
// (P50/P90/P99/max). The plan requires T1 to be derived from this
// distribution's tail, not written down by hand.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { unpackFcstd, memberText } from '../src/fcstd/unpack.ts';
import { parseDocumentXml } from '../src/fcstd/document.ts';
import { parseSketchObject } from '../src/fcstd/sketch-parse.ts';
import { createPlanegcsSolver } from '../src/fcstd/planegcs-backend.ts';
import { resolveExternalGeometry } from '../src/fcstd/external-geo.ts';
import { maxPointDistance } from '../src/fcstd/sketch-verify.ts';
import { isOk } from '../src/vendored/brepjs/core/result.ts';

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (extname(name).toLowerCase() === '.fcstd') out.push(p);
  }
}

const root = process.argv[2] ?? process.env.FAIJS_FCSTD_CORPUS ?? 'D:/Faicad/FreeCAD';
const solver = await createPlanegcsSolver();
const files: string[] = [];
walk(root, files);
files.sort();

// deltas of sketches the solver reported converged on (DoF exhausted) —
// these measure pure solver-reproduction error, the quantity T1 thresholds.
const deltas: { file: string; sketch: string; delta: number }[] = [];
let solveFailures = 0;

for (const file of files) {
  const unpacked = unpackFcstd(new Uint8Array(readFileSync(file)));
  if (!isOk(unpacked)) continue;
  const doc = parseDocumentXml(memberText(unpacked.value, 'Document.xml')!);
  if (!isOk(doc)) continue;
  for (const obj of doc.value.objects) {
    if (obj.type !== 'Sketcher::SketchObject') continue;
    const sk = parseSketchObject(obj.properties.get('Geometry'), obj.properties.get('Constraints'), false);
    const badGeom = sk.geoms.some((g) => !Number.isFinite((g as { x?: number }).x ?? 0));
    let external;
    if (sk.externalGeoIds.length > 0 && !badGeom) {
      const ext = await resolveExternalGeometry(obj.properties.get('ExternalGeometry'), doc.value, unpacked.value, obj.properties.get('Placement'));
      external = ext.links.filter((l) => l.polyline.length === 2).map((l, i) => ({ geoId: -3 - i, polyline: l.polyline }));
    }
    try {
      const r = await solver.solve(sk.geoms, sk.constraints, external);
      if (!isOk(r) || !r.value.converged) { solveFailures++; continue; }
      deltas.push({ file, sketch: obj.name, delta: maxPointDistance(r.value.geoms, sk.geoms) });
    } catch {
      solveFailures++;
    }
  }
}

deltas.sort((a, b) => a.delta - b.delta);
const n = deltas.length;
const pct = (p: number): number => deltas[Math.min(n - 1, Math.floor(p * n))]!.delta;
console.log(`sketches solved&converged: ${n}  (solve failures/throws: ${solveFailures})`);
console.log(`P50: ${pct(0.5).toExponential(3)}`);
console.log(`P90: ${pct(0.9).toExponential(3)}`);
console.log(`P99: ${pct(0.99).toExponential(3)}`);
console.log(`max: ${deltas[n - 1]!.delta.toExponential(3)}`);
// exact zeros dominate (fully-constrained sketches reproduce stored values
// bit-for-bit); show the non-zero tail separately
const nonzero = deltas.filter((d) => d.delta > 0);
console.log(`\nnon-zero deltas: ${nonzero.length}`);
for (const d of nonzero.slice(0, 20)) {
  console.log(`  ${d.delta.toExponential(3)}  ${d.file.split(/[\\/]/).pop()} :: ${d.sketch}`);
}
