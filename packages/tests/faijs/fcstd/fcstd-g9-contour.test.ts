/**
 * M12.2b — G9 closure on a REAL corpus sample: Drilling_1.FCStd contains a
 * Sketcher sketch whose solver verdict is L1 (unsupported-constraint:
 * InternalAlignment x8, located by scripts/locate-l1-sketches.ts). The
 * converter must persist assets/<Sketch>.contour.json for it and register
 * the artifact in mapping.json — assets/ and mapping stay 1:1.
 *
 * Corpus lives outside the repo — skipped when absent (FAIJS_FCSTD_CORPUS).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';

const CORPUS = process.env.FAIJS_FCSTD_CORPUS ?? 'D:/Faicad/FreeCAD';
const REPO_ROOT = resolve(__dirname, '../../../..');
const CONVERTER = resolve(REPO_ROOT, 'packages/core/scripts/fcstd-to-fai-zip.ts');
const SAMPLE = join(CORPUS, 'src/Mod/CAM/CAMTests/Drilling_1.FCStd');

const sampleAvailable = existsSync(SAMPLE);

describe.skipIf(!sampleAvailable)('M12.2b contour.json on real L1 sample (requires corpus)', () => {
  it('Drilling_1: L1 sketch gets assets/<Sketch>.contour.json + mapping entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fcstd-g9-'));
    try {
      const zipPath = join(dir, 'out.fai.zip');
      execFileSync(
        process.execPath,
        [join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs'), CONVERTER, SAMPLE, zipPath],
        { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 },
      );
      const members = unzipSync(new Uint8Array(readFileSync(zipPath)));
      const mapping = JSON.parse(Buffer.from(members['mapping.json']!).toString('utf-8'));

      // the L1 sketch must have a concrete contour asset
      const contourAssets = mapping.objects
        .flatMap((o: { artifacts: string[] }) => o.artifacts)
        .filter((a: string) => a.endsWith('.contour.json'));
      expect(contourAssets.length, 'at least one L1/L2 contour asset').toBeGreaterThan(0);

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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
