/**
 * fcstd-port B0 — reusable FCStd → .fai.zip conversion (extracted from
 * scripts/fcstd-to-fai-zip.ts so the batch CLI and the dev script share one
 * pipeline). Returns a structured summary; the caller decides exit codes and
 * output formatting (C4: batch driver must never absorb failures).
 *
 * Dispositions (plan §2, C4): translated | python-baked | preserved-only.
 * Any other baked reason = translation gap → result.ok = false, no zip
 * written (final check `auditMapping`).
 */
import { readFileSync } from 'node:fs';
import { unpackFcstd, memberText } from './unpack.ts';
import { parseDocumentXml } from './document.ts';
import { parseSketchObject } from './sketch-parse.ts';
import { createPlanegcsSolver } from './planegcs-backend.ts';
import { classifySketch } from './sketch-verify.ts';
import { resolveExternalGeometry } from './external-geo.ts';
import { extractContours } from './contour.ts';
import type { Contour } from './contour.ts';
import { generateModel } from './codegen.ts';
import { placementOf, type Placement } from './placement.ts';
import { buildFaiZip } from './build-fai-zip.ts';
import { isOk } from '../vendored/brepjs/core/result.ts';
import { zipSync, unzipSync, strToU8 } from 'fflate';

/** V2 tolerance: solver must reproduce stored geometry (single source). */
export const SKETCH_T1 = 1e-6;

/** Dispositions allowed in a conforming container (C4). */
export const ALLOWED_DISPOSITIONS = new Set(['translated', 'python-baked', 'preserved-only']);

export interface ConvertSummary {
  file: string;
  /** conversion succeeded AND mapping final check passed */
  ok: boolean;
  /** translation gaps (non-Python baked) — empty when ok */
  gaps: { name: string; type: string; reason: string }[];
  counts: { translated: number; pythonBaked: number; preservedOnly: number; baked: number };
  sketches: { total: number; l0: number; l1: number; l2: number };
  /** container bytes (undefined when ok=false: no zip produced) */
  zip?: Uint8Array;
  /** human-readable failure when the pipeline itself failed */
  error?: string;
  elapsedMs: number;
}

/** Non-modeling structural/datum types: never translation gaps. They carry
 * no feature semantics (containers, datum planes/lines/origins, groups) —
 * their semantics are consumed by the translator (Body.Group ordering,
 * datum-plane UpToFace anchors), not emitted as cad calls. */
const STRUCTURAL_TYPES = new Set([
  'PartDesign::Body', 'App::Origin', 'App::Plane', 'App::Line',
  'App::DocumentObjectGroup', 'App::Part', 'PartDesign::Plane', 'PartDesign::Line',
  'PartDesign::CoordinateSystem',
]);

/**
 * C4 final check: reclassify `baked` entries. A baked disposition is only
 * legitimate for Python-opaque objects (python-baked), structural/datum
 * containers (preserved-only), or preserved display members. Everything
 * else is a translation gap.
 */
function auditMapping(
  mapping: { objects: { name: string; type: string; disposition: string; reason?: string }[] },
): ConvertSummary['gaps'] {
  const gaps: ConvertSummary['gaps'] = [];
  for (const o of mapping.objects) {
    if (o.disposition === 'baked') {
      // python-opaque stays legitimate but is renamed for the ledger
      if (o.reason === 'python-opaque') {
        o.disposition = 'python-baked';
      } else if (STRUCTURAL_TYPES.has(o.type)) {
        o.disposition = 'preserved-only';
        o.reason = o.reason ?? 'structural';
      } else {
        gaps.push({ name: o.name, type: o.type, reason: o.reason ?? 'unspecified' });
      }
    }
  }
  return gaps;
}

export async function convertFcstdFile(input: string): Promise<ConvertSummary> {
  const t0 = Date.now();
  const baseName = input.replace(/^.*[/\\]/, '').replace(/\.fcstd$/i, '');
  const fail = (error: string): ConvertSummary => ({
    file: input, ok: false, gaps: [],
    counts: { translated: 0, pythonBaked: 0, preservedOnly: 0, baked: 0 },
    sketches: { total: 0, l0: 0, l1: 0, l2: 0 }, error, elapsedMs: Date.now() - t0,
  });

  let raw: Uint8Array;
  try {
    raw = new Uint8Array(readFileSync(input));
  } catch (e) {
    return fail(`read failed: ${(e as Error).message}`);
  }
  const unpacked = unpackFcstd(raw);
  if (!isOk(unpacked)) return fail(`unpack failed: ${JSON.stringify(unpacked.error)}`);
  const xml = memberText(unpacked.value, 'Document.xml');
  if (xml === undefined) return fail('Document.xml missing');
  const doc = parseDocumentXml(xml);
  if (!isOk(doc)) return fail(`parse failed: ${doc.error.message}`);

  // M3: solve every sketch (same pipeline as the dev script)
  const solver = await createPlanegcsSolver();
  const sketchVerdict = new Map<string, { level: 'L0' | 'L1' | 'L2'; reason?: string; loopCount?: number }>();
  const sketchContours = new Map<string, Contour[]>();
  for (const obj of doc.value.objects) {
    if (obj.type !== 'Sketcher::SketchObject') continue;
    const sk = parseSketchObject(obj.properties.get('Geometry'), obj.properties.get('Constraints'), false);
    const offPlane = sk.geoms.some((g) => {
      const zs = g.kind === 'point' ? [g.z]
        : g.kind === 'line' ? [g.z1, g.z2]
        : [g.cz];
      return zs.some((z) => Math.abs(z) > 1e-9);
    });
    const preBlocked =
      offPlane ? 'sketch-geometry-off-plane'
      : sk.geoms.some((g) => !Number.isFinite((g as { x?: number }).x ?? 0)) ? 'unsupported-geometry'
      : undefined;
    if (preBlocked) {
      sketchVerdict.set(obj.name, { level: 'L2', reason: preBlocked });
      continue;
    }
    let external: { geoId: number; polyline: [number, number][] }[] | undefined;
    if (sk.externalGeoIds.length > 0) {
      const ext = await resolveExternalGeometry(
        obj.properties.get('ExternalGeometry'), doc.value, unpacked.value, obj.properties.get('Placement'),
      );
      const usable = ext.links.filter((l) => l.polyline.length === 2);
      if (usable.length === 0) {
        sketchVerdict.set(obj.name, {
          level: 'L2',
          reason: `external-geometry-unresolved: ${ext.failures[0]?.reason ?? 'no links'}`,
        });
        continue;
      }
      external = usable.map((l, i) => ({ geoId: -3 - i, polyline: l.polyline }));
    }
    try {
      const r = await solver.solve(sk.geoms, sk.constraints, external);
      if (!isOk(r)) {
        sketchVerdict.set(obj.name, { level: 'L2', reason: 'solver-error' });
        continue;
      }
      const verdict = classifySketch(r.value, sk.geoms, SKETCH_T1);
      const contours = verdict.level === 'L0' ? extractContours(r.value.geoms) : [];
      sketchVerdict.set(obj.name, { ...verdict, loopCount: contours.length });
      if (verdict.level === 'L0') sketchContours.set(obj.name, contours);
    } catch (e) {
      sketchVerdict.set(obj.name, { level: 'L2', reason: `solver-throw: ${(e as Error).message.slice(0, 60)}` });
    }
  }

  // M4/M5: translate + codegen
  const placements = new Map<string, Placement>();
  for (const obj of doc.value.objects) {
    placements.set(obj.name, placementOf(obj));
  }
  let gen;
  try {
    gen = generateModel(doc.value, sketchVerdict, sketchContours, baseName, placements);
  } catch (e) {
    return fail(`codegen failed: ${(e as Error).message}`);
  }

  // M2: container with shadow, then inject model/ + updated mapping
  const built = buildFaiZip(unpacked.value, baseName + '.FCStd');
  if (built.error || !built.result) return fail(`container build failed: ${built.error?.message ?? 'unknown'}`);
  const members: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(unzipSync(built.result.zip))) members[k] = v;
  members['model/main.fai.js'] = strToU8(gen.code);
  for (const f of gen.files) members[f.path] = strToU8(f.code);

  const mapping = built.result.mapping;
  for (const o of gen.objects) {
    const entry = mapping.objects.find((e) => e.name === o.name);
    if (!entry) continue;
    entry.disposition = o.disposition;
    if (o.reason) entry.reason = o.reason;
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

  // M11.4 (G9): L1/L2 sketches persist raw geometry as a contour asset
  for (const obj of doc.value.objects) {
    if (obj.type !== 'Sketcher::SketchObject') continue;
    const verdict = sketchVerdict.get(obj.name);
    if (!verdict || verdict.level === 'L0') continue;
    const sk = parseSketchObject(obj.properties.get('Geometry'), obj.properties.get('Constraints'), false);
    const asset = {
      sketch: obj.name,
      level: verdict.level,
      reason: verdict.reason,
      geoms: sk.geoms,
      constraints: sk.constraints.map((c) => ({ index: c.index, type: c.type, refs: c.refs, value: c.value, isDriving: c.isDriving })),
    };
    const path = `assets/${obj.name}.contour.json`;
    members[path] = strToU8(JSON.stringify(asset, null, 2));
    const entry = mapping.objects.find((e) => e.name === obj.name);
    if (entry && !entry.artifacts.includes(path)) entry.artifacts.push(path);
  }

  // C4 final check: reclassify python-opaque; everything else baked = gap
  const gaps = auditMapping(mapping);
  members['mapping.json'] = strToU8(JSON.stringify(mapping, null, 2));

  const counts = { translated: 0, pythonBaked: 0, preservedOnly: 0, baked: 0 };
  for (const o of mapping.objects) {
    if (o.disposition === 'translated') counts.translated++;
    else if (o.disposition === 'python-baked') counts.pythonBaked++;
    else if (o.disposition === 'preserved-only') counts.preservedOnly++;
    else counts.baked++;
  }
  const sketches = { total: sketchVerdict.size, l0: 0, l1: 0, l2: 0 };
  for (const v of sketchVerdict.values()) sketches[v.level.toLowerCase() as 'l0' | 'l1' | 'l2']++;

  if (gaps.length > 0) {
    // C4: translation gaps → no container produced (exit contract: 2)
    return { file: input, ok: false, gaps, counts, sketches, elapsedMs: Date.now() - t0 };
  }

  const zip = zipSync(members, { level: 6 });
  return { file: input, ok: true, gaps, counts, sketches, zip, elapsedMs: Date.now() - t0 };
}
