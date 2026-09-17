/**
 * M9 tests — Pad/Pocket Type-driven semantics (no silent Length fallback).
 *
 * Corpus note: the plan's TwoLengthsPad*.FCStd samples do NOT exist in the
 * local corpus (checked 2026-09-17), so these pin the semantics with
 * synthetic FCStd objects instead.
 *
 * GOTCHA: PropertyEnumeration values arrive as EITHER the string label
 * ('TwoLengths') or the integer index ('4') depending on how FreeCAD
 * serialized it — both forms are covered here.
 */
import { describe, it, expect } from 'vitest';
import { translateObject, featureTypeOf } from './feature-translate.js';
import type { FcstdDocument, FcstdObject } from './document.js';

function obj(type: string, name: string, props: Record<string, string | number>): FcstdObject {
  const properties = new Map(
    Object.entries(props).map(([k, v]) => [
      k,
      {
        name: k,
        type: k === 'Type' ? 'App::PropertyEnumeration' : '',
        tagName: 'Property',
        children: [{
          name: k === 'Type' ? 'String' : 'Float', type: '', tagName: k === 'Type' ? 'String' : 'Float',
          children: [], valueXml: '', valueText: '', attributes: { value: String(v) },
        }],
        valueXml: '', valueText: '', attributes: {},
      },
    ]),
  );
  return { type, name, properties };
}

const PROFILE_VAR = (dep: string): string | undefined => (dep === 'Sketch' ? 'part0' : dep === 'Pad' ? 'part1' : undefined);

describe('M9.1 featureTypeOf', () => {
  it('missing Type property → Length (FreeCAD default)', () => {
    const pad = obj('PartDesign::Pad', 'Pad', { Length: 10 });
    expect(featureTypeOf(pad, 'pad')).toBe('Length');
  });

  it('reads both label and index forms; Pad and Pocket tables differ', () => {
    // Pocket index 1 = ThroughAll; Pad index 1 = UpToLast
    expect(featureTypeOf(obj('PartDesign::Pocket', 'P', { Type: 1 }), 'pocket')).toBe('ThroughAll');
    expect(featureTypeOf(obj('PartDesign::Pad', 'P', { Type: 1 }), 'pad')).toBe('UpToLast');
    expect(featureTypeOf(obj('PartDesign::Pad', 'P', { Type: 'TwoLengths' }), 'pad')).toBe('TwoLengths');
    // out-of-range index → unknown, never silently Length
    expect(featureTypeOf(obj('PartDesign::Pad', 'P', { Type: 9 }), 'pad')).toBe('unknown');
  });
});

describe('M9.2 TwoLengths Pad → two extrudes + union', () => {
  it('Length forward + Length2 backward, fused via cad.union', () => {
    const pad = obj('PartDesign::Pad', 'Pad', {
      Type: 'TwoLengths', Length: 10, Length2: 4, Profile: 'Sketch',
    });
    const v = translateObject(pad, PROFILE_VAR);
    expect(v.kind).toBe('translated');
    if (v.kind !== 'translated') return;
    expect(v.calls.map((c) => c.op)).toEqual(['cad.extrude', 'cad.extrude', 'cad.union']);
    // signed literals: +Length and −Length2
    expect(v.calls[0]!.literals).toEqual([[0, 0, 10]]);
    expect(v.calls[1]!.literals).toEqual([[0, 0, -4]]);
  });

  it('Pocket TwoLengths is accepted as a valid Type (translated via Length path)', () => {
    const pocket = obj('PartDesign::Pocket', 'Pocket', {
      Type: 4, Length: 5, Profile: 'Sketch', BaseFeature: 'Pad',
    });
    const v = translateObject(pocket, PROFILE_VAR);
    expect(v.kind).toBe('translated');
  });
});

describe('M9.3 UpTo* / ThroughAll / unknown → explicit bake with reason', () => {
  const cases: [string, number | string, string][] = [
    ['pad UpToLast', 'UpToLast', 'pad-type-UpToLast-unsupported'],
    ['pad UpToFirst (index)', 2, 'pad-type-UpToFirst-unsupported'],
    ['pad UpToFace (index)', 3, 'pad-type-UpToFace-unsupported'],
    ['pad unknown index', 99, 'pad-type-unknown-unsupported'],
    ['pocket ThroughAll (index)', 1, 'pocket-type-ThroughAll-unsupported'],
    ['pocket UpToFace', 'UpToFace', 'pocket-type-UpToFace-unsupported'],
    ['pocket unknown', 'Bogus', 'pocket-type-unknown-unsupported'],
  ];
  for (const [label, typeVal, expectedReason] of cases) {
    it(label, () => {
      const isPad = expectedReason.startsWith('pad');
      const o = isPad
        ? obj('PartDesign::Pad', 'Pad', { Type: typeVal as number, Length: 10, Profile: 'Sketch' })
        : obj('PartDesign::Pocket', 'Pocket', { Type: typeVal as number, Length: 10, Profile: 'Sketch', BaseFeature: 'Pad' });
      const v = translateObject(o, PROFILE_VAR);
      expect(v.kind, `${label} must bake`).toBe('baked');
      if (v.kind === 'baked') expect(v.reason).toBe(expectedReason);
    });
  }

  it('plain Length Pad still translates (no regression)', () => {
    const pad = obj('PartDesign::Pad', 'Pad', { Length: 10, Profile: 'Sketch' });
    const v = translateObject(pad, PROFILE_VAR);
    expect(v.kind).toBe('translated');
  });
});
