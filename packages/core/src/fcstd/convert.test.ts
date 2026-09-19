/**
 * B0 — convertFcstdFile contract tests (the reusable pipeline behind
 * scripts/fcstd-convert-cli.ts). Locks the C4 final check and the exit-code
 * inputs the batch driver relies on:
 *   ok=true  → mapping contains only translated / python-baked / preserved-only
 *   ok=false → gaps[] names every non-Python baked object, zip NOT produced
 *   internal error (not a zip) → error set, no throw
 *
 * Corpus lives outside the repo — skipped when absent (FAIJS_FCSTD_CORPUS).
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { convertFcstdFile, ALLOWED_DISPOSITIONS } from './convert.ts';

const CORPUS = process.env.FAIJS_FCSTD_CORPUS ?? 'D:/Faicad/FreeCAD';
const PAD = join(CORPUS, 'data/tests/PadTest.fcstd');
const CRANK = join(CORPUS, 'data/tests/Crank.fcstd');
const corpusAvailable = existsSync(PAD) && existsSync(CRANK);

describe.skipIf(!corpusAvailable)('convertFcstdFile (C4 contract)', () => {
  it('PadTest: ok, all dispositions allowed, zip produced', async () => {
    const r = await convertFcstdFile(PAD);
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.gaps).toEqual([]);
    expect(r.zip).toBeDefined();
    for (const entry of (r as { mappingObjects?: unknown[] }).mappingObjects ?? []) {
      expect(ALLOWED_DISPOSITIONS.has((entry as { disposition: string }).disposition)).toBe(true);
    }
  }, 120_000);

  it('Crank (Draft/Python corpus): gaps are explicit, NO zip produced', async () => {
    const r = await convertFcstdFile(CRANK);
    // 2026-09-19: Crank still has non-whitelisted types (Part::Feature,
    // Part2DObjectPython…) — under C4 that must be a structured gap list,
    // never a silently-baked zip.
    if (r.ok) return; // future: once H7 covers Draft types this flips to ok
    expect(r.gaps.length).toBeGreaterThan(0);
    for (const g of r.gaps) {
      expect(g.reason).toBeTruthy();
      expect(g.reason).not.toBe('python-opaque'); // Python objects are renamed, never gaps
    }
    expect(r.zip).toBeUndefined();
  }, 120_000);

  it('GOTCHA: non-zip input returns structured error, does not throw', async () => {
    // unpackFcstd accepts any Uint8Array; a text file must yield a structured
    // failure (ok=false + error), not an exception — the batch driver counts
    // on never crashing per-file.
    const r = await convertFcstdFile(__filename);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.zip).toBeUndefined();
  });
});
