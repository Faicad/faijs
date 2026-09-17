/**
 * M5 tests — dependency ordering (M5.1), code lowering (M5.2), statement
 * ids sN / variables partN, multi-root grouping, and M6 sketch→cad.sketch
 * wiring (Pad/Pocket become real cad.extrude / cad.subtract calls).
 */
import { describe, it, expect } from 'vitest';
import { generateModel } from './codegen.js';
import type { Contour } from './contour.js';
import type { FcstdDocument, FcstdObject, FcstdProperty } from './document.js';

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

/** An App::PropertyLinkSub (with `<Sub>` children) as FreeCAD saves it. */
function withLinkSub(obj: FcstdObject, name: string, target: string, subs: string[]): FcstdObject {
  const linkSub: FcstdProperty = {
    name: 'LinkSub',
    type: '',
    tagName: 'LinkSub',
    children: subs.map((s) => ({
      name: 'Sub', type: '', tagName: 'Sub', children: [], valueXml: '', valueText: '', attributes: { value: s },
    })),
    valueXml: '',
    valueText: '',
    attributes: { value: target, count: String(subs.length) },
  };
  obj.properties.set(name, {
    name, type: 'App::PropertyLinkSub', tagName: 'Property',
    children: [linkSub], valueXml: '', valueText: '', attributes: {},
  });
  return obj;
}

/** A unit square contour (closed loop of 4 lines) used for sketch wiring. */
function square(): Contour[] {
  return [{
    closed: true,
    segments: [
      { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
      { kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
      { kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 },
    ],
  }];
}

/** Empty contour map (no sketch wired). */
const NO_CONTOURS = new Map<string, Contour[]>();

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
    const result = generateModel(doc, new Map(), NO_CONTOURS, 'test');
    expect(result.calls.map((c) => c.op)).toEqual(['cad.box', 'cad.cylinder', 'cad.subtract']);
    expect(result.calls[2]!.inputs).toEqual(['part0', 'part1']);
    expect(result.code).toContain('let part0 = cad.box(');
    expect(result.code).toContain('s0');
    expect(result.code).toContain('part2');
    // Origin preserved-only
    const origin = result.objects.find((o) => o.name === 'Origin');
    expect(origin).toMatchObject({ disposition: 'preserved-only' });
  });

  it('bakes sketches without verdicts/contours; wires them to cad.sketch when solved', () => {
    const doc: FcstdDocument = {
      objects: [
        simpleObj('Sketcher::SketchObject', 'Sketch', {}),
        simpleObj('PartDesign::Pad', 'Pad', { Profile: { value: 'Sketch' }, Length: { value: '10' } }),
      ],
      typeIndex: new Map(),
      meta: new Map(),
    };
    // no verdict, no contours → sketch baked, Pad can't resolve profile → baked
    const r1 = generateModel(doc, new Map(), NO_CONTOURS, 't');
    const pad1 = r1.objects.find((o) => o.name === 'Pad');
    expect(pad1).toMatchObject({ disposition: 'baked' });

    // L0 verdict + contours → sketch emits cad.sketch, Pad resolves the
    // profile face and becomes a real cad.extrude call (M6 wiring).
    const r2 = generateModel(
      doc,
      new Map([['Sketch', { level: 'L0', loopCount: 1 }]]),
      new Map([['Sketch', square()]]),
      't',
    );
    const sketch2 = r2.objects.find((o) => o.name === 'Sketch');
    expect(sketch2).toMatchObject({ disposition: 'translated' });
    const pad2 = r2.objects.find((o) => o.name === 'Pad');
    expect(pad2).toMatchObject({ disposition: 'translated' });
    expect(r2.code).toContain('cad.sketch');
    expect(r2.code).toContain('cad.extrude');
    expect(r2.code).not.toContain('cad.fai_extrude');
  });

  it('groups multiple roots via cad.group', () => {
    const doc: FcstdDocument = {
      objects: [simpleObj('Part::Box', 'A', {}), simpleObj('Part::Box', 'B', {})],
      typeIndex: new Map(),
      meta: new Map(),
    };
    const r = generateModel(doc, new Map(), NO_CONTOURS, 't');
    expect(r.code).toContain('cad.group({ members: [part0, part1] })');
  });

  it('emits Pad + Pocket as real cad.extrude / cad.subtract when sketch contours are wired', () => {
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
    const contours = new Map([
      ['Sketch', square()],
      ['Sketch001', square()],
    ]);
    const r = generateModel(doc, verdicts, contours, 't');
    const sketch = r.objects.find((o) => o.name === 'Sketch');
    const sketch001 = r.objects.find((o) => o.name === 'Sketch001');
    const pad = r.objects.find((o) => o.name === 'Pad');
    const pocket = r.objects.find((o) => o.name === 'Pocket');
    expect(sketch).toMatchObject({ disposition: 'translated' });
    expect(sketch001).toMatchObject({ disposition: 'translated' });
    expect(pad).toMatchObject({ disposition: 'translated' });
    expect(pocket).toMatchObject({ disposition: 'translated' });
    // both sketches become faces; Pad extrudes, Pocket extrudes+cuts
    expect(r.code).toContain('cad.sketch');
    expect(r.code).toContain('cad.extrude');
    expect(r.code).toContain('cad.subtract');
    expect(r.code).not.toContain('cad.fai_extrude');
  });

  it('renders JsExpr edge anchors verbatim for Fillet/Chamfer (M6.1)', () => {
    const fillet = withLinkSub(
      simpleObj('PartDesign::Fillet', 'Fillet', { Radius: { value: '4' } }),
      'Base', 'Box', ['Edge17', 'Edge18'],
    );
    const doc: FcstdDocument = {
      objects: [simpleObj('Part::Box', 'Box', {}), fillet],
      typeIndex: new Map(),
      meta: new Map(),
    };
    const r = generateModel(doc, new Map(), NO_CONTOURS, 't');
    const f = r.objects.find((o) => o.name === 'Fillet');
    expect(f).toMatchObject({ disposition: 'translated' });
    // the edge refs must survive as live calls against the base variable,
    // not as JSON-encoded literals.
    expect(r.code).toContain('let part1 = cad.fillet(part0, { edges: [cad.edgeRef(part0, 17), cad.edgeRef(part0, 18)], radius: 4 });');
    expect(r.code).not.toContain('"__jsExpr"');
  });

  it('keeps plain array params byte-identical (no JsExpr present)', () => {
    const doc: FcstdDocument = {
      objects: [simpleObj('Part::Box', 'A', {}), simpleObj('Part::Box', 'B', {})],
      typeIndex: new Map(),
      meta: new Map(),
    };
    const r = generateModel(doc, new Map(), NO_CONTOURS, 't');
    expect(r.code).toContain('cad.group({ members: [part0, part1] })');
  });

  // GOTCHA: renderArgs used to emit `cad.sketch(, { ... })` for calls with no
  // positional args (inputs+literals empty) — a leading comma → SyntaxError.
  // Correct form: named-only params render as the first argument, no comma.
  it('emits no leading comma for calls with only named params (M7.1b)', () => {
    const doc: FcstdDocument = {
      objects: [simpleObj('Sketcher::SketchObject', 'Sketch', {})],
      typeIndex: new Map(),
      meta: new Map(),
    };
    const r = generateModel(
      doc,
      new Map([['Sketch', { level: 'L0' as const, loopCount: 1 }]]),
      new Map([['Sketch', square()]]),
      't',
    );
    expect(r.code).toContain('cad.sketch({ contours:');
    expect(r.code).not.toContain('(, ');
  });

  // M9.4 (D-C): features inside one Body fuse cumulatively in Body.Group
  // order — Pad unions onto the chain, Pocket subtracts from it. cad.group
  // is assembly semantics and must NOT appear for a single Body's chain.
  it('chains same-Body features via union/subtract, no cad.group (M9.4)', () => {
    const body = simpleObj('PartDesign::Body', 'Body');
    body.properties.set('Group', {
      name: 'Group', type: 'App::PropertyLinkList', tagName: 'Property',
      // real FCStd shape: Property > LinkList > Link*
      children: [{
        name: 'LinkList', type: '', tagName: 'LinkList',
        children: [
          { name: 'Link', type: '', tagName: 'Link', children: [], valueXml: '', valueText: '', attributes: { value: 'Pad' } },
          { name: 'Link', type: '', tagName: 'Link', children: [], valueXml: '', valueText: '', attributes: { value: 'Pocket' } },
          { name: 'Link', type: '', tagName: 'Link', children: [], valueXml: '', valueText: '', attributes: { value: 'Pad001' } },
        ],
        valueXml: '', valueText: '', attributes: { count: '3' },
      }],
      valueXml: '', valueText: '', attributes: {},
    });
    const doc: FcstdDocument = {
      objects: [
        body,
        simpleObj('Sketcher::SketchObject', 'Sketch', {}),
        simpleObj('PartDesign::Pad', 'Pad', { Profile: { value: 'Sketch' }, Length: { value: '10' } }),
        simpleObj('Sketcher::SketchObject', 'Sketch001', {}),
        simpleObj('PartDesign::Pocket', 'Pocket', { Profile: { value: 'Sketch001' }, BaseFeature: { value: 'Pad' }, Length: { value: '5' } }),
        simpleObj('Sketcher::SketchObject', 'Sketch002', {}),
        simpleObj('PartDesign::Pad', 'Pad001', { Profile: { value: 'Sketch002' }, BaseFeature: { value: 'Pocket' }, Length: { value: '3' } }),
      ],
      typeIndex: new Map(),
      meta: new Map(),
    };
    const verdicts = new Map([
      ['Sketch', { level: 'L0' as const, loopCount: 1 }],
      ['Sketch001', { level: 'L0' as const, loopCount: 1 }],
      ['Sketch002', { level: 'L0' as const, loopCount: 1 }],
    ]);
    const contours = new Map([
      ['Sketch', square()],
      ['Sketch001', square()],
      ['Sketch002', square()],
    ]);
    const r = generateModel(doc, verdicts, contours, 't');
    // Exactly 2 chain-level ops, no double-subtract: Pocket's own subtract
    // (base − cut, BaseFeature resolved to the chain head) advances the chain,
    // then Pad001 unions onto the new head. The Pocket base feature does NOT
    // get a second cad.subtract against the chain.
    const chainOps = r.calls.filter((c) => (c.op === 'cad.union' || c.op === 'cad.subtract') && !c.out.includes('__'));
    expect(chainOps.map((c) => c.op)).toEqual(['cad.subtract', 'cad.union']);
    // Pad001's union consumes the Pocket output (chain head), not the raw Pad
    const pocketOut = chainOps[0]!.out;
    expect(chainOps[1]!.inputs).toContain(pocketOut);
    expect(r.code).not.toContain('cad.group({ members: [part0');
  });

  // M10.3: two Bodies with geometry → one file per Body + aggregate main
  // referencing <Body>_out terminals via cad.group.
  it('splits multi-Body models into per-Body files + aggregate main (M10.3)', () => {
    const mkBody = (name: string, members: string[]): FcstdObject => {
      const b = simpleObj('PartDesign::Body', name);
      b.properties.set('Group', {
        name: 'Group', type: 'App::PropertyLinkList', tagName: 'Property',
        children: [{
          name: 'LinkList', type: '', tagName: 'LinkList',
          children: members.map((m) => ({
            name: 'Link', type: '', tagName: 'Link', children: [], valueXml: '', valueText: '', attributes: { value: m },
          })),
          valueXml: '', valueText: '', attributes: { count: String(members.length) },
        }],
        valueXml: '', valueText: '', attributes: {},
      });
      return b;
    };
    const doc: FcstdDocument = {
      objects: [
        mkBody('Body', ['Pad']),
        mkBody('Body001', ['Pad001']),
        simpleObj('Sketcher::SketchObject', 'Sketch', {}),
        simpleObj('PartDesign::Pad', 'Pad', { Profile: { value: 'Sketch' }, Length: { value: '10' } }),
        simpleObj('Sketcher::SketchObject', 'Sketch001', {}),
        simpleObj('PartDesign::Pad', 'Pad001', { Profile: { value: 'Sketch001' }, Length: { value: '5' } }),
      ],
      typeIndex: new Map(),
      meta: new Map(),
    };
    const verdicts = new Map([
      ['Sketch', { level: 'L0' as const, loopCount: 1 }],
      ['Sketch001', { level: 'L0' as const, loopCount: 1 }],
    ]);
    const contours = new Map([
      ['Sketch', square()],
      ['Sketch001', square()],
    ]);
    const r = generateModel(doc, verdicts, contours, 't');
    expect(r.files.length).toBe(2);
    const paths = r.files.map((f) => f.path).sort();
    expect(paths).toEqual(['model/Body.fai.js', 'model/Body001.fai.js']);
    for (const f of r.files) {
      expect(f.code).toContain(`let ${f.body}_out =`);
    }
    // aggregate entry groups both Body terminals
    expect(r.code).toContain('let part_out = cad.group({ members: [Body_out, Body001_out] });');
    expect(r.rootVar).toBe('part_out');
  });

  // M10.5: loose Part features (no Body) stay in main.fai.js even when
  // Bodies exist.
  it('keeps loose non-Body features in main alongside the aggregate (M10.5)', () => {
    const mkBody = (name: string, members: string[]): FcstdObject => {
      const b = simpleObj('PartDesign::Body', name);
      b.properties.set('Group', {
        name: 'Group', type: 'App::PropertyLinkList', tagName: 'Property',
        children: [{
          name: 'LinkList', type: '', tagName: 'LinkList',
          children: members.map((m) => ({
            name: 'Link', type: '', tagName: 'Link', children: [], valueXml: '', valueText: '', attributes: { value: m },
          })),
          valueXml: '', valueText: '', attributes: { count: String(members.length) },
        }],
        valueXml: '', valueText: '', attributes: {},
      });
      return b;
    };
    const doc: FcstdDocument = {
      objects: [
        mkBody('Body', ['Pad']),
        simpleObj('Sketcher::SketchObject', 'Sketch', {}),
        simpleObj('PartDesign::Pad', 'Pad', { Profile: { value: 'Sketch' }, Length: { value: '10' } }),
        simpleObj('Part::Box', 'LooseBox', {}),
      ],
      typeIndex: new Map(),
      meta: new Map(),
    };
    const r = generateModel(
      doc,
      new Map([['Sketch', { level: 'L0' as const, loopCount: 1 }]]),
      new Map([['Sketch', square()]]),
      't',
    );
    expect(r.files.length).toBe(1);
    expect(r.files[0]!.path).toBe('model/Body.fai.js');
    // LooseBox call remains in main
    expect(r.code).toContain('cad.box');
  });
});
