// M13-w2 probe — Part::Offset2D feasibility: what do its Source wires look
// like (Draft Wire Points property? arcs?), and how many of the corpus
// instances fall inside the translatable scope (closed polyline, no arcs)?
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { unpackFcstd, memberText } from '../src/fcstd/unpack.ts';
import { parseDocumentXml } from '../src/fcstd/document.ts';
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

let total = 0, qualify = 0;
for (const file of files) {
  const unpacked = unpackFcstd(new Uint8Array(readFileSync(file)));
  if (!isOk(unpacked)) continue;
  const doc = parseDocumentXml(memberText(unpacked.value, 'Document.xml')!);
  if (!isOk(doc)) continue;
  const byName = new Map(doc.value.objects.map((o) => [o.name, o]));
  for (const obj of doc.value.objects) {
    if (obj.type !== 'Part::Offset2D') continue;
    total++;
    const src = obj.properties.get('Source')?.children[0]?.attributes['value'];
    const srcObj = src ? byName.get(src) : undefined;
    const fill = obj.properties.get('Fill')?.children[0]?.attributes['value'];
    const joinType = obj.properties.get('Join')?.children[0]?.attributes['value'];
    const mode = obj.properties.get('Mode')?.children[0]?.attributes['value'];
    // draft wire storage
    let wireInfo = `source=${src ?? 'none'} type=${srcObj?.type ?? '?'}`;
    if (srcObj) {
      const points = srcObj.properties.get('Points');
      const closed = srcObj.properties.get('Closed')?.children[0]?.attributes['value'];
      const geoList = srcObj.properties.get('Geometry');
      wireInfo += ` Points=${points ? points.children[0]?.attributes['count'] ?? points.children.length : 'none'} Closed=${closed ?? '?'}`;
      if (geoList) wireInfo += ` GeometryList=yes`;
      if (points) {
        const vecs = points.children[0]?.children ?? [];
        const first = vecs[0]?.children[0]?.attributes;
        wireInfo += ` firstPt=${JSON.stringify(first)}`;
      }
    }
    console.log(`Offset2D "${obj.name}" in ${file.split(/[\\/]/).pop()} Fill=${fill} Join=${joinType} Mode=${mode} :: ${wireInfo}`);
  }
}
console.log(`\ntotal Offset2D: ${total}`);
