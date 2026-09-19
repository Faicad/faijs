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
import { parseExpressionEngine, type ExpressionBinding } from './expressions.js';
import { placementOf, quatToMatrix } from './placement.js';

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
  | { kind: 'translated'; calls: CadCall[]; reason?: string }
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
  // M13.1 (probed on real corpus — scripts/probe-m13-types.ts):
  // Part::Compound carries a Links PropertyLinkList; Part::Sphere carries
  // Radius (+ optional Angle like Cylinder).
  'Part::Compound',
  'Part::Sphere',
]);

export function isWhitelisted(type: string): boolean {
  return WHITELIST.has(type);
}

function propNum(obj: FcstdObject, name: string): number | undefined {
  // M11.1: an ExpressionEngine binding overrides the stored <Float> value
  // (FreeCAD recomputes bound properties from expressions on load). A
  // non-constant binding is reported via exprBindingOf, not guessed here.
  const bound = expressionBindingOf(obj, name);
  if (bound && bound.value !== undefined) return bound.value;
  const p = obj.properties.get(name);
  if (!p) return undefined;
  const el = p.children[0];
  const v = el?.attributes['value'];
  return v === undefined ? undefined : Number(v);
}

/**
 * M11.1/M11.2: the ExpressionEngine binding for `name`, if any. `value` is
 * undefined for non-constant expressions (references/arithmetic) — the caller
 * must bake with an explicit reason instead of estimating.
 */
export function expressionBindingOf(obj: FcstdObject, name: string): ExpressionBinding | undefined {
  const bindings = parseExpressionEngine(obj.properties.get('ExpressionEngine') as never);
  if (bindings.length === 0) return undefined;
  const norm = (p: string): string => (p.startsWith('.') ? p.slice(1) : p);
  return bindings.find((b) => norm(b.path) === name);
}

/** M11.2: true when `name` has a binding that is NOT a constant expression. */
export function hasNonConstantBinding(obj: FcstdObject, name: string): boolean {
  const b = expressionBindingOf(obj, name);
  return b !== undefined && b.value === undefined;
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

/**
 * M9.1 — Pad/Pocket `Type` enumeration (App::PropertyEnumeration, stored as
 * the string enum label OR its integer index — both seen in the corpus).
 * FreeCAD sources: Pad.h / Pocket.h TypeEnum lists (differs between the two):
 *   Pad:    0=Length 1=UpToLast 2=UpToFirst 3=UpToFace 4=TwoLengths
 *   Pocket: 0=Length 1=ThroughAll 2=UpToFirst 3=UpToFace 4=TwoLengths
 * A missing Type property means Length (0) — the FreeCAD default.
 */
export type FeatureType =
  | 'Length' | 'ThroughAll' | 'UpToFirst' | 'UpToFace' | 'TwoLengths' | 'unknown';

const PAD_TYPES: Record<string, FeatureType> = {
  '0': 'Length', '1': 'UpToLast', '2': 'UpToFirst', '3': 'UpToFace', '4': 'TwoLengths',
  Length: 'Length', UpToLast: 'UpToLast', UpToFirst: 'UpToFirst', UpToFace: 'UpToFace', TwoLengths: 'TwoLengths',
};
const POCKET_TYPES: Record<string, FeatureType> = {
  '0': 'Length', '1': 'ThroughAll', '2': 'UpToFirst', '3': 'UpToFace', '4': 'TwoLengths',
  Length: 'Length', ThroughAll: 'ThroughAll', UpToFirst: 'UpToFirst', UpToFace: 'UpToFace', TwoLengths: 'TwoLengths',
};

export function featureTypeOf(obj: FcstdObject, kind: 'pad' | 'pocket'): FeatureType {
  const el = obj.properties.get('Type')?.children[0];
  const raw = el?.attributes['value'];
  if (raw === undefined || raw === '') return 'Length';
  const table = kind === 'pad' ? PAD_TYPES : POCKET_TYPES;
  return table[raw] ?? 'unknown';
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
 * Parse a FreeCAD face sub-element name (`Face3`) into a 1-based ordinal.
 * Returns undefined when the selection is not a plain `FaceN` reference (e.g. a
 * TNaming-modified name `"Face__20f_..."`, an `Edge*`/`Vertex*` selection, or a
 * multi-face set) so the caller can bake with an explicit reason instead of
 * guessing. The ordinal is consumed by `cad.faceRef`, whose face enumeration
 * order is calibrated to match FreeCAD's `FaceN` (plan §4.3-C2 / R-A).
 */
function parseFaceSub(subs: readonly string[]): number | undefined {
  if (subs.length !== 1) return undefined;
  const m = /^Face(\d+)$/.exec(subs[0]!);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
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
 *
 * `docObjects` (optional) is the full document object list — needed by the
 * UpToFace datum-plane path to read the target plane's Placement (plan
 * extrude-upto-face §4.3-C1). When absent, UpToFace keeps the explicit bake.
 */
export function translateObject(
  obj: FcstdObject,
  inputVar: (depName: string) => string | undefined,
  docObjects?: readonly FcstdObject[],
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
    case 'Part::Compound': {
      // M13.1 probe (ArchDetail.FCStd): members live in a `Links`
      // PropertyLinkList; every corpus instance also stores a baked .brp,
      // but translating the member group keeps the chain explicit.
      const linksEl = obj.properties.get('Links')?.children[0];
      const members: string[] = [];
      for (const link of linksEl?.children ?? []) {
        const v = link.attributes['value'];
        if (v) members.push(v);
      }
      const vars = members.map((m) => inputVar(m));
      if (vars.length === 0 || vars.some((v) => v === undefined)) {
        return { kind: 'baked', reason: 'compound-missing-members' };
      }
      return {
        kind: 'translated',
        calls: [{
          out, op: 'cad.group', source: obj.name, inputs: vars as string[],
          params: { members: vars },
        }],
      };
    }
    case 'Part::Sphere': {
      const r = propNum(obj, 'Radius');
      if (r === undefined || r <= 0) return { kind: 'baked', reason: 'sphere-missing-radius' };
      const angle1 = propNum(obj, 'Angle1') ?? -90;
      const angle2 = propNum(obj, 'Angle2') ?? 90;
      const angle3 = propNum(obj, 'Angle3') ?? 360;
      if (angle1 !== -90 || angle2 !== 90 || angle3 !== 360) {
        return { kind: 'baked', reason: 'sphere-partial-angle' };
      }
      const [x, y, z] = placementPos(obj);
      return {
        kind: 'translated',
        calls: [{
          out, op: 'cad.sphere', source: obj.name, inputs: [],
          params: { radius: r, at: [x, y, z] },
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
      // M11.2: a non-constant expression binding (cross-object reference /
      // identifier arithmetic) leaves the length unknown — explicit bake,
      // never estimate (plan §12).
      if (hasNonConstantBinding(obj, 'Length')) {
        return { kind: 'baked', reason: 'pad-length-expression-non-constant' };
      }
      // M9.1/M9.2: Type-driven semantics — no silent Length fallback.
      const ftype = featureTypeOf(obj, 'pad');
      if (ftype === 'TwoLengths') {
        const len2 = propNum(obj, 'Length2') ?? 0;
        // TwoLengths: Length forward + Length2 backward, fused. Named
        // intermediate vars so mapping/debug can locate each segment.
        const pos = `${out}__pos`;
        const neg = `${out}__neg`;
        const calls: CadCall[] = [
          { out: pos, op: 'cad.extrude', source: obj.name, inputs: [profileVar], literals: [[0, 0, len]], params: {} },
          { out: neg, op: 'cad.extrude', source: obj.name, inputs: [profileVar], literals: [[0, 0, -len2]], params: {} },
          { out, op: 'cad.union', source: obj.name, inputs: [pos, neg], params: {} },
        ];
        return { kind: 'translated', calls };
      }
      if (ftype === 'UpToFace') {
        // extrude-upto-face plan §4.3-C1: when the target is a datum plane
        // (PartDesign::Plane — an infinite plane, not a solid face), the
        // extrude length is the exact signed distance from the profile plane
        // to the datum plane. Zero bake, no faceRef needed.
        const upTo = propLinkSub(obj, 'UpToFace');
        if (upTo && docObjects) {
          const target = docObjects.find((o) => o.name === upTo.obj);
          // C1 (extrude-upto-face §4.3-C1): datum plane (infinite plane) →
          // exact signed distance → cad.extrude({ length }). No faceRef needed.
          if (target && target.type === 'PartDesign::Plane') {
            const pl = placementOf(target);
            // datum plane normal = placement R * local +Z
            const m = quatToMatrix(pl.q);
            const normal: [number, number, number] = [m[2]!, m[5]!, m[8]!];
            // sketch normal (the extrude direction); the profile sketch lies on
            // its own placement, and the feature extrudes along it.
            const skPl = placementOf(docObjects.find((o) => o.name === (profile ?? '')) ?? target);
            const skM = quatToMatrix(skPl.q);
            const dir: [number, number, number] = [skM[2]!, skM[5]!, skM[8]!];
            // GOTCHA (probe-upto-padtest-verify.ts, PadTest Pad001): the datum
            // plane is an arbitrary plane, NOT axis-aligned to the extrude
            // direction. The signed distance to reach it along `dir` is
            //   t = ((pl.p - skPl.p) · n) / (dir · n)
            // where n is the datum plane normal — NOT the naive (Δp · dir),
            // which only works when n ∥ dir (axis-aligned). The naive form
            // yields −50 for PadTest while the true distance is +10; the
            // corrected form matches FreeCAD's Tip bbox exactly (diag 156.84).
            const denom = dir[0] * normal[0] + dir[1] * normal[1] + dir[2] * normal[2];
            // plane parallel to the extrude direction → no finite intersection
            if (!Number.isFinite(denom) || Math.abs(denom) < 1e-9) {
              return { kind: 'baked', reason: 'uptoface-datum-plane-parallel' };
            }
            const dpn =
              (pl.p[0] - skPl.p[0]) * normal[0] +
              (pl.p[1] - skPl.p[1]) * normal[1] +
              (pl.p[2] - skPl.p[2]) * normal[2];
            const t = dpn / denom;
            if (Number.isFinite(t) && Math.abs(t) > 1e-9) {
              // GOTCHA (PadTest V6 residual, relErr 3.02%): the datum plane may
              // be TILTED relative to the extrude direction (Pad001: datum
              // normal (−0.038·…) not parallel to the sketch normal). A fixed
              // length `signed` gives a FLAT top; FreeCAD's Pad reaches the
              // PLANE, producing a slanted top (truth AddShape 4860.42 vs flat
              // disc 1874.83). Emit an explicit plane target instead and let
              // the kernel's half-space intersection produce the slanted cut.
              // The extrude runs in sketch-local coords, so transform the
              // global plane into the sketch frame: p_local = R⁻¹(p_g − sk.p),
              // n_local = R⁻¹(n_g) (R⁻¹ = Rᵀ).
              const inv = [0, 1, 2].map((c) => [
                skM[c]!, skM[3 + c]!, skM[6 + c]!,
              ]);
              const d = [
                pl.p[0] - skPl.p[0], pl.p[1] - skPl.p[1], pl.p[2] - skPl.p[2],
              ] as [number, number, number];
              const ptLocal: [number, number, number] = [
                inv[0]![0]! * d[0] + inv[0]![1]! * d[1] + inv[0]![2]! * d[2],
                inv[1]![0]! * d[0] + inv[1]![1]! * d[1] + inv[1]![2]! * d[2],
                inv[2]![0]! * d[0] + inv[2]![1]! * d[1] + inv[2]![2]! * d[2],
              ];
              const nLocal: [number, number, number] = [
                inv[0]![0]! * normal[0] + inv[0]![1]! * normal[1] + inv[0]![2]! * normal[2],
                inv[1]![0]! * normal[0] + inv[1]![1]! * normal[1] + inv[1]![2]! * normal[2],
                inv[2]![0]! * normal[0] + inv[2]![1]! * normal[1] + inv[2]![2]! * normal[2],
              ];
              return {
                kind: 'translated',
                reason: 'uptoface-via-datum-plane-distance',
                calls: [{
                  out, op: 'cad.extrude', source: obj.name, inputs: [profileVar],
                  params: { upTo: { plane: { point: ptLocal, normal: nLocal } } },
                }],
              };
            }
            return { kind: 'baked', reason: 'uptoface-datum-plane-degenerate-distance' };
          }
          // C2.2 (extrude-upto-face §4.3-C2 point 2): solid-feature target →
          // reference its face by ordinal via `cad.extrude({ upTo:
          // cad.faceRef(targetVar, N) })`. faceRef's ordinal is calibrated to
          // match FreeCAD's `FaceN` (R-A, same TopExp::MapShapes + IndexedMap
          // enumeration as edgeRef); the runtime naming layer resolves the ref
          // against the live target shape, so it enters the IR as a JsExpr.
          if (target) {
            const targetVar = inputVar(upTo.obj);
            if (targetVar) {
              const faceN = parseFaceSub(upTo.subs);
              if (faceN !== undefined) {
                return {
                  kind: 'translated',
                  reason: 'uptoface-via-faceRef',
                  calls: [{
                    out, op: 'cad.extrude', source: obj.name, inputs: [profileVar],
                    params: { upTo: jsExpr(`cad.faceRef(${targetVar}, ${faceN})`) },
                  }],
                };
              }
              // sub present but not a plain FaceN reference → explicit bake
              return { kind: 'baked', reason: 'uptoface-sub-unparseable' };
            }
          }
        }
        return { kind: 'baked', reason: 'uptoface-solid-face-unsupported' };
      }
      if (ftype === 'UpToLast' || ftype === 'UpToFirst') {
        // plan §4.3-C2: UpToLast/UpToFirst extrude to the far/near face of the
        // support (BaseFeature) via `cad.extrude({ upTo: 'last' | 'first' })`
        // (up-to lives on the platform op cad.extrude, never on fai_extrude).
        // The kernel up-to does the truncation; baseFeature must be resolvable
        // or we bake explicitly — no silent bbox-derived length guess.
        const base = propLink(obj, 'BaseFeature');
        const baseVar = base ? inputVar(base) : undefined;
        if (!baseVar) return { kind: 'baked', reason: 'pad-upTo-missing-base' };
        const upTo = ftype === 'UpToLast' ? 'last' : 'first';
        return {
          kind: 'translated',
          reason: `pad-${ftype}-via-baseFeature`,
          calls: [{
            out, op: 'cad.extrude', source: obj.name, inputs: [profileVar],
            params: { upTo, baseFeature: jsExpr(baseVar) },
          }],
        };
      }
      if (ftype !== 'Length') {
        // anything still non-Length (e.g. 'unknown') → explicit bake, never guess
        return { kind: 'baked', reason: `pad-type-${ftype}-unsupported` };
      }
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
      if (hasNonConstantBinding(obj, 'Length')) {
        return { kind: 'baked', reason: 'pocket-length-expression-non-constant' };
      }
      // M9.1/M9.2/M9.3: Type-driven semantics — explicit bake for anything
      // beyond plain Length / TwoLengths (no silent downgrade).
      const ftype = featureTypeOf(obj, 'pocket');
      if (ftype !== 'Length' && ftype !== 'TwoLengths') {
        return { kind: 'baked', reason: `pocket-type-${ftype}-unsupported` };
      }
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
