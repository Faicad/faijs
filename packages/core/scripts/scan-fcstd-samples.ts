/**
 * M1.3/M1.4 — sample-set scan: unpack + parse Document.xml for every .FCStd
 * in the local FreeCAD repo, report object-type distribution and sketch stats.
 * Exit criterion: zero failures across all 56 samples.
 *
 * Run: npx tsx packages/core/scripts/scan-fcstd-samples.ts <freecad-repo-root>
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { unpackFcstd, memberText } from '../src/fcstd/unpack.ts';
import { parseDocumentXml } from '../src/fcstd/document.ts';
import { isOk } from '../src/vendored/brepjs/core/result.ts';

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (extname(name).toLowerCase() === '.fcstd') out.push(p);
  }
}

const root = process.argv[2];
if (!root) {
  console.error('usage: tsx scan-fcstd-samples.ts <freecad-repo-root>');
  process.exit(1);
}

const files: string[] = [];
walk(root, files);
files.sort();

let failures = 0;
const typeCounts = new Map<string, number>();
let sketchObjects = 0;
let geometryTotal = 0;
let constraintTotal = 0;

for (const file of files) {
  const data = readFileSync(file);
  const unpacked = unpackFcstd(new Uint8Array(data));
  if (!isOk(unpacked)) {
    console.error(`FAIL unpack ${file}: ${JSON.stringify(unpacked.error)}`);
    failures++;
    continue;
  }
  const xml = memberText(unpacked.value, 'Document.xml');
  if (xml === undefined) {
    console.error(`FAIL missing Document.xml ${file}`);
    failures++;
    continue;
  }
  const doc = parseDocumentXml(xml);
  if (!isOk(doc)) {
    console.error(`FAIL parse ${file}: ${doc.error.message}`);
    failures++;
    continue;
  }
  let geoCount = 0;
  let conCount = 0;
  for (const obj of doc.value.objects) {
    typeCounts.set(obj.type, (typeCounts.get(obj.type) ?? 0) + 1);
    if (obj.type === 'Sketcher::SketchObject') {
      sketchObjects++;
      const geo = obj.properties.get('Geometry');
      if (geo) geoCount = geo.children[0] ? Number(geo.children[0].attributes['count'] ?? 0) : 0;
      const cons = obj.properties.get('Constraints');
      if (cons) conCount = cons.children[0] ? Number(cons.children[0].attributes['count'] ?? 0) : 0;
      geometryTotal += geoCount;
      constraintTotal += conCount;
    }
  }
  console.log(`${file}  objects=${doc.value.objects.length} geo=${geoCount} con=${conCount}`);
}

console.log('\n=== SUMMARY ===');
console.log(`files: ${files.length}, failures: ${failures}`);
console.log(`sketch objects: ${sketchObjects}, geometry: ${geometryTotal}, constraints: ${constraintTotal}`);
console.log('\nobject type distribution:');
for (const [t, c] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t}: ${c}`);
}
if (failures > 0) process.exit(1);
