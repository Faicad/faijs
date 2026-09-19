import { readFileSync } from 'node:fs';
import { unpackFcstd, memberText } from '../src/fcstd/unpack.ts';
import { parseDocumentXml } from '../src/fcstd/document.ts';
import { isOk } from '../src/vendored/brepjs/core/result.ts';
const data = readFileSync('D:/Faicad/FreeCAD-library/Architectural Parts/Beams/Profile HEA.FCStd');
const u = unpackFcstd(new Uint8Array(data));
const doc = parseDocumentXml(memberText(u.value, 'Document.xml'));
if (!isOk(doc)) { console.log('parse fail'); process.exit(1); }
for (const o of doc.value.objects) {
  if (o.type === 'Sketcher::SketchObject') {
    const cons = o.properties.get('Constraints');
    console.log('Constraints prop:', JSON.stringify(cons ? { tagName: cons.tagName, type: cons.type, nChildren: cons.children.length, firstChild: cons.children[0] } : null).slice(0, 600));
    break;
  }
}
const withExpr = doc.value.objects.find(o => o.properties.has('ExpressionEngine'));
console.log('expr obj:', withExpr ? withExpr.type : 'none in this file');
// dump property names of a couple objects
console.log('prop names sample:', [...doc.value.objects[0].properties.keys()].join(','));
// deeper probe: expression engine children + XLink shape
const body = doc.value.objects.find(o => o.properties.has('ExpressionEngine'));
const eng = body.properties.get('ExpressionEngine');
console.log('engine tagName:', eng.tagName, 'children:', eng.children.length, 'first:', JSON.stringify(eng.children[0]).slice(0,300));
for (const o of doc.value.objects) {
  for (const [k,p] of o.properties) {
    if (p.tagName.includes('XLink')) console.log('xlink prop:', o.type, k, p.tagName, JSON.stringify(p.attributes));
  }
}
