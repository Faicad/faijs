/**
 * M5.4 - end-to-end CLI: .FCStd -> .fai.zip (M1 unpack -> M3 sketch solve ->
 * M4 translate -> M5 codegen -> container build).
 *
 * Run: tsx packages/core/scripts/fcstd-to-fai-zip.ts <in.FCStd> <out.fai.zip>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { unpackFcstd, memberText } from '../src/fcstd/unpack.ts';
import { parseDocumentXml } from '../src/fcstd/document.ts';
import { parseSketchObject } from '../src/fcstd/sketch-parse.ts';
import { createPlanegcsSolver } from '../src/fcstd/planegcs-backend.ts';
import { classifySketch, maxPointDistance } from '../src/fcstd/sketch-verify.ts';
import { extractContours } from '../src/fcstd/contour.ts';
import type { Contour } from '../src/fcstd/contour.ts';
import { generateModel } from '../src/fcstd/codegen.ts';
import { isOk } from '../src/vendored/brepjs/core/result.ts';
import { strToU8 } from 'fflate';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: tsx fcstd-to-fai-zip.ts <in.FCStd> <out.fai.zip>');
  process.exit(1);
}

const T1 = 1e-6; // V2 tolerance: solver must reproduce stored geometry

const unpacked = unpackFcstd(new Uint8Array(readFileSync(input)));
if (!isOk(unpacked)) {
  console.error('unpack failed:', unpacked.error.message);
  process.exit(1);
}
const xml = memberText(unpacked.value, 'Document.xml');
if (xml === undefined) {
  console.error('Document.xml missing');
  process.exit(1);
}
const doc = parseDocumentXml(xml);
if (!isOk(doc)) {
  console.error('parse failed:', doc.error.message);
  process.exit(1);
}

// M3: solve every sketch
const solver = await createPlanegcsSolver();
const sketchVerdict = new Map<string, { level: 'L0' | 'L1' | 'L2'; reason?: string; loopCount?: number }>();
const solvedGeoms = new Map<string, ReturnType<typeof parseSketchObject>['geoms']>();
/** Resolved 2D contours per solved sketch (M6 wiring → cad.sketch input). */
const sketchContours = new Map<string, Contour[]>();
for (const obj of doc.value.objects) {
  if (obj.type !== 'Sketcher::SketchObject') continue;
  const sk = parseSketchObject(obj.properties.get('Geometry'), obj.properties.get('Constraints'), false);
  const preBlocked =
    sk.externalGeoIds.length > 0 ? 'external-geometry'
    : sk.geoms.some((g) => !Number.isFinite((g as { x?: number }).x ?? 0)) ? 'unsupported-geometry'
    : undefined;
  if (preBlocked) {
    sketchVerdict.set(obj.name, { level: 'L2', reason: preBlocked });
    continue;
  }
  try {
    const r = await solver.solve(sk.geoms, sk.constraints);
    if (!isOk(r)) {
      sketchVerdict.set(obj.name, { level: 'L2', reason: 'solver-error' });
      continue;
    }
    const verdict = classifySketch(r.value, sk.geoms, T1);
    const contours = verdict.level === 'L0' ? extractContours(r.value.geoms) : [];
    const loops = contours.length;
    sketchVerdict.set(obj.name, { ...verdict, loopCount: loops });
    if (verdict.level === 'L0') {
      solvedGeoms.set(obj.name, r.value.geoms);
      sketchContours.set(obj.name, contours);
    }
  } catch (e) {
    sketchVerdict.set(obj.name, { level: 'L2', reason: `solver-throw: ${(e as Error).message.slice(0, 60)}` });
  }
}

// M4/M5: translate + codegen
const baseName = input.replace(/^.*[/\\]/, '').replace(/\.fcstd$/i, '');
const gen = generateModel(doc.value, sketchVerdict, sketchContours, baseName);

// M5.4: build container with model/ included
const { zipSync } = await import('fflate');
const { buildFaiZip } = await import('../src/fcstd/build-fai-zip.ts');
const built = buildFaiZip(unpacked.value, baseName + '.FCStd');
if (built.error || !built.result) {
  console.error('container build failed:', built.error);
  process.exit(1);
}
// inject the generated model script into model/
const members: Record<string, Uint8Array> = {};
const roundtrip = await import('fflate');
const srcEntries = roundtrip.unzipSync(built.result.zip);
for (const [k, v] of Object.entries(srcEntries)) members[k] = v;
members['model/main.fai.js'] = strToU8(gen.code);
// update mapping with translated dispositions
const mapping = built.result.mapping;
for (const o of gen.objects) {
  const entry = mapping.objects.find((e) => e.name === o.name);
  if (!entry) continue;
  entry.disposition = o.disposition;
  if (o.disposition !== 'translated' && o.reason) entry.reason = o.reason;
  if (o.sketch) {
    entry.sketch = {
      level: o.sketch.level === 'L0' ? 'solved' : o.sketch.level === 'L1' ? 'initial-value' : 'baked',
      reason: o.sketch.reason,
      gcs: o.sketch,
    };
  }
  if (o.disposition === 'translated' && !entry.artifacts.includes('model/main.fai.js')) {
    entry.artifacts.push('model/main.fai.js');
  }
}
members['mapping.json'] = strToU8(JSON.stringify(mapping, null, 2));

const finalZip = zipSync(members, { level: 6 });
writeFileSync(output, finalZip);

// report
const counts = { translated: 0, baked: 0, 'preserved-only': 0 };
for (const o of gen.objects) counts[o.disposition]++;
console.log(`wrote ${output} (${finalZip.length} bytes)`);
console.log(`objects: translated=${counts.translated} baked=${counts.baked} preserved-only=${counts['preserved-only']}`);
console.log(`sketches: L0=${[...sketchVerdict.values()].filter((v) => v.level === 'L0').length}`);
console.log('--- model/main.fai.js ---');
console.log(gen.code);
