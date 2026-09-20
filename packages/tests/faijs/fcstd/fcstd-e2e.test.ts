/**
 * M7.2/M7.3 — FCStd port end-to-end golden: convert corpus samples through the
 * published CLI (`src/fcstd/cli.ts`, the same entry the `faijs-fcstd-convert`
 * bin and the batch driver use), then assert the container contents and the
 * CLI exit contract.
 *
 * 2026-09-20 (written reason for the baseline change): the golden used to drive
 * `scripts/fcstd-to-fai-zip.ts`, a dev script that predated the C4 audit and
 * wrote a container unconditionally. That script is gone — one pipeline, one
 * implementation. The observable consequences of driving the real CLI:
 *   - PadTest dispositions: preserved-only 3 → 7 (the C4 audit reclassifies
 *     structural/datum `baked` entries as `preserved-only`; the object set and
 *     its geometry are unchanged).
 *   - Crank / ProjectTest: the C4 contract forbids a container while a
 *     non-Python object is baked, so these samples now assert **exit 2 + a gap
 *     list + no zip** instead of a zip. That is strictly more information than
 *     the old counts-only check, and it is the contract the batch driver reads.
 *
 * PadTest.fcstd: translated=6 preserved-only=7 (3 sketches, all L0 — solved).
 * Corpus lives outside the repo — skipped when absent (FAIJS_FCSTD_CORPUS).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { cliCheck, cliRun } from '@faicad/faijs/node-host/cli';
import { createApiNamespace } from '@faicad/faijs/api/api-namespace';

const CORPUS = process.env.FAIJS_FCSTD_CORPUS ?? 'D:/Faicad/FreeCAD';
// __dirname = packages/tests/faijs/fcstd → repo root is 4 levels up
const REPO_ROOT = resolve(__dirname, '../../../..');
const CLI = resolve(REPO_ROOT, 'packages/core/src/fcstd/cli.ts');
const TSX = resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

/** Converted sample: exit 0, container written, geometry runtimer-checkable. */
const CONVERTIBLE = {
  file: 'data/tests/PadTest.fcstd',
  counts: { translated: 6, pythonBaked: 0, preservedOnly: 7, baked: 0 },
  sketches: { total: 3, l0: 3, l1: 0, l2: 0 },
} as const;

/** Samples whose C4 audit reports gaps: exit 2, NO container. */
const GAPPED = [
  { file: 'data/tests/Crank.fcstd', gapTypes: ['Part::Feature', 'Part::Part2DObjectPython'] },
  { file: 'data/tests/ProjectTest.FCStd', gapTypes: ['App::InventorObject'] },
] as const;

const corpusAvailable = existsSync(join(CORPUS, CONVERTIBLE.file))
  && GAPPED.every((s) => existsSync(join(CORPUS, s.file)));

interface CliOutcome {
  status: number;
  summary: {
    ok: boolean;
    counts: Record<string, number>;
    sketches: Record<string, number>;
    gaps: { name: string; type: string; reason: string }[];
    error?: string;
  };
  stderr: string;
  zipPath: string;
}

/** Drive the CLI once; a non-zero exit code is a value, not a test failure. */
function runCli(sample: string, outDir: string): CliOutcome {
  const zipPath = join(outDir, 'out.fai.zip');
  rmSync(zipPath, { force: true });
  let status = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync(process.execPath, [TSX, CLI, join(CORPUS, sample), zipPath], {
      stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', timeout: 180_000,
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    status = err.status ?? -1;
    stdout = err.stdout ?? '';
    stderr = err.stderr ?? '';
  }
  return { status, summary: JSON.parse(stdout.trim()), stderr, zipPath };
}

function text(members: Record<string, Uint8Array>, name: string): string {
  const entry = members[name];
  expect(entry, `${name} present in container`).toBeDefined();
  return Buffer.from(entry!).toString('utf-8');
}

describe.skipIf(!corpusAvailable)('FCStd port e2e (requires local corpus)', () => {
  it('converts the translated sample; script parses clean and brep-run succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fcstd-e2e-'));
    try {
      const { status, summary, stderr, zipPath } = runCli(CONVERTIBLE.file, dir);
      // stdout carries exactly one JSON line; the documented contract is that a
      // successful run writes nothing to stderr.
      expect(stderr, 'CLI stderr on success').toBe('');
      expect(status, `${CONVERTIBLE.file} exit`).toBe(0);
      expect(summary.ok).toBe(true);
      expect(summary.gaps).toEqual([]);
      expect(summary.counts).toEqual(CONVERTIBLE.counts);
      expect(summary.sketches).toEqual(CONVERTIBLE.sketches);
      expect(existsSync(zipPath), 'container written').toBe(true);

      const members = unzipSync(new Uint8Array(readFileSync(zipPath)));
      const mapping = JSON.parse(text(members, 'mapping.json'));
      const counts = { translated: 0, baked: 0, 'preserved-only': 0 };
      for (const o of mapping.objects) counts[o.disposition as keyof typeof counts]++;
      expect(counts.translated, 'mapping.json translated').toBe(CONVERTIBLE.counts.translated);
      expect(counts['preserved-only'], 'mapping.json preserved-only').toBe(CONVERTIBLE.counts.preservedOnly);

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
      expect(script, `${CONVERTIBLE.file} no leading-comma args`).not.toContain('(, ');

      const jsPath = join(dir, 'main.fai.js');
      const check = cliCheck(jsPath);
      expect(check.errors, `${CONVERTIBLE.file} check errors`).toEqual([]);

      // M7.3: run --mode brep (explicit; never auto per D-A). cad namespace
      // is injected the same way faijs-cli.ts does (L3 api/ layer).
      const outPath = join(dir, 'out.step');
      const run = await cliRun(jsPath, outPath, { mode: 'brep', libs: { cad: createApiNamespace() } });
      expect(run.ok, `${CONVERTIBLE.file} run --mode brep: ${'error' in run ? run.error : ''}`).toBe(true);
      // Multi-terminal entries export to variant files (`out.step_0_<name>.step`);
      // accept the exact file or any sibling variant (GOTCHA: cli.ts §multiple
      // terminals writes `${outPath}_${i}_${name}.${ext}`, never plain out.step).
      const written = readdirSync(dir).some((f) => f === 'out.step' || f.startsWith('out.step_'));
      expect(written, `${CONVERTIBLE.file} STEP written`).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);

  it('reports translation gaps with exit 2 and writes no container', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fcstd-e2e-gap-'));
    try {
      for (const s of GAPPED) {
        const { status, summary, stderr, zipPath } = runCli(s.file, dir);
        expect(stderr, `${s.file} stderr`).toBe('');
        expect(status, `${s.file} exit (gaps)`).toBe(2);
        expect(summary.ok).toBe(false);
        expect(summary.error).toBeUndefined();
        expect(summary.gaps.length).toBeGreaterThan(0);
        for (const g of summary.gaps) {
          // Python-opaque objects are renamed to python-baked by the audit,
          // never surfaced as gaps (C4).
          expect(g.reason).not.toBe('python-opaque');
          expect(g.reason).toBeTruthy();
        }
        const types = new Set(summary.gaps.map((g) => g.type));
        for (const t of s.gapTypes) expect(types, `${s.file} gap types`).toContain(t);
        expect(existsSync(zipPath), `${s.file} no container`).toBe(false);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});
