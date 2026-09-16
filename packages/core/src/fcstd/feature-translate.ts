/**
 * M4 — whitelisted feature translation: FCStd objects → cad-op call plan.
 *
 * M4.1 whitelist: anything not listed → baked (S3, no silent loss).
 * M4.2 primitives → cad.box/cylinder/cone/sphere
 * M4.3 booleans   → cad.union/subtract/intersect
 * M4.6 Pad/Pocket → cad.extrude/cad.subtract over the M3 sketch contour (M6: sketch is a cad.sketch face)
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
  /** variable names this call consumes (rendered positionally before literals) */
  inputs: string[];
  /** positional literal values appended after `inputs` (e.g. a direction Vec3) */
  literals?: unknown[];
  /** FCStd object this call came from */
  source: string;
}

/**
 * A raw JS expression argument that M5 renders verbatim instead of JSON-encoding.
 *
 * Needed when a call argument is itself a function call against a variable that
 * only exists at run time — e.g. `cad.edgeRef(part3, 17)` for the edge selection
 * of a Fillet/Chamfer (the EdgeTopoRef must be resolved against the live base
 * shape, so it cannot be baked into the IR as a literal).
 */
export interface JsExpr {
  /** the JS source to emit in the argument position */
  readonly __jsExpr: string;
}

/**
 * Wrap raw JS source as a verbatim argument (`JsExpr`).
 *
 * @param code - the JS expression source to emit in the argument position.
 * @returns the `JsExpr` marker carrying that source.
 */
export function jsExpr(code: string): JsExpr {
  return { __jsExpr: code };
}

/**
 * True for a `JsExpr` marker (used by M5 to render verbatim).
 *
 * @param v - the value to test.
 * @returns true when `v` is a `JsExpr` marker.
 */
export function isJsExpr(v: unknown): v is JsExpr {
  return typeof v === 'object' && v !== null && typeof (v as { __jsExpr?: unknown }).__jsExpr === 'string';
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
  'PartDesign::Revolution',
  'PartDesign::LinearPattern',
  'PartDesign::PolarPattern',
  'PartDesign::Fillet',
  'PartDesign::Chamfer',
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

/** Read a string-valued property (e.g. ReferenceAxis). */
function propStr(obj: FcstdObject, name: string): string | undefined {
  const el = obj.properties.get(name)?.children[0];
  const v = el?.attributes['value'];
  return v && v.length > 0 ? v : undefined;
}

/** Read an App::PropertyVector (`value="x y z"`) as a Vec3. */
function propVec(obj: FcstdObject, name: string): [number, number, number] | undefined {
  const raw = propStr(obj, name);
  if (!raw) return undefined;
  const parts = raw.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return undefined;
  return [parts[0]!, parts[1]!, parts[2]!];
}

/**
 * Read an `App::PropertyLinkSub`: the target object name plus its sub-element
 * names. FreeCAD serializes this as
 * `<LinkSub value="Pad001" count="2"><Sub value="Edge17"/><Sub value="Edge18"/></LinkSub>`.
 */
function propLinkSub(obj: FcstdObject, name: string): { obj: string; subs: string[] } | undefined {
  const el = obj.properties.get(name)?.children[0];
  if (!el) return undefined;
  const target = el.attributes['value'];
  if (!target || target.length === 0) return undefined;
  const subs: string[] = [];
  for (const sub of el.children) {
    const v = sub.attributes['value'];
    if (v) subs.push(v);
  }
  return { obj: target, subs };
}

/**
 * Parse FreeCAD edge sub-element names (`Edge17`) into 1-based ordinals.
 * Returns undefined when any entry is not an `EdgeN` reference (a Face/Vertex
 * selection cannot be expressed as a faijs `EdgeTopoRef`).
 */
function parseEdgeSubs(subs: readonly string[]): number[] | undefined {
  const out: number[] = [];
  for (const s of subs) {
    const m = /^Edge(\d+)$/.exec(s);
    if (!m) return undefined;
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1) return undefined;
    out.push(n);
  }
  return out;
}

/**
 * Build the `edges` argument for a fillet/chamfer call: one `cad.edgeRef(base, N)`
 * expression per FreeCAD edge ordinal. The refs must be resolved against the
 * live base shape at run time (an `EdgeTopoRef` is a two-face role pair, which
 * only the runtime naming layer knows), so they enter the IR as `JsExpr`.
 */
function edgeRefArgs(baseVar: string, ordinals: readonly number[]): JsExpr[] {
  return ordinals.map((n) => jsExpr(`cad.edgeRef(${baseVar}, ${n})`));
}

/**
 * Parse a PartDesign ReferenceAxis reference into a 3D axis + pivot point.
 *
 * FreeCAD stores this as an `App::PropertyLinkSub` string that either names a
 * standard body axis (`V_Axis` / `H_Axis` / `N_Axis`, or the generic `Axis`
 * that PartDesign revolves around = +Z) or an edge/vertex of another feature.
 * Edge/vertex axes require resolving referenced geometry, which the port does
 * not yet do (explicit downgrade, no silent loss).
 */
export function parseReferenceAxis(ref: string | undefined): { axis: [number, number, number]; at: [number, number, number] } | undefined {
  const at: [number, number, number] = [0, 0, 0];
  if (!ref) return { axis: [0, 0, 1], at };
  if (/Edge|Vertex/i.test(ref)) return undefined; // geometry-referenced axis: unsupported
  // Standard body axes. PartDesign LinearPattern stores Direction as a LinkSub
  // naming X_Axis/Y_Axis/Z_Axis; older ReferenceAxis uses V_Axis/H_Axis/N_Axis.
  if (/X_Axis|H_Axis/i.test(ref)) return { axis: [1, 0, 0], at };
  if (/Y_Axis/i.test(ref)) return { axis: [0, 1, 0], at };
  if (/Z_Axis|V_Axis/i.test(ref)) return { axis: [0, 0, 1], at };
  if (/N_Axis/i.test(ref)) return { axis: [1, 0, 0], at }; // legacy mapping, keep stable
  // The generic "Axis" or anything else defaults to +Z (sketch normal)
  return { axis: [0, 0, 1], at };
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
      // cad.extrude extrudes the sketch face into a prism along +Z (the sketch
      // normal in body-local frame); length sign encodes direction.
      if (midplane) {
        // symmetric about the sketch plane: two half-prisms fused
        const pos = `${out}__pos`;
        const neg = `${out}__neg`;
        const calls: CadCall[] = [
          { out: pos, op: 'cad.extrude', source: obj.name, inputs: [profileVar], literals: [[0, 0, len / 2]], params: {} },
          { out: neg, op: 'cad.extrude', source: obj.name, inputs: [profileVar], literals: [[0, 0, -len / 2]], params: {} },
          { out, op: 'cad.union', source: obj.name, inputs: [pos, neg], params: {} },
        ];
        return { kind: 'translated', calls };
      }
      const signed = reversed ? -len : len;
      return {
        kind: 'translated',
        calls: [{ out, op: 'cad.extrude', source: obj.name, inputs: [profileVar], literals: [[0, 0, signed]], params: {} }],
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
      if (midplane) return { kind: 'baked', reason: 'pocket-midplane-unsupported' };
      // Pocket cuts INTO the material: extrude the profile opposite the normal
      // (or along it when Reversed), then subtract from base.
      const signed = reversed ? len : -len;
      const cutVar = `${out}_cut`;
      const calls: CadCall[] = [{
        out: cutVar, op: 'cad.extrude', source: obj.name, inputs: [profileVar], literals: [[0, 0, signed]], params: {},
      }];
      calls.push({ out, op: 'cad.subtract', source: obj.name, inputs: [baseVar, cutVar], params: {} });
      return { kind: 'translated', calls };
    }
    case 'Part::Extrusion': {
      const base = propLink(obj, 'Base');
      const baseVar = base ? inputVar(base) : undefined;
      if (!baseVar) return { kind: 'baked', reason: 'extrusion-missing-base' };
      const len = propNum(obj, 'Length') ?? 0;
      const dir = propVec(obj, 'Dir') ?? [0, 0, 1];
      const reversed = propBool(obj, 'Reverse');
      const vec: [number, number, number] = [dir[0] * len, dir[1] * len, dir[2] * len];
      const s = reversed ? -1 : 1;
      return {
        kind: 'translated',
        calls: [{
          out, op: 'cad.extrude', source: obj.name, inputs: [baseVar],
          literals: [[s * vec[0], s * vec[1], s * vec[2]]], params: {},
        }],
      };
    }
    case 'PartDesign::Revolution': {
      const profile = profileLink(obj);
      const profileVar = profile ? inputVar(profile) : undefined;
      if (!profileVar) return { kind: 'baked', reason: 'revolution-missing-profile' };
      const angleDeg = propNum(obj, 'Angle') ?? 360;
      const angle = (angleDeg * Math.PI) / 180;
      const axisInfo = parseReferenceAxis(propStr(obj, 'ReferenceAxis'));
      if (!axisInfo) return { kind: 'baked', reason: 'revolution-edge-axis-unsupported' };
      return {
        kind: 'translated',
        calls: [{
          out, op: 'cad.revolve', source: obj.name, inputs: [profileVar],
          params: { axis: axisInfo.axis, at: axisInfo.at, angle },
        }],
      };
    }
    case 'PartDesign::LinearPattern': {
      const source = propLink(obj, 'Source');
      const sourceVar = source ? inputVar(source) : undefined;
      if (!sourceVar) return { kind: 'baked', reason: 'linear-pattern-missing-source' };
      const dirInfo = parseReferenceAxis(propStr(obj, 'Direction'));
      if (!dirInfo) return { kind: 'baked', reason: 'linear-pattern-edge-dir-unsupported' };
      const occ = Math.max(2, Math.round(propNum(obj, 'Occurrences') ?? 2));
      const length = propNum(obj, 'Length') ?? 0;
      const spacing = occ > 1 ? length / (occ - 1) : 0;
      return {
        kind: 'translated',
        calls: [{
          out, op: 'cad.linearPattern', source: obj.name, inputs: [sourceVar],
          literals: [dirInfo.axis, occ, spacing], params: {},
        }],
      };
    }
    case 'PartDesign::PolarPattern': {
      const source = propLink(obj, 'Source');
      const sourceVar = source ? inputVar(source) : undefined;
      if (!sourceVar) return { kind: 'baked', reason: 'polar-pattern-missing-source' };
      const axisInfo = parseReferenceAxis(propStr(obj, 'Axis'));
      if (!axisInfo) return { kind: 'baked', reason: 'polar-pattern-edge-axis-unsupported' };
      const occ = Math.max(2, Math.round(propNum(obj, 'Occurrences') ?? 2));
      const angle = propNum(obj, 'Angle') ?? 360;
      return {
        kind: 'translated',
        calls: [{
          out, op: 'cad.circularPattern', source: obj.name, inputs: [sourceVar],
          literals: [axisInfo.axis, occ, angle], params: {},
        }],
      };
    }
    case 'PartDesign::Fillet': {
      const base = propLinkSub(obj, 'Base');
      const baseVar = base ? inputVar(base.obj) : undefined;
      if (!baseVar) return { kind: 'baked', reason: 'fillet-missing-base' };
      if (propBool(obj, 'UseAllEdges')) return { kind: 'baked', reason: 'fillet-all-edges-unsupported' };
      if (!base || base.subs.length === 0) return { kind: 'baked', reason: 'fillet-no-edges' };
      const ordinals = parseEdgeSubs(base.subs);
      if (!ordinals) return { kind: 'baked', reason: 'fillet-non-edge-sub' };
      const radius = propNum(obj, 'Radius');
      if (radius === undefined || !(radius > 0)) return { kind: 'baked', reason: 'fillet-bad-radius' };
      return {
        kind: 'translated',
        calls: [{
          out, op: 'cad.fillet', source: obj.name, inputs: [baseVar],
          params: { edges: edgeRefArgs(baseVar, ordinals), radius },
        }],
      };
    }
    case 'PartDesign::Chamfer': {
      const base = propLinkSub(obj, 'Base');
      const baseVar = base ? inputVar(base.obj) : undefined;
      if (!baseVar) return { kind: 'baked', reason: 'chamfer-missing-base' };
      if (propBool(obj, 'UseAllEdges')) return { kind: 'baked', reason: 'chamfer-all-edges-unsupported' };
      if (!base || base.subs.length === 0) return { kind: 'baked', reason: 'chamfer-no-edges' };
      const ordinals = parseEdgeSubs(base.subs);
      if (!ordinals) return { kind: 'baked', reason: 'chamfer-non-edge-sub' };
      const edges = edgeRefArgs(baseVar, ordinals);
      // ChamferType enum (FeatureChamfer.cpp:55): 0 "Equal distance" (the
      // default when the property is absent, i.e. files predating it),
      // 1 "Two distances", 2 "Distance and Angle".
      const type = Math.round(propNum(obj, 'ChamferType') ?? 0);
      const size = propNum(obj, 'Size');
      if (type === 1) {
        const size2 = propNum(obj, 'Size2');
        if (size === undefined || !(size > 0) || size2 === undefined || !(size2 > 0)) {
          return { kind: 'baked', reason: 'chamfer-bad-two-distances' };
        }
        return {
          kind: 'translated',
          calls: [{
            out, op: 'cad.chamfer', source: obj.name, inputs: [baseVar],
            params: { edges, type: 'twoDistances', width1: size, width2: size2 },
          }],
        };
      }
      if (type === 2) {
        // FreeCAD's Angle is degrees, range 0–180 (floatAngle); cad.chamfer
        // accepts degrees in the open interval (0, 90) only.
        const angle = propNum(obj, 'Angle');
        if (size === undefined || !(size > 0) || angle === undefined || !(angle > 0 && angle < 90)) {
          return { kind: 'baked', reason: 'chamfer-bad-distance-angle' };
        }
        return {
          kind: 'translated',
          calls: [{
            out, op: 'cad.chamfer', source: obj.name, inputs: [baseVar],
            params: { edges, type: 'distanceAngle', width: size, angle },
          }],
        };
      }
      if (type !== 0) return { kind: 'baked', reason: `chamfer-unknown-type: ${type}` };
      if (size === undefined || !(size > 0)) return { kind: 'baked', reason: 'chamfer-bad-size' };
      return {
        kind: 'translated',
        calls: [{
          out, op: 'cad.chamfer', source: obj.name, inputs: [baseVar],
          params: { edges, type: 'equal', width: size },
        }],
      };
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
