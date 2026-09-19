/**
 * M7.2/M7.3 — FCStd port end-to-end golden: convert three corpus samples via
 * the real CLI script, then assert the generated `model/main.fai.js` passes
 * `check` with zero errors and executes under `--mode brep` (D-A: the port
 * output is BREP-chain-only; never rely on `auto`).
 *
 * Baseline (plan §6 M7 table; update explicitly with a written reason):
 *   PadTest.fcstd       translated=6  baked=4  preserved-only=3
 *     (2026-09-19 update: was 4/6 after M9 — but commit 0638a52 exported
 *      `faceRef` and wired UpToFace/UpToLast real translation, so Pad001 and
 *      Pad002 translate again instead of baking; manually verified: check
 *      zero errors and `run --mode brep` exports STEP.)
 *   Crank.fcstd         translated=0  baked=16 preserved-only=0
 *   ProjectTest.FCStd   translated=0  baked=1  preserved-only=0
 *
 * Corpus lives outside the repo — skipped when absent (FAIJS_FCSTD_CORPUS).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { cliCheck, cliRun } from '@faicad/faijs-core/node-host/cli';
import { createApiNamespace } from '@faicad/faijs-core/api/api-namespace';

const CORPUS = process.env.FAIJS_FCSTD_CORPUS ?? 'D:/Faicad/FreeCAD';
// __dirname = packages/tests/faijs/fcstd → repo root is 4 levels up
const REPO_ROOT = resolve(__dirname, '../../../..');
const CONVERTER = resolve(REPO_ROOT, 'packages/core/scripts/fcstd-to-fai-zip.ts');

const SAMPLES = [
  // 2026-09-19: UpToFace/UpToLast translated again (faceRef export, 0638a52)
  { file: 'data/tests/PadTest.fcstd', translated: 6, baked: 4, preservedOnly: 3 },
  { file: 'data/tests/Crank.fcstd', translated: 0, baked: 16, preservedOnly: 0 },
  { file: 'data/tests/ProjectTest.FCStd', translated: 0, baked: 1, preservedOnly: 0 },
] as const;

const corpusAvailable = SAMPLES.every((s) => existsSync(join(CORPUS, s.file)));

/** Convert one sample and return the unzipped container members. */
function convert(sample: string, outDir: string): Record<string, Uint8Array> {
  const zipPath = join(outDir, 'out.fai.zip');
  execFileSync(
    process.execPath,
    [join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs'), CONVERTER, join(CORPUS, sample), zipPath],
    { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 },
  );
  return unzipSync(new Uint8Array(readFileSync(zipPath)));
}

function text(members: Record<string, Uint8Array>, name: string): string {
  const entry = members[name];
  expect(entry, `${name} present in container`).toBeDefined();
  return Buffer.from(entry!).toString('utf-8');
}

describe.skipIf(!corpusAvailable)('FCStd port e2e (requires local corpus)', () => {
  it('converts each sample; script parses clean and brep-run succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fcstd-e2e-'));
    try {
      for (const s of SAMPLES) {
        const members = convert(s.file, dir);
        const mapping = JSON.parse(text(members, 'mapping.json'));
        const counts = { translated: 0, baked: 0, 'preserved-only': 0 };
        for (const o of mapping.objects) counts[o.disposition as keyof typeof counts]++;
        expect(counts.translated, `${s.file} translated`).toBe(s.translated);
        expect(counts.baked, `${s.file} baked`).toBe(s.baked);
        expect(counts['preserved-only'], `${s.file} preserved-only`).toBe(s.preservedOnly);

        // D-A: manifest must declare BREP-only execution
        const manifest = JSON.parse(text(members, 'manifest.json'));
        expect(manifest.requiresBrep).toBe(true);

        // M10.3: multi-Body samples emit model/<BodyName>.fai.js modules —
        // write ALL model scripts to disk so relative imports resolve.
        for (const [name, entry] of Object.entries(members)) {
          if (name.startsWith('model/') && name.endsWith('.fai.js')) {
            writeFileSync(join(dir, name.slice('model/'.length)), Buffer.from(entry).toString('utf-8'));
          }
        }

        const script = text(members, 'model/main.fai.js');
        // M7: the G1 regression — empty positional arg slot
        expect(script, `${s.file} no leading-comma args`).not.toContain('(, ');

        const jsPath = join(dir, 'main.fai.js');

        const check = cliCheck(jsPath);
        expect(check.errors, `${s.file} check errors`).toEqual([]);

        // M7.3: run --mode brep (explicit; never auto per D-A). cad namespace
        // is injected the same way faijs-cli.ts does (L3 api/ layer).
        // Samples with zero translated geometry (Crank/ProjectTest) produce a
        // script with no statements — nothing to export, run is not applicable.
        if (s.translated > 0) {
          const outPath = join(dir, 'out.step');
          const run = await cliRun(jsPath, outPath, { mode: 'brep', libs: { cad: createApiNamespace() } });
          expect(run.ok, `${s.file} run --mode brep: ${'error' in run ? run.error : ''}`).toBe(true);
          // Multi-terminal entries export to variant files (`out.step_0_<name>.step`);
          // accept the exact file or any sibling variant (GOTCHA: cli.ts §multiple
          // terminals writes `${outPath}_${i}_${name}.${ext}`, never plain out.step).
          const written = readdirSync(dir).some((f) => f === 'out.step' || f.startsWith('out.step_'));
          expect(written, `${s.file} STEP written`).toBe(true);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});
