// M12.3 — V6 geometric fidelity: faijs recomputation vs the FCStd original.
//
// Inputs:
//   <original.FCStd>            the source document (baked .brp members are
//                               the ground-truth BREP solids)
//   <reexported.step>           STEP exported from the faijs-rebuilt model
//                               (e.g. via `faijs-cli run --mode brep --out x.step`)
//
// Metrics (all computed from TRIANGULATED meshes — never kernel.getVolume,
// which uses BRepGProp exact integration and aliases against mesh-based
// comparisons; see MEMORY.md pitfall):
//   - mesh volume (divergence theorem over triangles)
//   - mesh centroid (volume-weighted)
//   - bbox diagonal
// Report: relative volume error, centroid distance, bbox diagonal delta.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { unzipSync } from 'fflate';
import { initOcctWasm } from '../src/occt-kernel/occtKernel.ts';
import { importStepToMesh } from '../src/occt-kernel/occtKernel.ts';

interface Metrics { volume: number; centroid: [number, number, number]; bboxDiag: number }

/** Signed volume of a triangle soup (divergence theorem); robust for closed meshes. */
function meshMetrics(positions: Float32Array, indices: Uint32Array): Metrics {
  let vol6 = 0;
  const c = [0, 0, 0];
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let t = 0; t < indices.length; t += 3) {
    const i = indices[t]! * 3, j = indices[t + 1]! * 3, k = indices[t + 2]! * 3;
    const ax = positions[i]!, ay = positions[i + 1]!, az = positions[i + 2]!;
    const bx = positions[j]!, by = positions[j + 1]!, bz = positions[j + 2]!;
    const cx = positions[k]!, cy = positions[k + 1]!, cz = positions[k + 2]!;
    // 6 * signed tetra volume with origin
    const d = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    vol6 += d;
    // volume-weighted tetra centroid: tetra = (origin,a,b,c), centroid
    // (a+b+c)/4; C = Σ d·(a+b+c) / (4·vol6) — accumulate ONCE per triangle.
    c[0] += d * (ax + bx + cx);
    c[1] += d * (ay + by + cy);
    c[2] += d * (az + bz + cz);
    minX = Math.min(minX, ax, bx, cx); minY = Math.min(minY, ay, by, cy); minZ = Math.min(minZ, az, bz, cz);
    maxX = Math.max(maxX, ax, bx, cx); maxY = Math.max(maxY, ay, by, cy); maxZ = Math.max(maxZ, az, bz, cz);
  }
  const volume = vol6 / 6;
  // C = Σ d·(a+b+c) / (4 · vol6) — but each (a,b,c) was added once per axis
  // with the SAME d, so divide the accumulated sum by 4·vol6.
  const centroid: [number, number, number] =
    Math.abs(vol6) > 0 ? [c[0] / (4 * vol6), c[1] / (4 * vol6), c[2] / (4 * vol6)] : [0, 0, 0];
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  return { volume: Math.abs(volume), centroid, bboxDiag: diag };
}

async function main(): Promise<void> {
  const [fcstdPath, stepPath] = process.argv.slice(2);
  if (!fcstdPath || !stepPath) {
    console.error('usage: tsx verify-geometry.ts <original.FCStd> <reexported.step>');
    process.exit(1);
  }
  const kernel = await initOcctWasm() as never as {
    fromBREP: (s: string) => unknown;
    tessellate: (shape: unknown, deflection: number) => { positions: Float32Array; indices: Uint32Array };
    importStep: (text: string) => { shape: unknown; meshes: { positions: Float32Array; indices: Uint32Array }[] };
  };

  // ground truth: the FCStd Body Tip's final solid (NOT the sum of all .brp
  // members — those include intermediate features that overlap; the Tip is
  // the document's final geometry, exactly what the rebuilt model exports).
  const zip = unzipSync(new Uint8Array(readFileSync(fcstdPath)));
  const docXml = Buffer.from(zip['Document.xml']!).toString('utf-8');
  const tipObj = /<Property name="Tip"[^>]*>\s*<Link value="([^"]+)"/.exec(docXml)?.[1];
  if (!tipObj) {
    console.error('no PartDesign::Body Tip found in Document.xml');
    process.exit(1);
  }
  // The Tip object's `Shape` property references its .brp member. GOTCHA: a
  // PartDesign feature carries BOTH `AddShape` (the feature's own additive
  // contribution) and `Shape` (the final fused result) as PropertyPartShape —
  // they are different .brp files. Taking the FIRST `file="...brp"` in the
  // object block (alphabetical property order puts `AddShape` first) silently
  // compares against the wrong solid (PadTest: AddShape diag 81.01 vs Shape
  // diag 159.35). Always select the `Shape` property explicitly.
  const tipRe = new RegExp(`<Object name="${tipObj}">(.*?)</Object>`, 's');
  const tipBlock = tipRe.exec(docXml)?.[1] ?? '';
  const tipBrp = /<Property name="Shape"[^>]*>\s*<Part file="([^"]+\.brp)"/.exec(tipBlock)?.[1];
  if (!tipBrp) {
    console.error(`Tip "${tipObj}" has no .brp shape member`);
    process.exit(1);
  }
  const tipText = Buffer.from(zip[tipBrp] ?? new Uint8Array()).toString('utf-8');
  let truth: Metrics | null = null;
  const text = tipText;
  if (text.includes('CASCADE Topology V1')) {
    try {
      const shape = kernel.fromBREP(text);
      const mesh = kernel.tessellate(shape, 0.01);
      if (mesh.indices.length > 0) {
        truth = meshMetrics(mesh.positions, mesh.indices);
      }
    } catch { /* unmeshable tip */ }
  }

  // recomputation: the STEP the faijs product exported
  const stepBytes = readFileSync(stepPath);
  const imp = await importStepToMesh(new Uint8Array(stepBytes), { linearDeflection: 0.01 });
  let rebuilt: Metrics | null = null;
  for (const mesh of imp.meshes) {
    const m = meshMetrics(mesh.positions, mesh.indices);
    if (!rebuilt) rebuilt = m; else {
      rebuilt = {
        volume: rebuilt.volume + m.volume,
        centroid: [0, 0, 0],
        bboxDiag: Math.max(rebuilt.bboxDiag, m.bboxDiag),
      };
    }
  }

  if (!truth || !rebuilt) {
    console.error(`no geometry: truth=${truth ? 'tip ok' : 'none'} rebuiltMeshes=${imp.meshes.length}`);
    process.exit(1);
  }
  const relVol = Math.abs(rebuilt.volume - truth.volume) / Math.abs(truth.volume || 1);
  const diagDelta = Math.abs(rebuilt.bboxDiag - truth.bboxDiag);
  const cd = Math.hypot(rebuilt.centroid[0] - truth.centroid[0], rebuilt.centroid[1] - truth.centroid[1], rebuilt.centroid[2] - truth.centroid[2]);
  console.log(`file: ${basename(fcstdPath)}  truth=<Tip:${tipObj}>`);
  console.log(`volume  (mesh): truth=${truth.volume.toFixed(3)} rebuilt=${rebuilt.volume.toFixed(3)} relErr=${(relVol * 100).toFixed(4)}%`);
  console.log(`bboxDiag:       truth=${truth.bboxDiag.toFixed(3)} rebuilt=${rebuilt.bboxDiag.toFixed(3)} delta=${diagDelta.toFixed(6)}`);
  console.log(`centroid dist:  ${cd.toFixed(6)}`);
  // gate (V6 threshold): relative volume error within 1% (triangulation noise
  // dominates below this at deflection 0.01)
  const pass = relVol < 0.01 && diagDelta < 0.5;
  console.log(pass ? 'V6: PASS' : 'V6: FAIL');
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
