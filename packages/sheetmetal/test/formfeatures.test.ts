import type { Wire } from '../src/types.js';
import { describe, it, expect, beforeAll } from 'vitest';
import { initOCCT } from './setup.js';
import {isOk, isErr, unwrap, measureVolume, isValid, getSolids, getEdges, curveStartPoint} from '@faicad/faijs/api';

import { author } from '../src/api.js';
import { addTab, tabAndSlot } from '../src/tabFns.js';
import { louver, emboss } from '../src/formFns.js';
import { unfold } from '../src/unfoldFns.js';
import { fold, partToFlatInput } from '../src/foldFns.js';
import { flatPatternToDXF } from '../src/dxfFns.js';
import type { BendRule, FlatInput, SheetMetalPart } from '../src/types.js';

beforeAll(async () => {
  await initOCCT();
}, 30000);

const rule: BendRule = { innerRadius: 2, kFactor: 0.44 };
const T = 1;

async function basePart(length = 40, width = 40): Promise<SheetMetalPart> {
  return unwrap(await author({ thickness: T, base: { length, width }, flanges: [] }));
}

async function flangePart(): Promise<SheetMetalPart> {
  return unwrap(
    await author({
      thickness: T,
      base: { length: 40, width: 40 },
      flanges: [{ id: 'fy', length: 20, angleDeg: 90, rule, side: 'ymax' }],
    })
  );
}

function vol(part: SheetMetalPart): number {
  const solid = part.solid;
  if (solid === undefined) throw new Error('no solid');
  return measureVolume(solid);
}

function outlineBBox(wire: Wire): { x0: number; y0: number; x1: number; y1: number } {
  const pts = getEdges(wire).map((e) => curveStartPoint(e));
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1 };
}

/**
 * Closed-flag (group code 70) of the first LWPOLYLINE on the FORM layer in a DXF.
 * Walks the group-code/value pairs so it matches the polyline's own 70 — not the
 * FORM layer-table record's 70.
 */
function formCutPolylineClosedFlag(dxf: string): string | undefined {
  const lines = dxf.split('\n');
  let inFormPolyline = false;
  let onFormLayer = false;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i];
    const value = lines[i + 1];
    if (code === '0') {
      inFormPolyline = value === 'LWPOLYLINE';
      onFormLayer = false;
    } else if (inFormPolyline && code === '8') {
      onFormLayer = value === 'FORM';
    } else if (inFormPolyline && onFormLayer && code === '70') {
      return value;
    }
  }
  return undefined;
}

describe('addTab — additive protrusion', () => {
  it('raises the volume by ~width·length·thickness and stays a single valid body', async () => {
    const base = await basePart();
    const v0 = vol(base);
    const tabbed = await addTab(base, { region: 'base', side: 'xmax', offset: 10, width: 12, length: 8 });
    expect(isOk(tabbed)).toBe(true);
    if (!isOk(tabbed)) return;

    const rise = vol(tabbed.value) - v0;
    expect(rise).toBeCloseTo(12 * 8 * T, 4);

    const solid = tabbed.value.solid;
    expect(solid).toBeDefined();
    if (solid === undefined) return;
    expect(isValid(solid)).toBe(true);
    expect(getSolids(solid).length).toBe(1);
  });

  it('extends the developed outer outline past the base edge by the tab length', async () => {
    const base = await basePart(40, 40);
    const tabbed = unwrap(await addTab(base, { region: 'base', side: 'xmax', offset: 10, width: 12, length: 8 }));
    const pattern = unwrap(unfold(tabbed)).pattern;

    const bb = outlineBBox(pattern.outline);
    // The xmax tab pushes the outline's +X reach from 40 to 48.
    expect(bb.x1).toBeCloseTo(48, 3);
  });

  it('adds the tab area to the developed area', async () => {
    const base = await basePart(40, 40);
    const area0 = unwrap(unfold(base)).pattern.developedArea;
    const tabbed = unwrap(await addTab(base, { region: 'base', side: 'ymax', offset: 8, width: 10, length: 6 }));
    const area1 = unwrap(unfold(tabbed)).pattern.developedArea;
    expect(area1 - area0).toBeCloseTo(10 * 6, 4);
  });

  it('an xmin tab extends the outline into negative X by the tab length', async () => {
    const base = await basePart(40, 40);
    const tabbed = unwrap(await addTab(base, { region: 'base', side: 'xmin', offset: 10, width: 12, length: 8 }));
    const pattern = unwrap(unfold(tabbed)).pattern;
    const bb = outlineBBox(pattern.outline);
    expect(bb.x0).toBeCloseTo(-8, 3);
  });

  it('fuses a tab onto a folded flange edge (volume rises, solid valid)', async () => {
    const part = await flangePart();
    const v0 = vol(part);
    const tabbed = await addTab(part, { region: 'fy', side: 'xmax', offset: 5, width: 10, length: 6 });
    expect(isOk(tabbed)).toBe(true);
    if (!isOk(tabbed)) return;
    expect(vol(tabbed.value) - v0).toBeCloseTo(10 * 6 * T, 4);
    const solid = tabbed.value.solid;
    if (solid === undefined) return;
    expect(isValid(solid)).toBe(true);
    expect(getSolids(solid).length).toBe(1);
  });

  it('rejects a tab running past the edge length', async () => {
    const base = await basePart(40, 40);
    const oob = await addTab(base, { region: 'base', side: 'xmax', offset: 35, width: 10, length: 6 });
    expect(isErr(oob)).toBe(true);
    if (isErr(oob)) expect(oob.error.code).toBe('TAB_OUT_OF_BOUNDS');
  });

  it('rejects an unknown region', async () => {
    const base = await basePart();
    const bad = await addTab(base, { region: 'nope', side: 'xmax', offset: 0, width: 5, length: 5 });
    expect(isErr(bad)).toBe(true);
    if (isErr(bad)) expect(bad.error.code).toBe('UNKNOWN_REGION');
  });

  it('rejects a non-positive tab length', async () => {
    const base = await basePart();
    const bad = await addTab(base, { region: 'base', side: 'xmax', offset: 0, width: 5, length: 0 });
    expect(isErr(bad)).toBe(true);
    if (isErr(bad)) expect(bad.error.code).toBe('INVALID_TAB');
  });
});

describe('tabAndSlot — self-fixturing joint', async () => {
  it('places a tab on one region and a slot on the mating region; slot clears the tab', async () => {
    const tabWidth = 10;
    const clearance = 0.2;
    const part = await basePart(60, 40);
    const joined = await tabAndSlot(
      part,
      { region: 'base', side: 'xmax', offset: 15, width: tabWidth, length: 8 },
      { region: 'base', x: 30, y: 20, clearance }
    );
    expect(isOk(joined)).toBe(true);
    if (!isOk(joined)) return;

    // The tab is recorded, and exactly one slot cutout was punched.
    expect(joined.value.tabs?.length).toBe(1);
    expect(joined.value.cutouts?.length).toBe(1);

    // The slot opening must clear the tab cross-section + clearance on both axes.
    const slotSpec = joined.value.cutouts?.[0]?.spec;
    expect(slotSpec?.kind).toBe('slot');
    if (slotSpec?.kind !== 'slot') return;
    expect(slotSpec.length).toBeGreaterThan(tabWidth);
    expect(slotSpec.length).toBeCloseTo(tabWidth + clearance, 6);
    expect(slotSpec.width).toBeGreaterThan(T);
    expect(slotSpec.width).toBeCloseTo(T + clearance, 6);

    const solid = joined.value.solid;
    if (solid === undefined) return;
    expect(isValid(solid)).toBe(true);
    expect(getSolids(solid).length).toBe(1);
  });

  it('defaults clearance so the slot is still strictly larger than the tab', async () => {
    const part = await basePart(60, 40);
    const joined = unwrap(
      await tabAndSlot(
        part,
        { region: 'base', side: 'xmax', offset: 15, width: 10, length: 8 },
        { region: 'base', x: 30, y: 20 }
      )
    );
    const slotSpec = joined.cutouts?.[0]?.spec;
    if (slotSpec?.kind !== 'slot') throw new Error('expected slot');
    expect(slotSpec.length).toBeGreaterThan(10);
    expect(slotSpec.width).toBeGreaterThan(T);
  });

  it('threads the slot angleDeg through so the slot can be oriented to match the tab', async () => {
    const part = await basePart(60, 40);
    const joined = unwrap(
      await tabAndSlot(
        part,
        { region: 'base', side: 'xmax', offset: 15, width: 10, length: 8 },
        { region: 'base', x: 30, y: 20, angleDeg: 90 }
      )
    );
    const slotSpec = joined.cutouts?.[0]?.spec;
    if (slotSpec?.kind !== 'slot') throw new Error('expected slot');
    expect(slotSpec.angleDeg).toBe(90);
  });
});

describe('louver — formed vent', async () => {
  it('keeps a single valid solid and emits the U-cut + hinge in the flat pattern', async () => {
    const base = await basePart(60, 40);
    const formed = await louver(base, { region: 'base', x: 30, y: 20, length: 16, width: 8, height: 4 });
    expect(isOk(formed)).toBe(true);
    if (!isOk(formed)) return;

    const solid = formed.value.solid;
    expect(solid).toBeDefined();
    if (solid === undefined) return;
    expect(isValid(solid)).toBe(true);
    expect(getSolids(solid).length).toBe(1);

    const pattern = unwrap(unfold(formed.value)).pattern;
    expect(pattern.formCuts.length).toBe(1);
    expect(pattern.formHinges.length).toBe(1);

    // The cut is the OPEN three-side U (the hinge side is left uncut), so it has 3
    // segments, not the 4 a closed rectangle would have — a closed loop would tell
    // the fabricator to cut all four sides and drop the flap out.
    const cut = pattern.formCuts[0];
    if (cut === undefined) throw new Error('expected a form cut');
    expect(getEdges(cut).length).toBe(3);
  });

  it('emits the louver cut as an OPEN polyline (group 70=0) in the DXF', async () => {
    const base = await basePart(60, 40);
    const formed = unwrap(await louver(base, { region: 'base', x: 30, y: 20, length: 16, width: 8, height: 4 }));
    const pattern = unwrap(unfold(formed)).pattern;
    const dxf = unwrap(flatPatternToDXF(pattern));
    // The FORM-layer cut LWPOLYLINE must carry the open flag (70 / 0), so a CAM
    // reader does not auto-close the U and cut the hinge.
    expect(formCutPolylineClosedFlag(dxf)).toBe('0');
  });

  it('leaves the developed outline and area unchanged (forming is material-neutral)', async () => {
    const base = await basePart(60, 40);
    const before = unwrap(unfold(base)).pattern;
    const beforeBB = outlineBBox(before.outline);
    const formed = unwrap(await louver(base, { region: 'base', x: 30, y: 20, length: 16, width: 8, height: 4 }));
    const after = unwrap(unfold(formed)).pattern;
    const afterBB = outlineBBox(after.outline);

    expect(after.developedArea).toBeCloseTo(before.developedArea, 4);
    expect(afterBB.x0).toBeCloseTo(beforeBB.x0, 4);
    expect(afterBB.x1).toBeCloseTo(beforeBB.x1, 4);
    expect(afterBB.y0).toBeCloseTo(beforeBB.y0, 4);
    expect(afterBB.y1).toBeCloseTo(beforeBB.y1, 4);
  });

  it('writes the louver cut + hinge on the FORM layer of the DXF', async () => {
    const base = await basePart(60, 40);
    const formed = unwrap(await louver(base, { region: 'base', x: 30, y: 20, length: 16, width: 8, height: 4 }));
    const pattern = unwrap(unfold(formed)).pattern;
    const dxf = unwrap(flatPatternToDXF(pattern));
    expect(dxf).toContain('FORM');
  });

  it('forms a down-direction louver into a valid single solid', async () => {
    const base = await basePart(60, 40);
    const formed = await louver(base, { region: 'base', x: 30, y: 20, length: 16, width: 8, height: 4, direction: 'down' });
    expect(isOk(formed)).toBe(true);
    if (!isOk(formed)) return;
    const solid = formed.value.solid;
    if (solid === undefined) return;
    expect(isValid(solid)).toBe(true);
    expect(getSolids(solid).length).toBe(1);
  });

  it('rejects a louver out of region bounds', async () => {
    const base = await basePart(60, 40);
    const oob = await louver(base, { region: 'base', x: 58, y: 20, length: 16, width: 8, height: 4 });
    expect(isErr(oob)).toBe(true);
    if (isErr(oob)) expect(oob.error.code).toBe('FORM_OUT_OF_BOUNDS');
  });
});

describe('emboss / dimple — round formed bump', async () => {
  it('emboss fuses a raised bump: volume rises, solid valid, footprint marker present', async () => {
    const base = await basePart();
    const v0 = vol(base);
    const formed = await emboss(base, { region: 'base', x: 20, y: 20, diameter: 8, height: 2, kind: 'emboss' });
    expect(isOk(formed)).toBe(true);
    if (!isOk(formed)) return;

    expect(vol(formed.value)).toBeGreaterThan(v0);
    const solid = formed.value.solid;
    if (solid === undefined) return;
    expect(isValid(solid)).toBe(true);
    expect(getSolids(solid).length).toBe(1);

    const pattern = unwrap(unfold(formed.value)).pattern;
    expect(pattern.formMarkers.length).toBe(1);
    // Developed outline unchanged.
    const v1area = pattern.developedArea;
    expect(v1area).toBeCloseTo(unwrap(unfold(base)).pattern.developedArea, 4);
  });

  it('dimple cuts a shallow recess: volume drops, solid valid', async () => {
    const base = await basePart();
    const v0 = vol(base);
    const formed = await emboss(base, { region: 'base', x: 20, y: 20, diameter: 8, height: 0.4, kind: 'dimple' });
    expect(isOk(formed)).toBe(true);
    if (!isOk(formed)) return;
    expect(vol(formed.value)).toBeLessThan(v0);
    const solid = formed.value.solid;
    if (solid === undefined) return;
    expect(isValid(solid)).toBe(true);
    expect(getSolids(solid).length).toBe(1);
  });

  it('rejects a dimple deeper than the sheet thickness', async () => {
    const base = await basePart();
    const bad = await emboss(base, { region: 'base', x: 20, y: 20, diameter: 8, height: T + 1, kind: 'dimple' });
    expect(isErr(bad)).toBe(true);
    if (isErr(bad)) expect(bad.error.code).toBe('INVALID_FORM');
  });
});

describe('tab round-trip through fold', async () => {
  it('folds a FlatInput with a base tab into the same volume as addTab', async () => {
    const base = await basePart(40, 40);
    const tabSpec = { region: 'base' as const, side: 'xmax' as const, offset: 10, width: 12, length: 8 };
    const direct = unwrap(await addTab(base, tabSpec));

    const input: FlatInput = {
      thickness: T,
      baseLength: 40,
      width: 40,
      regions: [],
      baseTabs: [tabSpec],
    };
    const refolded = unwrap(await fold(input));
    expect(refolded.tabs?.length).toBe(1);
    expect(vol(refolded)).toBeCloseTo(vol(direct), 5);
  });

  it('carries a base tab through partToFlatInput so fold round-trips its volume', async () => {
    const base = await basePart(40, 40);
    const direct = unwrap(await addTab(base, { region: 'base', side: 'xmax', offset: 10, width: 12, length: 8 }));

    // partToFlatInput must recover the tab spec (not silently drop it); the base
    // length recovers as 40 even though the tab protrudes the outline to x=48.
    const recovered = unwrap(partToFlatInput(direct));
    expect(recovered.baseLength).toBeCloseTo(40, 3);
    expect(recovered.baseTabs?.length).toBe(1);

    const refolded = unwrap(await fold(recovered));
    expect(refolded.tabs?.length).toBe(1);
    expect(vol(refolded)).toBeCloseTo(vol(direct), 4);
  });

  it('carries a flange tab through partToFlatInput onto the recovered region', async () => {
    const part = await flangePart();
    const direct = unwrap(await addTab(part, { region: 'fy', side: 'xmax', offset: 5, width: 10, length: 6 }));

    const recovered = unwrap(partToFlatInput(direct));
    const regionWithTab = recovered.regions.find((r) => r.tabs !== undefined);
    expect(regionWithTab?.tabs?.length).toBe(1);

    const refolded = unwrap(await fold(recovered));
    expect(refolded.tabs?.length).toBe(1);
    expect(vol(refolded)).toBeCloseTo(vol(direct), 4);
  });
});

describe('form round-trip through fold', async () => {
  it('folds a FlatInput with a base emboss into the same volume as await emboss()', async () => {
    const base = await basePart();
    const embossSpec = { region: 'base' as const, x: 20, y: 20, diameter: 8, height: 2, kind: 'emboss' as const };
    const direct = unwrap(await emboss(base, embossSpec));

    const input: FlatInput = {
      thickness: T,
      baseLength: 40,
      width: 40,
      regions: [],
      baseForms: [{ kind: 'emboss', region: 'base', x: 20, y: 20, diameter: 8, height: 2, form: 'emboss' }],
    };
    const refolded = unwrap(await fold(input));
    expect(refolded.forms?.length).toBe(1);
    expect(vol(refolded)).toBeCloseTo(vol(direct), 5);
  });
});
