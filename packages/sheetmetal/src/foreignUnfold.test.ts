import type { Solid, Face } from './types.js';
import { cylinder, translate } from './geometryOps.js';
import { describe, it, expect, beforeAll } from 'vitest';
import { initOCCT } from './test-setup.js';
import {sphere, getFaces, getSurfaceType} from '@faicad/faijs/api';
import {box, fuse} from '@faicad/faijs/api';

import { authorPart } from './authorFns.js';
import { unfold } from './unfoldFns.js';
import { fitCylinder, unfoldForeignSolid } from './foreignUnfoldFns.js';
import { fromSolid } from './facade.js';
import type { AuthorSpec } from './authorFns.js';

beforeAll(async () => {
  await initOCCT();
}, 30000);

const rule = { innerRadius: 2, kFactor: 0.5 };

function cylindricalFace(solid: Solid): Face | undefined {
  for (const f of getFaces(solid)) {
    const t = getSurfaceType(f);
    // OCCT re-parameterises exact cylinders to 'bspline' through applyMatrix /
    // booleans — both are cylindrical and fitCylinder accepts both.
    if (t.ok && (t.value === 'cylinder' || t.value === 'bspline')) return f;
  }
  return undefined;
}

describe('fitCylinder — accuracy vs a known primitive', () => {
  it('recovers radius and axis of an axis-aligned cylinder to high precision', async () => {
    const cyl = await cylinder(5, 20, { at: [1, 2, 3], axis: [0, 0, 1] });
    const face = cylindricalFace(cyl as Solid);
    expect(face).toBeDefined();
    if (face === undefined) return;

    const fit = fitCylinder(face);
    expect(fit).not.toBeNull();
    if (fit === null) return;

    expect(fit.radius).toBeCloseTo(5, 6);
    expect(Math.abs(fit.axisDir[2])).toBeCloseTo(1, 6);
    expect(fit.axisDir[0]).toBeCloseTo(0, 6);
    expect(fit.axisDir[1]).toBeCloseTo(0, 6);
    expect(fit.residual).toBeLessThan(1e-6);
  });

  it('recovers a tilted cylinder axis direction', async () => {
    const axis: [number, number, number] = [1, 1, 1];
    const cyl = await cylinder(3, 15, { at: [0, 0, 0], axis });
    const face = cylindricalFace(cyl as Solid);
    expect(face).toBeDefined();
    if (face === undefined) return;

    const fit = fitCylinder(face);
    expect(fit).not.toBeNull();
    if (fit === null) return;

    expect(fit.radius).toBeCloseTo(3, 5);
    const inv = 1 / Math.sqrt(3);
    // Axis direction up to sign.
    const aligned = Math.abs(fit.axisDir[0] * inv + fit.axisDir[1] * inv + fit.axisDir[2] * inv);
    expect(aligned).toBeCloseTo(1, 5);
  });

  it('returns null for a non-cylindrical (spherical) face', async () => {
    const sph = await sphere({ radius: 4, at: [0, 0, 0] });
    for (const f of getFaces(sph)) {
      expect(fitCylinder(f)).toBeNull();
    }
  });
});

describe('unfoldForeignSolid — author→solid→foreign-unfold oracle (reads only the solid)', () => {
  async function oracle(name: string, spec: AuthorSpec, expectedBends: number, expectedFlats: number): Promise<void> {
    const part = await authorPart(spec);
    expect(part.ok, `${name}: author`).toBe(true);
    if (!part.ok) return;
    const authored = unfold(part.value);
    expect(authored.ok, `${name}: authored unfold`).toBe(true);
    if (!authored.ok) return;
    const solid = part.value.solid;
    expect(solid).toBeDefined();
    if (solid === undefined) return;

    // The foreign path receives ONLY the solid — never part.bends / part.flanges.
    const foreign = await unfoldForeignSolid(solid, { kFactor: 0.5 });
    expect(foreign.ok, `${name}: foreign unfold`).toBe(true);
    if (!foreign.ok) return;

    // Developed area matches (both at K=0.5 mid-surface).
    expect(foreign.value.pattern.developedArea).toBeCloseTo(authored.value.pattern.developedArea, 2);
    // Bend count matches.
    expect(foreign.value.report.bends.length).toBe(expectedBends);
    expect(authored.value.report.bends.length).toBe(expectedBends);
    // Flat count matches (#bend lines == #non-root flats == #bends here).
    expect(foreign.value.pattern.bendLines.length).toBe(expectedFlats - 1);
    // Total flat bbox matches as a set of extents (axis labelling is arbitrary in a
    // foreign unfold), so compare the sorted (max, min) pair.
    const sortPair = (p: readonly [number, number]): [number, number] =>
      p[0] >= p[1] ? [p[0], p[1]] : [p[1], p[0]];
    const a = sortPair(authored.value.report.totalFlatSize);
    const f = sortPair(foreign.value.report.totalFlatSize);
    expect(f[0]).toBeCloseTo(a[0], 2);
    expect(f[1]).toBeCloseTo(a[1], 2);
    // Every detected bend is 90° with the authored inner radius.
    for (const b of foreign.value.report.bends) {
      expect(b.angleDeg).toBeCloseTo(90, 1);
      expect(b.radius).toBeCloseTo(2, 3);
    }
  }

  it('single 90° bend (one flat + one flange)', async () => {
    await oracle(
      'single',
      { thickness: 1, base: { length: 30, width: 10 }, flanges: [{ id: 'f1', length: 20, angleDeg: 90, rule }] },
      1,
      2
    );
  });

  it('L-bracket (two perpendicular flanges)', async () => {
    await oracle(
      'L',
      {
        thickness: 1,
        base: { length: 40, width: 40 },
        flanges: [
          { id: 'fx', length: 18, angleDeg: 90, rule, side: 'xmax' },
          { id: 'fy', length: 18, angleDeg: 90, rule, side: 'ymax' },
        ],
      },
      2,
      3
    );
  });

  it('U-channel (chain of two opposite flanges)', async () => {
    await oracle(
      'U',
      {
        thickness: 1,
        base: { length: 60, width: 30 },
        flanges: [
          { id: 'left', length: 18, angleDeg: 90, rule, side: 'xmin' },
          { id: 'right', length: 18, angleDeg: 90, rule, side: 'xmax' },
        ],
      },
      2,
      3
    );
  });
});

describe('unfoldForeignSolid — thickness detection', async () => {
  it('detects the sheet thickness and reproduces a thicker part', async () => {
    const part = await authorPart({
      thickness: 2,
      base: { length: 40, width: 20 },
      flanges: [{ id: 'f1', length: 15, angleDeg: 90, rule: { innerRadius: 3, kFactor: 0.5 } }],
    });
    expect(part.ok).toBe(true);
    if (!part.ok) return;
    const authored = unfold(part.value);
    const foreign = await unfoldForeignSolid(part.value.solid as Solid, { kFactor: 0.5 });
    expect(foreign.ok).toBe(true);
    if (!foreign.ok || !authored.ok) return;
    expect(foreign.value.pattern.developedArea).toBeCloseTo(authored.value.pattern.developedArea, 2);
  });
});

describe('unfoldForeignSolid — bend-direction detection', async () => {
  it('detects a down-fold flange as direction "down"', async () => {
    const part = await authorPart({
      thickness: 1,
      base: { length: 30, width: 12 },
      flanges: [{ id: 'f1', length: 16, angleDeg: 90, rule, direction: 'down' }],
    });
    expect(part.ok).toBe(true);
    if (!part.ok) return;
    const foreign = await unfoldForeignSolid(part.value.solid as Solid, { kFactor: 0.5 });
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;
    expect(foreign.value.report.bends).toHaveLength(1);
    expect(foreign.value.report.bends[0]?.direction).toBe('down');
  });

  it('detects an up-fold flange as direction "up"', async () => {
    const part = await authorPart({
      thickness: 1,
      base: { length: 30, width: 12 },
      flanges: [{ id: 'f1', length: 16, angleDeg: 90, rule, direction: 'up' }],
    });
    expect(part.ok).toBe(true);
    if (!part.ok) return;
    const foreign = await unfoldForeignSolid(part.value.solid as Solid, { kFactor: 0.5 });
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;
    expect(foreign.value.report.bends[0]?.direction).toBe('up');
  });
});

describe('unfoldForeignSolid — honest scope (no silently-wrong answer)', async () => {
  it('unfolds a plain box to a single bend-free panel (no spurious geometry)', async () => {
    const b = await box({ width: 20, depth: 20, height: 2 });
    const result = await unfoldForeignSolid(b as Solid, { kFactor: 0.5 });
    // A plain box pairs its top/bottom into a single flat and has no bends — a
    // single unfolded panel with no bends and no spurious geometry.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.report.bends).toHaveLength(0);
    expect(result.value.pattern.bendLines).toHaveLength(0);
  });

  it('errors clearly on a bare sphere (no planar panels)', async () => {
    const sph = await sphere({ radius: 5, at: [0, 0, 0] });
    const result = await unfoldForeignSolid(sph as Solid, { kFactor: 0.5 });
    // A sphere has no planar panels: the unfold fails clearly rather than inventing
    // a flat pattern.
    expect(result.ok).toBe(false);
  });

  it('warns UNSUPPORTED_FACE (does not silently mis-unfold) on a non-cylindrical curved face', async () => {
    // A normal bend part with a sphere fused on: SPHERE faces appear alongside the
    // planar panels and cylindrical bend. The unfold succeeds for the recognised
    // structure but flags each unrecognised face rather than mis-developing it.
    const part = await authorPart({
      thickness: 1,
      base: { length: 40, width: 20 },
      flanges: [{ id: 'f1', length: 15, angleDeg: 90, rule }],
    });
    expect(part.ok).toBe(true);
    if (!part.ok) return;
    const dome = await translate(await sphere({ radius: 3, at: [0, 0, 0] }), [20, 10, 0.5]);
    const fused = await fuse(part.value.solid as Solid, dome);

    const result = await unfoldForeignSolid(fused as Solid, { kFactor: 0.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The dedicated code lets a caller dispatch programmatically (not parse messages).
    expect(result.value.warnings.some((w) => w.code === 'UNSUPPORTED_FACE')).toBe(true);
    // It's a supported-class limit, not a corrupt B-rep.
    expect(result.value.warnings.some((w) => w.code === 'INVALID_SOLID')).toBe(false);
  });
});

describe('fromSolid facade', async () => {
  it('detects and unfolds via the fluent facade', async () => {
    const part = await authorPart({
      thickness: 1,
      base: { length: 30, width: 10 },
      flanges: [{ id: 'f1', length: 20, angleDeg: 90, rule }],
    });
    expect(part.ok).toBe(true);
    if (!part.ok) return;
    const result = fromSolid(part.value.solid as Solid).kFactor(0.5).unfold();
    expect(result.report.bends).toHaveLength(1);
    expect(result.pattern.developedArea).toBeGreaterThan(0);
  });
});
