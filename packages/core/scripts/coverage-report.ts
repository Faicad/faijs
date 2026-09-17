// M12.4 — V5 translation coverage report, two scopes:
//   ① all objects           — every <Object> in every Document.xml
//   ② non-Python-modeled    — excluding *.Python types and App::DocumentObject*
//     (Python-scripted objects carry no translatable property payload; the
//      raw ① number is dominated by them — see plan risk R-G)
// Coverage is measured per OBJECT TYPE against the M4 whitelist
// (feature-translate.isWhitelisted) plus the datum/sketch special cases.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { unpackFcstd, memberText } from '../src/fcstd/unpack.ts';
import { parseDocumentXml } from '../src/fcstd/document.ts';
import { isWhitelisted } from '../src/fcstd/feature-translate.ts';
import { isOk } from '../src/vendored/brepjs/core/result.ts';

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (extname(name).toLowerCase() === '.fcstd') out.push(p);
  }
}

const root = process.argv[2] ?? process.env.FAIJS_FCSTD_CORPUS ?? 'D:/Faicad/FreeCAD';
const files: string[] = [];
walk(root, files);
files.sort();

/** datums are preserved-only by design, not translation failures */
const DATUMS = new Set(['App::Origin', 'App::Plane', 'App::Line']);

function isPythonType(t: string): boolean {
  return t.endsWith('Python') || t.startsWith('App::DocumentObject');
}

const counts = new Map<string, { total: number; python: number; coverable: number }>();
let grandTotal = 0;
let grandPython = 0;
let grandCoverable = 0;

for (const file of files) {
  const unpacked = unpackFcstd(new Uint8Array(readFileSync(file)));
  if (!isOk(unpacked)) continue;
  const doc = parseDocumentXml(memberText(unpacked.value, 'Document.xml')!);
  if (!isOk(doc)) continue;
  for (const obj of doc.value.objects) {
    let c = counts.get(obj.type);
    if (!c) { c = { total: 0, python: 0, coverable: 0 }; counts.set(obj.type, c); }
    c.total++;
    grandTotal++;
    if (isPythonType(obj.type)) { c.python++; grandPython++; continue; }
    const translated = isWhitelisted(obj.type) || DATUMS.has(obj.type) || obj.type === 'Sketcher::SketchObject';
    if (translated) { c.coverable++; grandCoverable++; }
  }
}

console.log('=== V5 coverage (per type, sorted by count) ===');
console.log('type                                    total  python  coverable');
for (const [t, c] of [...counts.entries()].sort((a, b) => b[1].total - a[1].total)) {
  if (c.total < 2 && c.python > 0) continue; // compress: unique python types
  console.log(`${t.padEnd(38)} ${String(c.total).padStart(6)} ${String(c.python).padStart(7)} ${String(c.coverable).padStart(9)}`);
}
console.log('---');
console.log(`scope ① all objects:            ${grandTotal}`);
console.log(`        python-modeled:         ${grandPython}`);
console.log(`scope ② non-python objects:     ${grandTotal - grandPython}`);
console.log(`        coverable (whitelist+datum+sketch): ${grandCoverable}`);
console.log(`coverage ② = ${(grandCoverable / (grandTotal - grandPython) * 100).toFixed(1)}%`);
