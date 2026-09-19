/**
 * fcstd-port B1 — library-wide profile probe (read-only).
 * Scans a FCStd tree and produces the four histograms required by plan
 * docs/plans/2026-09-19-freecad-library-batch-convert-plan.md §4:
 *   1. object-type histogram
 *   2. constraint-type histogram
 *   3. expression stats (ExpressionEngine count, non-const ratio, spreadsheets)
 *   4. structure stats (files, Bodies, XLinks, Python features, sketches)
 *
 * Run: npx tsx packages/core/scripts/profile-fcstd-library.ts <library-root> <out-json>
 * .FCStd1 backups are skipped (Q1: user decision).
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { unpackFcstd, memberText } from '../src/fcstd/unpack.ts';
import { parseDocumentXml, type FcstdObject } from '../src/fcstd/document.ts';
import { isOk } from '../src/vendored/brepjs/core/result.ts';

interface Profile {
  files: number;
  failures: number;
  failureList: { file: string; reason: string }[];
  objectTypes: Record<string, number>;
  constraintTypes: Record<string, number>;
  expressions: { filesWithEngine: number; engines: number; expressionCount: number; nonConstExpressions: number };
  structure: { bodies: number; xlinkFiles: number; xlinkCount: number; pythonObjects: number; sketchObjects: number; sketchGeometry: number; sketchConstraints: number; spreadsheets: number };
  parseMsTotal: number;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else {
      const ext = extname(name).toLowerCase();
      // Q1: .FCStd1 backups are skipped — plain ".fcstd" extension only
      if (ext === '.fcstd') out.push(p);
    }
  }
}

const root = process.argv[2];
const outPath = process.argv[3];
if (!root || !outPath) {
  console.error('usage: tsx profile-fcstd-library.ts <library-root> <out-json>');
  process.exit(1);
}

const files: string[] = [];
walk(root, files);
files.sort();

const profile: Profile = {
  files: files.length,
  failures: 0,
  failureList: [],
  objectTypes: {},
  constraintTypes: {},
  expressions: { filesWithEngine: 0, engines: 0, expressionCount: 0, nonConstExpressions: 0 },
  structure: { bodies: 0, xlinkFiles: 0, xlinkCount: 0, pythonObjects: 0, sketchObjects: 0, sketchGeometry: 0, sketchConstraints: 0, spreadsheets: 0 },
  parseMsTotal: 0,
};

function bump(map: Record<string, number>, key: string, n = 1): void {
  map[key] = (map[key] ?? 0) + n;
}

/** constraint types from a sketch's Constraints property.
 * GOTCHA: the property wraps its children in one <ConstraintList count="N">
 * element — the <Constrain> entries are grandchildren, not direct children. */
function constraintTypesOf(obj: FcstdObject): string[] {
  const cons = obj.properties.get('Constraints');
  if (!cons) return [];
  const types: string[] = [];
  for (const list of cons.children) {
    for (const child of list.children) {
      if (child.tagName === 'Constrain' && child.attributes['Type']) types.push(child.attributes['Type']);
    }
  }
  return types;
}

/** expression engine stats: count + non-const classification.
 * GOTCHA: ExpressionEngine property also wraps one <ExpressionEngine count="N">
 * element; the <Expression path= expression=> entries are grandchildren. */
function expressionStatsOf(obj: FcstdObject): { count: number; nonConst: number } {
  const engine = obj.properties.get('ExpressionEngine');
  if (!engine) return { count: 0, nonConst: 0 };
  let count = 0;
  let nonConst = 0;
  for (const wrapper of engine.children) {
    for (const ex of wrapper.children) {
      if (ex.tagName !== 'Expression') continue;
      count++;
      const expr = ex.attributes['expression'] ?? '';
      // non-const: references an object/property identifier or a cell alias
      // (constants are pure numeric/paren/unit expressions)
      if (/[A-Za-z_]/.test(expr.replace(/^(e|pi|E|PI)/g, ''))) nonConst++;
    }
  }
  return { count, nonConst };
}

for (const file of files) {
  const t0 = Date.now();
  const data = readFileSync(file);
  const unpacked = unpackFcstd(new Uint8Array(data));
  if (!isOk(unpacked)) {
    profile.failures++;
    profile.failureList.push({ file, reason: `unpack: ${JSON.stringify(unpacked.error)}` });
    continue;
  }
  const xml = memberText(unpacked.value, 'Document.xml');
  if (xml === undefined) {
    profile.failures++;
    profile.failureList.push({ file, reason: 'missing Document.xml' });
    continue;
  }
  const doc = parseDocumentXml(xml);
  if (!isOk(doc)) {
    profile.failures++;
    profile.failureList.push({ file, reason: `parse: ${doc.error.message}` });
    continue;
  }
  profile.parseMsTotal += Date.now() - t0;

  let fileHasXlink = false;
  let fileHasEngine = false;
  for (const obj of doc.value.objects) {
    bump(profile.objectTypes, obj.type);
    if (obj.type === 'Sketcher::SketchObject') {
      profile.structure.sketchObjects++;
      const geo = obj.properties.get('Geometry');
      const geoCount = geo?.children[0] ? Number(geo.children[0].attributes['count'] ?? 0) : 0;
      profile.structure.sketchGeometry += geoCount;
      profile.structure.sketchConstraints += constraintTypesOf(obj).length;
      for (const t of constraintTypesOf(obj)) bump(profile.constraintTypes, t);
    } else if (obj.type === 'PartDesign::Body') {
      profile.structure.bodies++;
    } else if (obj.type === 'Spreadsheet::Sheet') {
      profile.structure.spreadsheets++;
    }
    if (obj.properties.get('Python') || obj.properties.get('Proxy') || obj.type.includes('Python')) {
      profile.structure.pythonObjects++;
    }
    for (const prop of obj.properties.values()) {
      if (prop.tagName === 'XLink' || prop.attributes['file'] !== undefined && prop.tagName === 'XLinkList') {
        profile.structure.xlinkCount++;
        fileHasXlink = true;
      }
    }
    const es = expressionStatsOf(obj);
    if (es.count > 0) {
      profile.expressions.engines++;
      profile.expressions.expressionCount += es.count;
      profile.expressions.nonConstExpressions += es.nonConst;
      fileHasEngine = true;
    }
  }
  if (fileHasXlink) profile.structure.xlinkFiles++;
  if (fileHasEngine) profile.expressions.filesWithEngine++;
}

const summary = {
  generatedAt: new Date().toISOString(),
  root,
  ...profile,
  avgParseMsPerFile: profile.files > 0 ? +(profile.parseMsTotal / profile.files).toFixed(1) : 0,
};
writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n');

// human-readable top lists to stdout
console.log(`files: ${profile.files}, failures: ${profile.failures}`);
console.log(`object types: ${Object.keys(profile.objectTypes).length}`);
console.log(`constraint types: ${Object.keys(profile.constraintTypes).length}`);
console.log(`expressions: engines=${profile.expressions.engines} count=${profile.expressions.expressionCount} nonConst=${profile.expressions.nonConstExpressions}`);
console.log(`structure: bodies=${profile.structure.bodies} xlink=${profile.structure.xlinkCount}(${profile.structure.xlinkFiles} files) python=${profile.structure.pythonObjects} sketches=${profile.structure.sketchObjects}`);
