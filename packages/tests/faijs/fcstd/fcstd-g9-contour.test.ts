/**
 * M12.2b — G9 closure on a REAL corpus sample: Drilling_1.FCStd contains a
 * Sketcher sketch whose solver verdict is non-L0 (unsupported-constraint:
 * InternalAlignment x8, located by `fcstd-port/tools/locate-l1-sketches.ts`).
 * The converter must persist `assets/<Sketch>.contour.json` for it and
 * register the artifact in `mapping.json` — assets/ and mapping stay 1:1.
 *
 * 2026-09-20 — repointed from `scripts/fcstd-to-fai-zip.ts` (deleted; it was a
 * second implementation of the pipeline that predated the C4 audit) to
 * `convertFcstdFile`, the shipped pipeline. The switch is observable on this
 * very sample, which is the point: Drilling_1 has gaps (its L2 sketch starves
 * Pad/Pocket/Pattern), so under C4 the CLI refuses to write a container and the
 * contour assets would be unobservable — the old dev script wrote one anyway,
 * which is how this test stayed green against a pipeline that no longer ships.
 * The invariant is therefore checked through `keepGappedContainer`, a
 * diagnostics-only option (the CLI never sets it, `ok` stays false).
 *
 * Corpus lives outside the repo — skipped when absent (FAIJS_FCSTD_CORPUS).
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { convertFcstdFile } from '@faicad/faijs/fcstd-convert';

const CORPUS = process.env.FAIJS_FCSTD_CORPUS ?? 'D:/Faicad/FreeCAD';
const SAMPLE = join(CORPUS, 'src/Mod/CAM/CAMTests/Drilling_1.FCStd');

const sampleAvailable = existsSync(SAMPLE);

describe.skipIf(!sampleAvailable)('M12.2b contour.json on real non-L0 sample (requires corpus)', () => {
  it('Drilling_1: non-L0 sketch gets assets/<Sketch>.contour.json + mapping entry', async () => {
    const summary = await convertFcstdFile(SAMPLE, { keepGappedContainer: true });
    // C4 is unaffected by the diagnostics option: gapped document → ok=false.
    expect(summary.ok).toBe(false);
    expect(summary.gaps.length).toBeGreaterThan(0);
    expect(summary.zip, 'container available for inspection').toBeDefined();

    const members = unzipSync(summary.zip!);
    const mapping = JSON.parse(Buffer.from(members['mapping.json']!).toString('utf-8'));

    // the non-L0 sketch must have a concrete contour asset
    const contourAssets = mapping.objects
      .flatMap((o: { artifacts: string[] }) => o.artifacts)
      .filter((a: string) => a.endsWith('.contour.json'));
    expect(contourAssets.length, 'at least one non-L0 contour asset').toBeGreaterThan(0);

    for (const asset of contourAssets) {
      const entry = members[asset];
      expect(entry, `${asset} present in container`).toBeDefined();
      const parsed = JSON.parse(Buffer.from(entry!).toString('utf-8'));
      // GOTCHA: locate-l1-sketches.ts resolves external geometry (→ L1),
      // but the converter does NOT (M13.3 pending) — sketches with external
      // geometry pre-block to L2 'external-geometry', and Drilling_1's
      // Sketch carries InternalAlignment×8 (→ L2 'unsupported-constraint').
      // Assets persist either way; pin the real converter behavior.
      expect(['L1', 'L2']).toContain(parsed.level);
      expect(parsed.reason, 'downgrade reason recorded').toBeTruthy();
      expect(Array.isArray(parsed.geoms)).toBe(true);
      expect(parsed.geoms.length).toBeGreaterThan(0);
    }

    // assets/ members still match mapping artifacts 1:1 (G7 invariant
    // must hold with the new .contour.json entries included)
    const assetMembers = Object.keys(members).filter((p) => p.startsWith('assets/')).sort();
    const artifactAssets = mapping.objects
      .flatMap((o: { artifacts: string[] }) => o.artifacts)
      .filter((a: string) => a.startsWith('assets/'))
      .sort();
    expect(assetMembers).toEqual(artifactAssets);
  }, 180_000);
});
