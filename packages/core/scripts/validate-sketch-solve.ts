// full-sample validation with M6.3 external geometry resolution
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { unpackFcstd, memberText } from '../src/fcstd/unpack.ts';
import { parseDocumentXml } from '../src/fcstd/document.ts';
import { parseSketchObject } from '../src/fcstd/sketch-parse.ts';
import { createPlanegcsSolver } from '../src/fcstd/planegcs-backend.ts';
import { resolveExternalGeometry } from '../src/fcstd/external-geo.ts';
import { classifySketch } from '../src/fcstd/sketch-verify.ts';
import { isOk } from '../src/vendored/brepjs/core/result.ts';

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (extname(name).toLowerCase() === '.fcstd') out.push(p);
  }
}
const solver = await createPlanegcsSolver();
// M7.4: sample root is a parameter (argv[2] or FAIJS_FCSTD_CORPUS env),
// defaulting to the local FreeCAD corpus — no more hardcoded path.
const root = process.argv[2] ?? process.env.FAIJS_FCSTD_CORPUS ?? 'D:/Faicad/FreeCAD';
const files: string[] = [];
walk(root, files);
files.sort();
const levels = { L0: 0, L1: 0, L2: 0 };
const reasons = new Map<string, number>();
let sketches = 0;
for (const file of files) {
  const unpacked = unpackFcstd(new Uint8Array(readFileSync(file)));
  if (!isOk(unpacked)) continue;
  const doc = parseDocumentXml(memberText(unpacked.value, 'Document.xml')!);
  if (!isOk(doc)) continue;
  for (const obj of doc.value.objects) {
    if (obj.type !== 'Sketcher::SketchObject') continue;
    sketches++;
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
    } catch (e) {
      const v = classifySketch(undefined, sk.geoms, 1e9, `throw: ${(e as Error).message.slice(0, 50)}`);
      levels[v.level]++; reasons.set(v.reason ?? '?', (reasons.get(v.reason ?? '?') ?? 0) + 1);
      continue;
    }
    const v = classifySketch(outcome, sk.geoms, 1e-6, badGeom ? 'unsupported-geometry' : undefined);
    levels[v.level]++;
    if (v.reason) reasons.set(v.reason, (reasons.get(v.reason) ?? 0) + 1);
  }
}
console.log(`sketches: ${sketches}`);
console.log(`L0: ${levels.L0}  L1: ${levels.L1}  L2: ${levels.L2}`);
console.log('reasons:', JSON.stringify([...reasons.entries()]));
