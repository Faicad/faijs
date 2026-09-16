/**
 * M5 tests — dependency ordering (M5.1), code lowering (M5.2), statement
 * ids sN / variables partN, and multi-root grouping.
 */
import { describe, it, expect } from 'vitest';
import { generateModel } from './codegen.js';
import type { FcstdDocument, FcstdObject } from './document.js';

function prop(name: string, childAttrs: Record<string, string>, childTag = 'Link'): [string, { name: string; type: string; tagName: string; children: never[]; valueXml: string; valueText: string; attributes: Record<string, string> }, Record<string, string>] {
  return [name, { name, type: '', tagName: childTag, children: [], valueXml: '', valueText: '', attributes: childAttrs }, {}] as never;
}

function simpleObj(type: string, name: string, props: Record<string, Record<string, string>> = {}): FcstdObject {
  const properties = new Map(
    Object.entries(props).map(([k, attrs]) => [
      k,
      {
        name: k,
        type: '',
        tagName: 'Property',
        children: [{ name: 'Link', type: '', tagName: 'Link', children: [], valueXml: '', valueText: '', attributes: attrs }],
        valueXml: '',
        valueText: '',
        attributes: {},
      } as never,
    ]),
  );
  return { type, name, properties };
}

describe('M5 codegen', () => {
  it('orders Box → Cut in dependency order and lowers to sN/partN', () => {
    const doc: FcstdDocument = {
      objects: [
        // deliberately out of dependency order: Cut first
        simpleObj('Part::Cut', 'Cut', { Base: { value: 'Box' }, Tool: { value: 'Cyl' } }),
        simpleObj('Part::Box', 'Box', {}),
        simpleObj('Part::Cylinder', 'Cyl', {}),
        simpleObj('App::Origin', 'Origin', {}),
      ],
      typeIndex: new Map(),
      meta: new Map(),
    };
    const result = generateModel(doc, new Map(), 'test');
    expect(result.calls.map((c) => c.op)).toEqual(['cad.box', 'cad.cylinder', 'cad.subtract']);
    expect(result.calls[2]!.inputs).toEqual(['part0', 'part1']);
    expect(result.code).toContain('let part0 = cad.box(');
    expect(result.code).toContain('s0');
    expect(result.code).toContain('part2');
    // Origin preserved-only
    const origin = result.objects.find((o) => o.name === 'Origin');
    expect(origin).toMatchObject({ disposition: 'preserved-only' });
  });

  it('bakes sketches without verdicts; sketch variables do not reach the script surface', () => {
    const doc: FcstdDocument = {
      objects: [
        simpleObj('Sketcher::SketchObject', 'Sketch', {}),
        simpleObj('PartDesign::Pad', 'Pad', { Profile: { value: 'Sketch' }, Length: { value: '10' } }),
      ],
      typeIndex: new Map(),
      meta: new Map(),
    };
    // no verdict → sketch baked, Pad can't resolve profile → baked
    const r1 = generateModel(doc, new Map(), 't');
    const pad1 = r1.objects.find((o) => o.name === 'Pad');
    expect(pad1).toMatchObject({ disposition: 'baked' });

    // L0 verdict: sketch is recorded (D1) but the script surface has no
    // sketch declaration syntax yet (M6) — Pad profile stays unresolvable.
    const r2 = generateModel(doc, new Map([['Sketch', { level: 'L0', loopCount: 1 }]]), 't');
    const sketch2 = r2.objects.find((o) => o.name === 'Sketch');
    expect(sketch2).toMatchObject({ disposition: 'translated' });
    const pad2 = r2.objects.find((o) => o.name === 'Pad');
    expect(pad2).toMatchObject({ disposition: 'baked', reason: 'pad-missing-profile' });
    expect(r2.code).not.toContain('cad.fai_extrude');
  });

  it('groups multiple roots via cad.group', () => {
    const doc: FcstdDocument = {
      objects: [simpleObj('Part::Box', 'A', {}), simpleObj('Part::Box', 'B', {})],
      typeIndex: new Map(),
      meta: new Map(),
    };
    const r = generateModel(doc, new Map(), 't');
    expect(r.code).toContain('cad.group({ members: [part0, part1] })');
  });

  it('emits Pocket as two calls when base solid resolves; sketches stay out of script surface', () => {
    const doc: FcstdDocument = {
      objects: [
        simpleObj('Sketcher::SketchObject', 'Sketch', {}),
        simpleObj('PartDesign::Pad', 'Pad', { Profile: { value: 'Sketch' }, Length: { value: '10' } }),
        simpleObj('Sketcher::SketchObject', 'Sketch001', {}),
        simpleObj('PartDesign::Pocket', 'Pocket', { Profile: { value: 'Sketch001' }, BaseFeature: { value: 'Pad' }, Length: { value: '5' } }),
      ],
      typeIndex: new Map(),
      meta: new Map(),
    };
    const verdicts = new Map([
      ['Sketch', { level: 'L0' as const, loopCount: 1 }],
      ['Sketch001', { level: 'L0' as const, loopCount: 1 }],
    ]);
    const r = generateModel(doc, verdicts, 't');
    // sketch contours are recorded (D1) but not yet wired to the cad face
    // (M6) — both Pad and Pocket degrade to baked with reasons.
    const pad = r.objects.find((o) => o.name === 'Pad');
    const pocket = r.objects.find((o) => o.name === 'Pocket');
    expect(pad).toMatchObject({ disposition: 'baked', reason: 'pad-missing-profile' });
    expect(pocket).toMatchObject({ disposition: 'baked', reason: 'pocket-missing-dependency' });
    expect(r.code).not.toContain('cad.fai_extrude');
  });
});
