/**
 * M4 tests — whitelist feature translation (M4.1 table, M4.2 primitives,
 * M4.3 booleans, M4.6 Pad/Pocket).
 */
import { describe, it, expect } from 'vitest';
import { translateObject, isWhitelisted, placementPos, isJsExpr, jsExpr } from './feature-translate.js';
import type { FcstdObject, FcstdProperty } from './document.js';

function prop(name: string, child: { name: string; attrs: Record<string, string> } | null = null): [string, FcstdProperty] {
  return [
    name,
    {
      name,
      type: '',
      tagName: 'Property',
      children: child ? [{ name: child.name, type: '', tagName: child.name, children: [], valueXml: '', valueText: '', attributes: child.attrs }] : [],
      valueText: '',
      attributes: {},
    },
  ];
}

function obj(type: string, name: string, props: [string, FcstdProperty][]): FcstdObject {
  return { type, name, properties: new Map(props) };
}

/**
 * An `App::PropertyLinkSub` with sub-element names, exactly as FreeCAD saves it:
 * `<LinkSub value="Pad001" count="2"><Sub value="Edge17"/><Sub value="Edge18"/></LinkSub>`.
 */
function linkSubProp(name: string, target: string, subs: string[]): [string, FcstdProperty] {
  return [
    name,
    {
      name,
      type: 'App::PropertyLinkSub',
      tagName: 'Property',
      children: [{
        name: 'LinkSub',
        type: '',
        tagName: 'LinkSub',
        children: subs.map((s) => ({
          name: 'Sub', type: '', tagName: 'Sub', children: [], valueXml: '', valueText: '', attributes: { value: s },
        })),
        valueXml: '',
        valueText: '',
        attributes: { value: target, count: String(subs.length) },
      }],
      valueXml: '',
      valueText: '',
      attributes: {},
    },
  ];
}

/** Raw `cad.edgeRef(...)` expressions carried in a call's params (M6.1 edge anchors). */
function edgeExprs(call: { params: Record<string, unknown> }): string[] {
  const edges = call.params['edges'];
  if (!Array.isArray(edges)) throw new Error('edges param is not an array');
  return edges.map((e) => (isJsExpr(e) ? e.__jsExpr : JSON.stringify(e)));
}

describe('M4.1 whitelist', () => {
  it('admits listed types and rejects others', () => {
    expect(isWhitelisted('Part::Box')).toBe(true);
    expect(isWhitelisted('PartDesign::Pad')).toBe(true);
    expect(isWhitelisted('Part::FeaturePython')).toBe(false);
    expect(isWhitelisted('PartDesign::Revolution')).toBe(true);
    expect(isWhitelisted('Part::Extrusion')).toBe(true);
  });
});

describe('M4.2 primitives', () => {
  it('translates Part::Box with placement corner', () => {
    const box = obj('Part::Box', 'Box', [
      prop('Length', { name: 'Float', attrs: { value: '30' } }),
      prop('Width', { name: 'Float', attrs: { value: '20' } }),
      prop('Height', { name: 'Float', attrs: { value: '10' } }),
      prop('Placement', { name: 'PropertyPlacement', attrs: {} }),
    ]);
    // inject placement values: Property → PropertyPlacement (real structure)
    const placement = box.properties.get('Placement')!;
    placement.children = [{
      name: 'PropertyPlacement', type: '', tagName: 'PropertyPlacement',
      children: [], valueXml: '', valueText: '',
      attributes: { Px: '5', Py: '0', Pz: '1', Q0: '0', Q1: '0', Q2: '0', Q3: '1' },
    }];
    void placement;
    expect(placementPos(box)).toEqual([5, 0, 1]);
    const v = translateObject(box, () => undefined);
    expect(v.kind).toBe('translated');
    if (v.kind === 'translated') {
      expect(v.calls[0]!.op).toBe('cad.box');
      expect(v.calls[0]!.params).toMatchObject({ width: 20, depth: 30, height: 10, at: [5, 0, 1] });
    }
  });

  it('translates Part::Cylinder', () => {
    const cyl = obj('Part::Cylinder', 'Cyl', [
      prop('Radius', { name: 'Float', attrs: { value: '7.5' } }),
      prop('Height', { name: 'Float', attrs: { value: '40' } }),
      prop('Angle', { name: 'Float', attrs: { value: '360' } }),
      prop('Placement', { name: 'PropertyPlacement', attrs: {} }),
    ]);
    const v = translateObject(cyl, () => undefined);
    expect(v.kind).toBe('translated');
    if (v.kind === 'translated') expect(v.calls[0]!.op).toBe('cad.cylinder');
  });
});

describe('M4.3 booleans', () => {
  it('translates Part::Cut into cad.subtract with resolved inputs', () => {
    const cut = obj('Part::Cut', 'Cut', [
      prop('Base', { name: 'Link', attrs: { value: 'Box' } }),
      prop('Tool', { name: 'Link', attrs: { value: 'Cyl' } }),
    ]);
    const v = translateObject(cut, (dep) => (dep === 'Box' ? 'part0' : dep === 'Cyl' ? 'part1' : undefined));
    expect(v.kind).toBe('translated');
    if (v.kind === 'translated') {
      expect(v.calls[0]!.op).toBe('cad.subtract');
      expect(v.calls[0]!.inputs).toEqual(['part0', 'part1']);
    }
  });

  it('bakes Part::Cut with unresolved dependency', () => {
    const cut = obj('Part::Cut', 'Cut', [
      prop('Base', { name: 'Link', attrs: { value: 'Box' } }),
      prop('Tool', { name: 'Link', attrs: { value: 'Ghost' } }),
    ]);
    const v = translateObject(cut, () => undefined);
    expect(v).toMatchObject({ kind: 'baked', reason: 'cut-missing-dependency' });
  });
});

describe('M4.6 Pad/Pocket', () => {
  it('translates Pad over a sketch profile', () => {
    const pad = obj('PartDesign::Pad', 'Pad', [
      prop('Profile', { name: 'Link', attrs: { value: 'Sketch' } }),
      prop('Length', { name: 'Float', attrs: { value: '12' } }),
      prop('Reversed', { name: 'Bool', attrs: { value: 'false' } }),
      prop('Midplane', { name: 'Bool', attrs: { value: 'false' } }),
    ]);
    const v = translateObject(pad, (dep) => (dep === 'Sketch' ? 'sketch0' : undefined));
    expect(v.kind).toBe('translated');
    if (v.kind === 'translated') {
      expect(v.calls[0]!.op).toBe('cad.extrude');
      expect(v.calls[0]!.inputs).toEqual(['sketch0']);
      // length is carried as a directional literal (Vec3 along +Z)
      expect(v.calls[0]!.literals).toEqual([[0, 0, 12]]);
      expect(v.calls[0]!.params).toEqual({});
    }
  });

  it('translates Part::Extrusion over a base with directional length', () => {
    const ext = obj('Part::Extrusion', 'Ext', [
      prop('Base', { name: 'Link', attrs: { value: 'Sketch' } }),
      prop('Length', { name: 'Float', attrs: { value: '10' } }),
      prop('Dir', { name: 'Vector', attrs: { value: '0 0 1' } }),
      prop('Reverse', { name: 'Bool', attrs: { value: 'false' } }),
    ]);
    const v = translateObject(ext, (dep) => (dep === 'Sketch' ? 'sketch0' : undefined));
    expect(v.kind).toBe('translated');
    if (v.kind === 'translated') {
      expect(v.calls[0]!.op).toBe('cad.extrude');
      expect(v.calls[0]!.inputs).toEqual(['sketch0']);
      expect(v.calls[0]!.literals).toEqual([[0, 0, 10]]);
    }
  });

  it('translates PartDesign::Revolution around the body Z axis', () => {
    const rev = obj('PartDesign::Revolution', 'Rev', [
      prop('Profile', { name: 'Link', attrs: { value: 'Sketch' } }),
      prop('Angle', { name: 'Float', attrs: { value: '360' } }),
      prop('ReferenceAxis', { name: 'LinkSub', attrs: { value: 'V_Axis' } }),
    ]);
    const v = translateObject(rev, (dep) => (dep === 'Sketch' ? 'sketch0' : undefined));
    expect(v.kind).toBe('translated');
    if (v.kind === 'translated') {
      expect(v.calls[0]!.op).toBe('cad.revolve');
      expect(v.calls[0]!.inputs).toEqual(['sketch0']);
      expect(v.calls[0]!.params).toMatchObject({ axis: [0, 0, 1], at: [0, 0, 0] });
    }
  });

  it('bakes Revolution referencing an edge/vertex axis (unsupported)', () => {
    const rev = obj('PartDesign::Revolution', 'Rev', [
      prop('Profile', { name: 'Link', attrs: { value: 'Sketch' } }),
      prop('Angle', { name: 'Float', attrs: { value: '360' } }),
      prop('ReferenceAxis', { name: 'LinkSub', attrs: { value: 'Edge1' } }),
    ]);
    const v = translateObject(rev, (dep) => (dep === 'Sketch' ? 'sketch0' : undefined));
    expect(v).toMatchObject({ kind: 'baked', reason: 'revolution-edge-axis-unsupported' });
  });

  it('translates Pocket as extrude + subtract from base', () => {
    const pocket = obj('PartDesign::Pocket', 'Pocket', [
      prop('Profile', { name: 'Link', attrs: { value: 'Sketch001' } }),
      prop('Length', { name: 'Float', attrs: { value: '5' } }),
      prop('BaseFeature', { name: 'Link', attrs: { value: 'Pad' } }),
      prop('Reversed', { name: 'Bool', attrs: { value: 'false' } }),
      prop('Midplane', { name: 'Bool', attrs: { value: 'false' } }),
    ]);
    const v = translateObject(pocket, (dep) => (dep === 'Sketch001' ? 'sketch1' : dep === 'Pad' ? 'part2' : undefined));
    expect(v.kind).toBe('translated');
    if (v.kind === 'translated') {
      expect(v.calls.length).toBe(2);
      expect(v.calls[1]!.op).toBe('cad.subtract');
      expect(v.calls[1]!.inputs).toEqual(['part2', 'Pocket_cut']);
    }
  });

  it('bakes Python-feature types with reason', () => {
    const py = obj('Part::FeaturePython', 'Py1', []);
    const v = translateObject(py, () => undefined);
    expect(v.kind).toBe('baked');
    if (v.kind === 'baked') expect(v.reason).toContain('type-not-whitelisted');
  });
});

describe('M4.6b UpToFace datum-plane (extrude-upto-face §4.3-C1)', () => {
  // PadTest Pad001 geometry: sketch normal = +X, datum plane is TILTED
  // (normal ≈ [0.705, 0.071, 0.705]); the signed distance to it along the
  // sketch normal is +10 (the naive (Δp·dir) form wrongly yields −50).
  function placementProp(px: number, py: number, pz: number, q0: number, q1: number, q2: number, q3: number): [string, FcstdProperty] {
    return ['Placement', {
      name: 'Placement', type: 'App::PropertyPlacement', tagName: 'Property',
      children: [{ name: 'PropertyPlacement', type: '', tagName: 'PropertyPlacement', children: [], valueXml: '', valueText: '', attributes: { Px: String(px), Py: String(py), Pz: String(pz), Q0: String(q0), Q1: String(q1), Q2: String(q2), Q3: String(q3) } }],
      valueText: '', attributes: {},
    }];
  }
  function linkProp(name: string, target: string): [string, FcstdProperty] {
    return [name, {
      name, type: 'App::PropertyLink', tagName: 'Property',
      children: [{ name: 'Link', type: '', tagName: 'Link', children: [], valueXml: '', valueText: '', attributes: { value: target } }],
      valueText: '', attributes: {},
    }];
  }
  // App::PropertyEnumeration as a `[name, prop]` tuple (NOT a bare object —
  // `obj()` does `new Map(props)`, so a bare object is silently dropped and
  // featureTypeOf falls back to the Length default).
  function enumProp(name: string, value: string): [string, FcstdProperty] {
    return [name, {
      name, type: 'App::PropertyEnumeration', tagName: 'Property',
      children: [{ name: 'Integer', type: '', tagName: 'Integer', children: [], valueXml: '', valueText: '', attributes: { value } }],
      valueText: '', attributes: {},
    }];
  }
  const datumPlane = obj('PartDesign::Plane', 'DatumPlane', [placementProp(-40, 100, 50, -0.038192735828, 0.381927358277, 0, 0.923402841629)]);
  const sketch001 = obj('Sketcher::SketchObject', 'Sketch001', [placementProp(10, 0, 0, 0, 0.707106781187, 0, 0.707106781187)]);
  const pad001 = obj('PartDesign::Pad', 'Pad001', [
    linkProp('Profile', 'Sketch001'),
    enumProp('Type', '3'),
    linkSubProp('UpToFace', 'DatumPlane', ['Plane']),
  ]);

  it('translates UpToFace→datum plane as cad.extrude with the plane-distance length (+10)', () => {
    const v = translateObject(pad001, (dep) => (dep === 'Sketch001' ? 'sketch0' : undefined), [pad001, datumPlane, sketch001]);
    expect(v.kind).toBe('translated');
    if (v.kind === 'translated') {
      const call = v.calls[0]!;
      expect(call.op).toBe('cad.extrude');
      expect(call.inputs).toEqual(['sketch0']);
      // signed distance from the sketch plane to the (tilted) datum plane
      // along the sketch normal — NOT the naive (Δp·dir) which gives −50.
      expect(call.literals[0]![0]).toBe(0);
      expect(call.literals[0]![1]).toBe(0);
      expect(call.literals[0]![2]).toBeCloseTo(10, 1);
      expect(v.reason).toBe('uptoface-via-datum-plane-distance');
    }
  });

  it('bakes with uptoface-datum-plane-parallel when the datum plane is parallel to the extrude dir', () => {
    // datum plane normal = +Y, sketch normal = +X → dir·n = 0
    const parallelPlane = obj('PartDesign::Plane', 'DatumPlane', [placementProp(0, 0, 0, -0.707106781187, 0, 0, 0.707106781187)]);
    const p = obj('PartDesign::Pad', 'Pad001', [
      linkProp('Profile', 'Sketch001'),
      enumProp('Type', '3'),
      linkSubProp('UpToFace', 'DatumPlane', ['Plane']),
    ]);
    const v = translateObject(p, (dep) => (dep === 'Sketch001' ? 'sketch0' : undefined), [p, parallelPlane, sketch001]);
    expect(v).toMatchObject({ kind: 'baked', reason: 'uptoface-datum-plane-parallel' });
  });

  it('bakes with uptoface-solid-face-unsupported when the UpToFace target is a solid, not a datum plane', () => {
    const solid = obj('PartDesign::Pad', 'OtherPad', []);
    const p = obj('PartDesign::Pad', 'Pad001', [
      linkProp('Profile', 'Sketch001'),
      enumProp('Type', '3'),
      linkSubProp('UpToFace', 'OtherPad', ['Face1']),
    ]);
    const v = translateObject(p, (dep) => (dep === 'Sketch001' ? 'sketch0' : undefined), [p, solid, sketch001]);
    expect(v).toMatchObject({ kind: 'baked', reason: 'uptoface-solid-face-unsupported' });
  });
});

describe('M4.6c Pad UpToLast/UpToFirst (extrude-upto-face §4.3-C2)', () => {
  // Helpers (kept local; M4.6b defines its own copies).
  function linkProp(name: string, target: string): [string, FcstdProperty] {
    return [name, {
      name, type: 'App::PropertyLink', tagName: 'Property',
      children: [{ name: 'Link', type: '', tagName: 'Link', children: [], valueXml: '', valueText: '', attributes: { value: target } }],
      valueText: '', attributes: {},
    }];
  }
  function enumProp(name: string, value: string): [string, FcstdProperty] {
    return [name, {
      name, type: 'App::PropertyEnumeration', tagName: 'Property',
      children: [{ name: 'Integer', type: '', tagName: 'Integer', children: [], valueXml: '', valueText: '', attributes: { value } }],
      valueText: '', attributes: {},
    }];
  }

  it('translates Pad UpToLast as cad.extrude upTo:"last" with baseFeature ref', () => {
    const base = obj('PartDesign::Pad', 'BasePad', [enumProp('Type', '0'), linkProp('Profile', 'Sketch0')]);
    const pad = obj('PartDesign::Pad', 'Pad002', [
      linkProp('Profile', 'Sketch001'),
      linkProp('BaseFeature', 'BasePad'),
      enumProp('Type', '1'),
    ]);
    const v = translateObject(
      pad,
      (dep) => (dep === 'Sketch001' ? 'sketch0' : dep === 'BasePad' ? 'base0' : undefined),
      [pad, base],
    );
    expect(v.kind).toBe('translated');
    if (v.kind === 'translated') {
      const call = v.calls[0]!;
      expect(call.op).toBe('cad.extrude');
      expect(call.inputs).toEqual(['sketch0']);
      expect(call.params.upTo).toBe('last');
      const bf = call.params.baseFeature;
      expect(isJsExpr(bf) ? bf.__jsExpr : bf).toBe('base0');
      expect(v.reason).toBe('pad-UpToLast-via-baseFeature');
    }
  });

  it('translates Pad UpToFirst as cad.extrude upTo:"first"', () => {
    const base = obj('PartDesign::Pad', 'BasePad', [enumProp('Type', '0'), linkProp('Profile', 'Sketch0')]);
    const pad = obj('PartDesign::Pad', 'Pad001', [
      linkProp('Profile', 'Sketch001'),
      linkProp('BaseFeature', 'BasePad'),
      enumProp('Type', '2'),
    ]);
    const v = translateObject(
      pad,
      (dep) => (dep === 'Sketch001' ? 'sketch0' : dep === 'BasePad' ? 'base0' : undefined),
      [pad, base],
    );
    expect(v.kind).toBe('translated');
    if (v.kind === 'translated') {
      const call = v.calls[0]!;
      expect(call.op).toBe('cad.extrude');
      expect(call.params.upTo).toBe('first');
      const bf = call.params.baseFeature;
      expect(isJsExpr(bf) ? bf.__jsExpr : bf).toBe('base0');
      expect(v.reason).toBe('pad-UpToFirst-via-baseFeature');
    }
  });

  it('bakes UpToLast/UpToFirst without a resolvable BaseFeature (no silent fallback)', () => {
    const pad = obj('PartDesign::Pad', 'Pad002', [
      linkProp('Profile', 'Sketch001'),
      enumProp('Type', '1'),
    ]);
    const v = translateObject(pad, (dep) => (dep === 'Sketch001' ? 'sketch0' : undefined), [pad]);
    expect(v).toMatchObject({ kind: 'baked', reason: 'pad-upTo-missing-base' });
  });
});

describe('M4.6d Pad UpToFace solid-face (extrude-upto-face §4.3-C2.2)', () => {
  // Helpers (kept local; M4.6b/M4.6c define their own copies).
  function linkProp(name: string, target: string): [string, FcstdProperty] {
    return [name, {
      name, type: 'App::PropertyLink', tagName: 'Property',
      children: [{ name: 'Link', type: '', tagName: 'Link', children: [], valueXml: '', valueText: '', attributes: { value: target } }],
      valueText: '', attributes: {},
    }];
  }
  function enumProp(name: string, value: string): [string, FcstdProperty] {
    return [name, {
      name, type: 'App::PropertyEnumeration', tagName: 'Property',
      children: [{ name: 'Integer', type: '', tagName: 'Integer', children: [], valueXml: '', valueText: '', attributes: { value } }],
      valueText: '', attributes: {},
    }];
  }
  // linkSubProp is module-level (defined near the top of this file).

  it('translates Pad UpToFace solid-face as cad.extrude upTo: cad.faceRef(targetVar, N)', () => {
    const target = obj('PartDesign::Pad', 'OtherPad', [enumProp('Type', '0'), linkProp('Profile', 'Sketch0')]);
    const pad = obj('PartDesign::Pad', 'Pad001', [
      linkProp('Profile', 'Sketch001'),
      enumProp('Type', '3'),
      linkSubProp('UpToFace', 'OtherPad', ['Face3']),
    ]);
    const v = translateObject(
      pad,
      (dep) => (dep === 'Sketch001' ? 'sketch0' : dep === 'OtherPad' ? 'other0' : undefined),
      [pad, target],
    );
    expect(v.kind).toBe('translated');
    if (v.kind === 'translated') {
      const call = v.calls[0]!;
      expect(call.op).toBe('cad.extrude');
      expect(call.inputs).toEqual(['sketch0']);
      // FaceN ordinal passes through verbatim into the faceRef argument;
      // faceRef's enum order is calibrated to FreeCAD's FaceN (plan R-A).
      const upTo = call.params.upTo;
      expect(isJsExpr(upTo) ? upTo.__jsExpr : upTo).toBe('cad.faceRef(other0, 3)');
      expect(v.reason).toBe('uptoface-via-faceRef');
    }
  });

  it('bakes uptoface-sub-unparseable when the sub is not a plain FaceN reference', () => {
    // FreeCAD TNaming-modified face names (e.g. "Face__20f_...") are not a
    // stable ordinal → explicit bake, never guess.
    const target = obj('PartDesign::Pad', 'OtherPad', []);
    const pad = obj('PartDesign::Pad', 'Pad001', [
      linkProp('Profile', 'Sketch001'),
      enumProp('Type', '3'),
      linkSubProp('UpToFace', 'OtherPad', ['Face__20f_']),
    ]);
    const v = translateObject(
      pad,
      (dep) => (dep === 'Sketch001' ? 'sketch0' : dep === 'OtherPad' ? 'other0' : undefined),
      [pad, target],
    );
    expect(v).toMatchObject({ kind: 'baked', reason: 'uptoface-sub-unparseable' });
  });

  it('still bakes uptoface-solid-face-unsupported when the target var is unresolvable', () => {
    // regression: target is a solid but its var cannot be resolved → bake the
    // same reason as before C2.2 (no silent faceRef against an unknown shape).
    const solid = obj('PartDesign::Pad', 'OtherPad', []);
    const pad = obj('PartDesign::Pad', 'Pad001', [
      linkProp('Profile', 'Sketch001'),
      enumProp('Type', '3'),
      linkSubProp('UpToFace', 'OtherPad', ['Face1']),
    ]);
    const v = translateObject(pad, (dep) => (dep === 'Sketch001' ? 'sketch0' : undefined), [pad, solid]);
    expect(v).toMatchObject({ kind: 'baked', reason: 'uptoface-solid-face-unsupported' });
  });
});

describe('M4.7 patterns (LinearPattern / PolarPattern)', () => {
  it('translates LinearPattern over a source with axis + spacing', () => {
    const lp = obj('PartDesign::LinearPattern', 'LP', [
      prop('Source', { name: 'Link', attrs: { value: 'Pad' } }),
      prop('Direction', { name: 'LinkSub', attrs: { value: 'X_Axis' } }),
      prop('Length', { name: 'Float', attrs: { value: '20' } }),
      prop('Occurrences', { name: 'Integer', attrs: { value: '3' } }),
    ]);
    const v = translateObject(lp, (dep) => (dep === 'Pad' ? 'part2' : undefined));
    expect(v.kind).toBe('translated');
    if (v.kind === 'translated') {
      expect(v.calls[0]!.op).toBe('cad.linearPattern');
      expect(v.calls[0]!.inputs).toEqual(['part2']);
      // X axis, count 3, spacing = length/(occ-1) = 20/2 = 10
      expect(v.calls[0]!.literals).toEqual([[1, 0, 0], 3, 10]);
    }
  });

  it('bakes LinearPattern referencing an edge direction (unsupported)', () => {
    const lp = obj('PartDesign::LinearPattern', 'LP', [
      prop('Source', { name: 'Link', attrs: { value: 'Pad' } }),
      prop('Direction', { name: 'LinkSub', attrs: { value: 'Edge12' } }),
      prop('Length', { name: 'Float', attrs: { value: '20' } }),
      prop('Occurrences', { name: 'Integer', attrs: { value: '3' } }),
    ]);
    const v = translateObject(lp, (dep) => (dep === 'Pad' ? 'part2' : undefined));
    expect(v).toMatchObject({ kind: 'baked', reason: 'linear-pattern-edge-dir-unsupported' });
  });

  it('translates PolarPattern over a source around the Z axis', () => {
    const pp = obj('PartDesign::PolarPattern', 'PP', [
      prop('Source', { name: 'Link', attrs: { value: 'Pad' } }),
      prop('Axis', { name: 'LinkSub', attrs: { value: 'V_Axis' } }),
      prop('Angle', { name: 'Float', attrs: { value: '360' } }),
      prop('Occurrences', { name: 'Integer', attrs: { value: '4' } }),
    ]);
    const v = translateObject(pp, (dep) => (dep === 'Pad' ? 'part2' : undefined));
    expect(v.kind).toBe('translated');
    if (v.kind === 'translated') {
      expect(v.calls[0]!.op).toBe('cad.circularPattern');
      expect(v.calls[0]!.inputs).toEqual(['part2']);
      expect(v.calls[0]!.literals).toEqual([[0, 0, 1], 4, 360]);
    }
  });

  it('bakes PolarPattern referencing an edge/vertex axis (unsupported)', () => {
    const pp = obj('PartDesign::PolarPattern', 'PP', [
      prop('Source', { name: 'Link', attrs: { value: 'Pad' } }),
      prop('Axis', { name: 'LinkSub', attrs: { value: 'Vertex1' } }),
      prop('Angle', { name: 'Float', attrs: { value: '360' } }),
      prop('Occurrences', { name: 'Integer', attrs: { value: '4' } }),
    ]);
    const v = translateObject(pp, (dep) => (dep === 'Pad' ? 'part2' : undefined));
    expect(v).toMatchObject({ kind: 'baked', reason: 'polar-pattern-edge-axis-unsupported' });
  });
});

describe('M6.1 Fillet / Chamfer (edge anchors via cad.edgeRef)', () => {
  const base = (target: string, subs: string[]): [string, FcstdProperty] => linkSubProp('Base', target, subs);
  const dep = (d: string): string | undefined => (d === 'Pad001' ? 'part3' : undefined);

  it('translates Fillet into cad.fillet over cad.edgeRef anchors', () => {
    const f = obj('PartDesign::Fillet', 'Fillet', [
      base('Pad001', ['Edge17', 'Edge18']),
      prop('Radius', { name: 'Float', attrs: { value: '4' } }),
    ]);
    const v = translateObject(f, dep);
    expect(v.kind).toBe('translated');
    if (v.kind === 'translated') {
      const call = v.calls[0]!;
      expect(call.op).toBe('cad.fillet');
      expect(call.inputs).toEqual(['part3']);
      expect(edgeExprs(call)).toEqual(['cad.edgeRef(part3, 17)', 'cad.edgeRef(part3, 18)']);
      expect(call.params['radius']).toBe(4);
    }
  });

  it('translates Chamfer (no ChamferType → Equal distance) with Size as width', () => {
    const c = obj('PartDesign::Chamfer', 'Chamfer', [
      base('Pad001', ['Edge11']),
      prop('Size', { name: 'Float', attrs: { value: '1' } }),
    ]);
    const v = translateObject(c, dep);
    expect(v.kind).toBe('translated');
    if (v.kind === 'translated') {
      const call = v.calls[0]!;
      expect(call.op).toBe('cad.chamfer');
      expect(edgeExprs(call)).toEqual(['cad.edgeRef(part3, 11)']);
      expect(call.params).toMatchObject({ type: 'equal', width: 1 });
    }
  });

  it('translates ChamferType=1 as twoDistances (Size + Size2)', () => {
    const c = obj('PartDesign::Chamfer', 'Chamfer', [
      base('Pad001', ['Edge10', 'Edge4']),
      prop('ChamferType', { name: 'Integer', attrs: { value: '1' } }),
      prop('Size', { name: 'Float', attrs: { value: '1' } }),
      prop('Size2', { name: 'Float', attrs: { value: '3' } }),
    ]);
    const v = translateObject(c, dep);
    expect(v.kind).toBe('translated');
    if (v.kind === 'translated') {
      expect(edgeExprs(v.calls[0]!)).toEqual(['cad.edgeRef(part3, 10)', 'cad.edgeRef(part3, 4)']);
      expect(v.calls[0]!.params).toMatchObject({ type: 'twoDistances', width1: 1, width2: 3 });
    }
  });

  it('translates ChamferType=2 as distanceAngle (Size + Angle in degrees)', () => {
    const c = obj('PartDesign::Chamfer', 'Chamfer', [
      base('Pad001', ['Edge7']),
      prop('ChamferType', { name: 'Integer', attrs: { value: '2' } }),
      prop('Size', { name: 'Float', attrs: { value: '2' } }),
      prop('Angle', { name: 'Float', attrs: { value: '30' } }),
    ]);
    const v = translateObject(c, dep);
    expect(v.kind).toBe('translated');
    if (v.kind === 'translated') {
      expect(v.calls[0]!.params).toMatchObject({ type: 'distanceAngle', width: 2, angle: 30 });
    }
  });

  it('bakes Chamfer with Angle outside cad.chamfer (0, 90)', () => {
    const c = obj('PartDesign::Chamfer', 'Chamfer', [
      base('Pad001', ['Edge7']),
      prop('ChamferType', { name: 'Integer', attrs: { value: '2' } }),
      prop('Size', { name: 'Float', attrs: { value: '2' } }),
      prop('Angle', { name: 'Float', attrs: { value: '90' } }),
    ]);
    expect(translateObject(c, dep)).toMatchObject({ kind: 'baked', reason: 'chamfer-bad-distance-angle' });
  });

  it('bakes UseAllEdges for both Fillet and Chamfer', () => {
    const f = obj('PartDesign::Fillet', 'Fillet', [
      base('Pad001', ['Edge1']),
      prop('Radius', { name: 'Float', attrs: { value: '1' } }),
      prop('UseAllEdges', { name: 'Bool', attrs: { value: 'true' } }),
    ]);
    expect(translateObject(f, dep)).toMatchObject({ kind: 'baked', reason: 'fillet-all-edges-unsupported' });
    const c = obj('PartDesign::Chamfer', 'Chamfer', [
      base('Pad001', ['Edge1']),
      prop('Size', { name: 'Float', attrs: { value: '1' } }),
      prop('UseAllEdges', { name: 'Bool', attrs: { value: 'true' } }),
    ]);
    expect(translateObject(c, dep)).toMatchObject({ kind: 'baked', reason: 'chamfer-all-edges-unsupported' });
  });

  it('bakes Fillet/Chamfer referencing a non-edge sub-element', () => {
    const f = obj('PartDesign::Fillet', 'Fillet', [
      base('Pad001', ['Face1']),
      prop('Radius', { name: 'Float', attrs: { value: '1' } }),
    ]);
    expect(translateObject(f, dep)).toMatchObject({ kind: 'baked', reason: 'fillet-non-edge-sub' });
    const c = obj('PartDesign::Chamfer', 'Chamfer', [
      base('Pad001', ['Vertex1']),
      prop('Size', { name: 'Float', attrs: { value: '1' } }),
    ]);
    expect(translateObject(c, dep)).toMatchObject({ kind: 'baked', reason: 'chamfer-non-edge-sub' });
  });

  it('bakes Fillet/Chamfer with an unresolved base or a bad size', () => {
    const orphan = obj('PartDesign::Fillet', 'Fillet', [
      base('Ghost', ['Edge1']),
      prop('Radius', { name: 'Float', attrs: { value: '1' } }),
    ]);
    expect(translateObject(orphan, dep)).toMatchObject({ kind: 'baked', reason: 'fillet-missing-base' });

    const zeroRadius = obj('PartDesign::Fillet', 'Fillet', [
      base('Pad001', ['Edge1']),
      prop('Radius', { name: 'Float', attrs: { value: '0' } }),
    ]);
    expect(translateObject(zeroRadius, dep)).toMatchObject({ kind: 'baked', reason: 'fillet-bad-radius' });

    const zeroSize = obj('PartDesign::Chamfer', 'Chamfer', [
      base('Pad001', ['Edge1']),
      prop('Size', { name: 'Float', attrs: { value: '0' } }),
    ]);
    expect(translateObject(zeroSize, dep)).toMatchObject({ kind: 'baked', reason: 'chamfer-bad-size' });

    const emptySubs = obj('PartDesign::Chamfer', 'Chamfer', [
      base('Pad001', []),
      prop('Size', { name: 'Float', attrs: { value: '1' } }),
    ]);
    expect(translateObject(emptySubs, dep)).toMatchObject({ kind: 'baked', reason: 'chamfer-no-edges' });
  });

  it('whitelists Fillet/Chamfer', () => {
    expect(isWhitelisted('PartDesign::Fillet')).toBe(true);
    expect(isWhitelisted('PartDesign::Chamfer')).toBe(true);
  });
});
