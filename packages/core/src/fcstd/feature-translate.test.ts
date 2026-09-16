/**
 * M4 tests — whitelist feature translation (M4.1 table, M4.2 primitives,
 * M4.3 booleans, M4.6 Pad/Pocket).
 */
import { describe, it, expect } from 'vitest';
import { translateObject, isWhitelisted, placementPos } from './feature-translate.js';
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

describe('M4.1 whitelist', () => {
  it('admits listed types and rejects others', () => {
    expect(isWhitelisted('Part::Box')).toBe(true);
    expect(isWhitelisted('PartDesign::Pad')).toBe(true);
    expect(isWhitelisted('Part::FeaturePython')).toBe(false);
    expect(isWhitelisted('PartDesign::Revolution')).toBe(false);
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
      expect(v.calls[0]!.op).toBe('cad.fai_extrude');
      expect(v.calls[0]!.inputs).toEqual(['sketch0']);
      expect(v.calls[0]!.params).toMatchObject({ length: 12 });
    }
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
