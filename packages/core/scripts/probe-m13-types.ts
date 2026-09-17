// M13.0 — probe the real property shapes of the M13 candidate types across
// the corpus: Part::Offset2D, Part::Mirroring, Part::Compound, Part::Sphere,
// PartDesign::AdditiveSphere — so the whitelist extension maps actual fields,
// not guessed ones.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { unpackFcstd, memberText } from '../src/fcstd/unpack.ts';
import { parseDocumentXml } from '../src/fcstd/document.ts';
import { isOk } from '../src/vendored/brepjs/core/result.ts';

const TARGETS = new Set([
  'Part::Offset2D', 'Part::Mirroring', 'Part::Compound',
  'Part::Sphere', 'PartDesign::AdditiveSphere',
]);

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

for (const file of files) {
  const unpacked = unpackFcstd(new Uint8Array(readFileSync(file)));
  if (!isOk(unpacked)) continue;
  const doc = parseDocumentXml(memberText(unpacked.value, 'Document.xml')!);
  if (!isOk(doc)) continue;
  for (const obj of doc.value.objects) {
    if (!TARGETS.has(obj.type)) continue;
    console.log(`--- ${obj.type} "${obj.name}" in ${file.split(/[\\/]/).pop()}`);
    for (const [pname, prop] of obj.properties) {
      const el = prop.children[0];
      const attrs = el?.attributes ?? {};
      const interesting = Object.entries(attrs)
        .filter(([k]) => ['value', 'Value', 'file', 'x', 'y', 'z', 'Angle', 'Radius'].includes(k));
      const kids = el?.children.length ?? 0;
      if (interesting.length > 0 || kids > 0) {
        console.log(`  ${pname} (${prop.type}): ${JSON.stringify(interesting)}${kids ? ` children=${kids}` : ''}`);
      }
    }
  }
}
