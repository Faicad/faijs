// M12.2 — locate the 4 L1 sketches across the corpus: for each file/sketch,
// report which constraint(s) push it out of L0 (unsupported-constraint or
// delta-exceeds-tolerance), with per-constraint type breakdown.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { unpackFcstd, memberText } from '../src/fcstd/unpack.ts';
import { parseDocumentXml } from '../src/fcstd/document.ts';
import { parseSketchObject } from '../src/fcstd/sketch-parse.ts';
import { createPlanegcsSolver } from '../src/fcstd/planegcs-backend.ts';
import { resolveExternalGeometry } from '../src/fcstd/external-geo.ts';
import { classifySketch, maxPointDistance } from '../src/fcstd/sketch-verify.ts';
import { CONSTRAINT_NAMES } from '../src/fcstd/sketch-parse.ts';
import { isOk } from '../src/vendored/brepjs/core/result.ts';

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (extname(name).toLowerCase() === '.fcstd') out.push(p);
  }
}

const root = process.argv[2] ?? process.env.FAIJS_FCSTD_CORPUS ?? 'D:/Faicad/FreeCAD';
const T1 = 1e-6;
const solver = await createPlanegcsSolver();
const files: string[] = [];
walk(root, files);
files.sort();

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
    let outcome;
    try {
      const r = await solver.solve(sk.geoms, sk.constraints, external);
      if (isOk(r)) outcome = r.value;
    } catch {
      continue; // L2 by throw — not an L1 target
    }
    if (!outcome) continue;
    const delta = maxPointDistance(outcome.geoms, sk.geoms);
    const verdict = classifySketch(outcome, sk.geoms, T1, badGeom ? 'unsupported-geometry' : undefined);
    if (verdict.level !== 'L1') continue;
    // L1: report constraint types present, and which are non-driving / unsupported
    const typeCounts = new Map<number, number>();
    for (const c of sk.constraints) typeCounts.set(c.type, (typeCounts.get(c.type) ?? 0) + 1);
    const types = [...typeCounts.entries()].map(([t, n]) => `${t}:${CONSTRAINT_NAMES[t] ?? '?'}x${n}`).join(', ');
    const nonDriving = sk.constraints.filter((c) => !c.isDriving).length;
    console.log(`L1  ${file}`);
    console.log(`    sketch: ${obj.name}  delta=${delta.toExponential(3)}  reason=${verdict.reason}`);
    console.log(`    constraints(${sk.constraints.length}): ${types}`);
    console.log(`    non-driving: ${nonDriving}`);
  }
}
