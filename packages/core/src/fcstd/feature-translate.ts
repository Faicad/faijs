/**
 * M4 — whitelisted feature translation: FCStd objects → cad-op call plan.
 *
 * M4.1 whitelist: anything not listed → baked (S3, no silent loss).
 * M4.2 primitives → cad.box/cylinder/cone/sphere
 * M4.3 booleans   → cad.union/subtract/intersect
 * M4.6 Pad/Pocket → fai_extrude/subtract over the M3 sketch contour
 *
 * The call plan is an intermediate representation: M5 lowers it to .fai.js
 * (statements sN, variables partN). Geometry values are already mm (D7).
 */
import type { FcstdObject } from './document.js';

export interface CadCall {
  /** target variable name (partN, assigned by M5) */
  out: string;
  op: string;
  /** positional + named params, JSON-serializable */
  params: Record<string, unknown>;
  /** variable names this call consumes */
  inputs: string[];
  /** FCStd object this call came from */
  source: string;
}

export type TranslateVerdict =
  | { kind: 'translated'; calls: CadCall[] }
  | { kind: 'baked'; reason: string }
  | { kind: 'preserved-only'; reason: string };

/** M4.1 whitelist (plan §5.5.5 measurable types only). */
const WHITELIST = new Set([
  'Part::Box',
  'Part::Cylinder',
  'Part::Cut',
  'Part::MultiFuse',
  'Part::Extrusion',
  'PartDesign::Pad',
  'PartDesign::Pocket',
]);

export function isWhitelisted(type: string): boolean {
  return WHITELIST.has(type);
}

function propNum(obj: FcstdObject, name: string): number | undefined {
  const p = obj.properties.get(name);
  if (!p) return undefined;
  const el = p.children[0];
  const v = el?.attributes['value'];
  return v === undefined ? undefined : Number(v);
}

function propBool(obj: FcstdObject, name: string): boolean {
  const el = obj.properties.get(name)?.children[0];
  return el?.attributes['value'] === 'true';
}

function propLink(obj: FcstdObject, name: string): string | undefined {
  const el = obj.properties.get(name)?.children[0];
  const v = el?.attributes['value'];
  return v && v.length > 0 ? v : undefined;
}

/**
 * Resolve a Pad/Pocket profile link. Modern files use `Profile`; files saved
 * by FreeCAD ≤ 0.19 store the sketch directly under `Sketch` (observed in
 * PadTest.fcstd, ProgramVersion 0.14/0.17 era).
 */
function profileLink(obj: FcstdObject): string | undefined {
  return propLink(obj, 'Profile') ?? propLink(obj, 'Sketch');
}

/** Placement position (Px/Py/Pz) of an object. */
export function placementPos(obj: FcstdObject): [number, number, number] {
  // Property → <PropertyPlacement Px=... Py=... Pz=.../>
  const pp = obj.properties.get('Placement')?.children[0];
  if (!pp) return [0, 0, 0];
  return [
    Number(pp.attributes['Px'] ?? 0),
    Number(pp.attributes['Py'] ?? 0),
    Number(pp.attributes['Pz'] ?? 0),
  ];
}

/**
 * M4 translate one object. `inputVar` maps a dependency object name to the
 * variable holding its geometry (sketch contours or prior solid).
 */
export function translateObject(
  obj: FcstdObject,
  inputVar: (depName: string) => string | undefined,
): TranslateVerdict {
  if (!isWhitelisted(obj.type)) {
    return { kind: 'baked', reason: `type-not-whitelisted: ${obj.type}` };
  }
  const out = obj.name; // M5 renames to partN
  switch (obj.type) {
    case 'Part::Box': {
      const l = propNum(obj, 'Length') ?? 0;
      const w = propNum(obj, 'Width') ?? 0;
      const h = propNum(obj, 'Height') ?? 0;
      // FCStd Box: corner at Placement, extends +X/+Y/+Z
      const [x, y, z] = placementPos(obj);
      return {
        kind: 'translated',
        calls: [{
          out, op: 'cad.box', source: obj.name, inputs: [],
          params: { width: w, depth: l, height: h, at: [x, y, z], centered: false },
        }],
      };
    }
    case 'Part::Cylinder': {
      const r = propNum(obj, 'Radius') ?? 0;
      const h = propNum(obj, 'Height') ?? 0;
      const [x, y, z] = placementPos(obj);
      const angle = propNum(obj, 'Angle') ?? 360;
      if (angle !== 360) return { kind: 'baked', reason: 'cylinder-partial-angle' };
      return {
        kind: 'translated',
        calls: [{
          out, op: 'cad.cylinder', source: obj.name, inputs: [],
          params: { radius: r, height: h, at: [x, y, z], centered: false },
        }],
      };
    }
    case 'Part::Cut': {
      const base = propLink(obj, 'Base');
      const tool = propLink(obj, 'Tool');
      const b = base ? inputVar(base) : undefined;
      const t = tool ? inputVar(tool) : undefined;
      if (!b || !t) return { kind: 'baked', reason: 'cut-missing-dependency' };
      return {
        kind: 'translated',
        calls: [{ out, op: 'cad.subtract', source: obj.name, inputs: [b, t], params: {} }],
      };
    }
    case 'Part::MultiFuse': {
      // <LinkList count="N"><Link value="A"/>...</LinkList>
      const shapes = propLinkList(obj, 'Shapes');
      const inputs = shapes.map(inputVar);
      if (shapes.length < 2 || inputs.some((i) => i === undefined)) {
        return { kind: 'baked', reason: 'multifuse-missing-dependency' };
      }
      return {
        kind: 'translated',
        calls: [{ out, op: 'cad.union', source: obj.name, inputs: inputs as string[], params: {} }],
      };
    }
    case 'PartDesign::Pad': {
      const profile = profileLink(obj);
      const len = propNum(obj, 'Length') ?? 0;
      const reversed = propBool(obj, 'Reversed');
      const midplane = propBool(obj, 'Midplane');
      const profileVar = profile ? inputVar(profile) : undefined;
      if (!profileVar) return { kind: 'baked', reason: 'pad-missing-profile' };
      // fai_extrude extrudes along the profile normal; length sign encodes
      // direction, midplane handled by mode.
      const length = reversed ? -len : len;
      return {
        kind: 'translated',
        calls: [{
          out, op: 'cad.fai_extrude', source: obj.name, inputs: [profileVar],
          params: {
            length,
            ...(midplane ? { mode: 'midplane' } : {}),
          },
        }],
      };
    }
    case 'PartDesign::Pocket': {
      const profile = profileLink(obj);
      const len = propNum(obj, 'Length') ?? 0;
      const reversed = propBool(obj, 'Reversed');
      const midplane = propBool(obj, 'Midplane');
      const base = propLink(obj, 'BaseFeature');
      const profileVar = profile ? inputVar(profile) : undefined;
      const baseVar = base ? inputVar(base) : undefined;
      if (!profileVar || !baseVar) return { kind: 'baked', reason: 'pocket-missing-dependency' };
      // Pocket cuts INTO the material: extrude the profile opposite the
      // normal (or along it when Reversed), then subtract from base.
      const length = (reversed ? len : -len);
      const cutVar = `${out}_cut`;
      const calls: CadCall[] = [{
        out: cutVar, op: 'cad.fai_extrude', source: obj.name, inputs: [profileVar],
        params: { length, ...(midplane ? { mode: 'midplane' } : {}) },
      }];
      calls.push({ out, op: 'cad.subtract', source: obj.name, inputs: [baseVar, cutVar], params: {} });
      return { kind: 'translated', calls };
    }
    default:
      return { kind: 'baked', reason: `type-not-implemented: ${obj.type}` };
  }
}

function propLinkList(obj: FcstdObject, name: string): string[] {
  const listEl = obj.properties.get(name)?.children[0];
  if (!listEl) return [];
  const out: string[] = [];
  for (const link of listEl.children) {
    const v = link.attributes['value'];
    if (v) out.push(v);
  }
  return out;
}
