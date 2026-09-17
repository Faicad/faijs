/**
 * M5 — code generation: object graph + M4 call plans → model/*.fai.js.
 *
 * M5.1 topological order: Body.Group order wins where present; otherwise
 * PropertyLink dependency order. Cycles / missing deps → baked (no fallback
 * heuristics — explicit downgrade per plan §12).
 * M5.2 lowering: params → JS constants; calls → `const partN = await cad.x(...)`;
 * statement ids sN. Sketch contours enter as blueprint literals.
 */
import type { FcstdDocument } from './document.js';
import type { CadCall, TranslateVerdict } from './feature-translate.js';
import { translateObject, isJsExpr } from './feature-translate.js';
import type { Contour } from './contour.js';
import { type Placement, isIdentityPlacement, quatToEulerXYZDeg } from './placement.js';

export interface GenObjectResult {
  name: string;
  type: string;
  /** variable name bound in generated code (partN) or undefined when baked */
  variable?: string;
  calls: CadCall[];
  disposition: 'translated' | 'baked' | 'preserved-only';
  reason?: string;
  /** M3 sketch verdict when the object is a sketch */
  sketch?: { level: 'L0' | 'L1' | 'L2'; reason?: string; loopCount?: number };
}

export interface GenResult {
  /** ordered translated calls (dependency order) */
  calls: CadCall[];
  objects: GenObjectResult[];
  /** generated .fai.js source */
  code: string;
}

interface Node {
  name: string;
  obj: ReturnType<FcstdDocument['objects'][number]['properties']['get']> extends never ? never : FcstdDocument['objects'][number];
  deps: Set<string>;
  verdict?: TranslateVerdict;
  variable?: string;
}

/** Extract link dependencies relevant for ordering. */
function depsOf(obj: FcstdDocument['objects'][number]): string[] {
  const out: string[] = [];
  const linkProps = ['Base', 'Tool', 'Profile', 'BaseFeature', 'Originals'];
  for (const p of linkProps) {
    const el = obj.properties.get(p)?.children[0];
    const v = el?.attributes['value'];
    if (v) out.push(v);
  }
  const shapes = obj.properties.get('Shapes')?.children[0];
  if (shapes) {
    for (const link of shapes.children) {
      const v = link.attributes['value'];
      if (v) out.push(v);
    }
  }
  return out;
}

/**
 * M5.1/M5.2 — translate every object in dependency order and lower to JS.
 * `sketchVerdict` supplies the M3 outcome per sketch object name; sketches
 * whose contour feeds a Pad/Pocket appear as inputs.
 */
export function generateModel(
  doc: FcstdDocument,
  sketchVerdict: Map<string, { level: 'L0' | 'L1' | 'L2'; reason?: string; loopCount?: number }>,
  sketchContours: Map<string, Contour[]>,
  baseName: string,
  /** M8.3: per-object Placement (sketches + features); missing → identity */
  placements?: Map<string, Placement>,
): GenResult {
  const byName = new Map(doc.objects.map((o) => [o.name, o]));
  const nodes = new Map<string, Node>();
  for (const obj of doc.objects) {
    nodes.set(obj.name, { name: obj.name, obj, deps: new Set(depsOf(obj)) });
  }

  // Kahn topological sort; objects with unbuilt deps fall back to insertion
  // order iteration until progress stalls (remaining are baked with reason).
  const order: string[] = [];
  const built = new Set<string>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const node of nodes.values()) {
      if (built.has(node.name)) continue;
      if ([...node.deps].every((d) => built.has(d) || !byName.has(d))) {
        built.add(node.name);
        order.push(node.name);
        progress = true;
      }
    }
  }

  const variables = new Map<string, string>();
  const results: GenObjectResult[] = [];
  const calls: CadCall[] = [];
  let partCounter = 0;
  const newVar = (): string => `part${partCounter++}`;

  // D-C (M9.4): same-Body features fuse cumulatively in Body.Group order —
  // the first translated feature is the base, every later additive feature
  // (Pad/…) unions with the chain, every subtractive one (Pocket/Cut)
  // subtracts. cad.group is NOT used inside a Body (that is assembly
  // semantics); cross-Body grouping stays in lower()'s root handling (M10).
  const memberToBody = new Map<string, string>();
  for (const obj of doc.objects) {
    if (obj.type !== 'PartDesign::Body') continue;
    const list = obj.properties.get('Group')?.children[0];
    for (const link of list?.children ?? []) {
      const m = link.attributes['value'];
      if (m && !memberToBody.has(m)) memberToBody.set(m, obj.name);
    }
  }
  const chainVar = new Map<string, string>(); // body name → accumulated var

  for (const name of order) {
    const node = nodes.get(name)!;
    const obj = node.obj;

    if (obj.type === 'Sketcher::SketchObject') {
      const verdict = sketchVerdict.get(name);
      const contours = sketchContours.get(name);
      const usable =
        !!verdict &&
        verdict.level !== 'L2' &&
        (verdict.loopCount ?? 0) > 0 &&
        !!contours &&
        contours.length > 0;
      if (usable) {
        // M6 wiring: emit a real `cad.sketch({contours})` creator so the
        // solved contour becomes a face variable the Pad/Pocket/Extrusion/
        // Revolution features below can consume.
        const v = newVar();
        variables.set(name, v);
        const sketchCall: CadCall = {
          out: v, op: 'cad.sketch', source: name, inputs: [], params: { contours },
        };
        calls.push(sketchCall);
        results.push({
          name, type: obj.type, variable: v, calls: [sketchCall], disposition: 'translated',
          sketch: verdict,
        });
      } else {
        results.push({
          name, type: obj.type, calls: [], disposition: 'baked',
          reason: verdict?.reason ?? (contours ? 'sketch-not-solved' : 'sketch-no-contours'), sketch: verdict,
        });
      }
      continue;
    }

    if (obj.type === 'App::Origin' || obj.type === 'App::Plane' || obj.type === 'App::Line') {
      results.push({ name, type: obj.type, calls: [], disposition: 'preserved-only', reason: 'datum' });
      continue;
    }

    // Sketches are now real face variables (see the Sketcher::SketchObject
    // branch above), so every dependency that resolves to one flows through.
    const verdict = translateObject(obj, (dep) => {
      const v = variables.get(dep);
      return v !== undefined ? v : undefined;
    });
    node.verdict = verdict;
    if (verdict.kind === 'translated') {
      // rename output vars to partN sequence
      for (const call of verdict.calls) {
        const v = newVar();
        variables.set(call.out, v);
        // remap inputs that were intermediate (Pocket_cut) or named outputs
        call.inputs = call.inputs.map((i) => variables.get(i) ?? i);
        call.out = v;
        calls.push(call);
      }
      // M9.4 (D-C): fold the feature into its Body's chain. Pocket/Cut
      // subtract from the chain; everything else unions onto it. The first
      // feature in Body.Group order becomes the chain base — no cad.group
      // inside a Body. Body itself is not a translated object here, so the
      // chain var is just carried; consumers (M10) will read chainVar.
      const body = memberToBody.get(name);
      const isSubtractive = obj.type === 'PartDesign::Pocket' || obj.type === 'Part::Cut';
      if (body) {
        const featureVar = verdict.calls.at(-1)!.out;
        const prev = chainVar.get(body);
        if (!prev) {
          chainVar.set(body, featureVar); // base feature
        } else if (isSubtractive && verdict.calls.at(-1)!.op === 'cad.subtract' && verdict.calls.at(-1)!.inputs.includes(prev)) {
          // Pocket already subtracted from the chain var itself (BaseFeature
          // resolved to the chain) — its output IS the new chain head; no
          // extra subtract (would cut twice).
          chainVar.set(body, featureVar);
        } else if (isSubtractive) {
          const nv = newVar();
          calls.push({ out: nv, op: 'cad.subtract', source: name, inputs: [prev, featureVar], params: {} });
          chainVar.set(body, nv);
        } else {
          const nv = newVar();
          calls.push({ out: nv, op: 'cad.union', source: name, inputs: [prev, featureVar], params: {} });
          chainVar.set(body, nv);
        }
      }
      // M8.3: features build in sketch-local coordinates (cad.sketch lays the
      // face on local XY; extrude runs along local +Z). Re-orient the final
      // solid by the OBJECT's own Placement: rotate_euler then translate, so
      // the result lands where FreeCAD puts it. Identity placements emit nothing.
      const lastVar = verdict.calls.at(-1)?.out;
      const pl = placements?.get(name);
      if (lastVar && pl && !isIdentityPlacement(pl)) {
        let cur = lastVar;
        const euler = quatToEulerXYZDeg(pl.q);
        const isRotation = Math.abs(euler[0]) > 1e-9 || Math.abs(euler[1]) > 1e-9 || Math.abs(euler[2]) > 1e-9;
        if (isRotation) {
          const rv = newVar();
          variables.set(cur, rv); // map old name → rotated var for consumers
          calls.push({ out: rv, op: 'cad.rotate_euler', source: name, inputs: [cur], params: { anglesDeg: euler } });
          cur = rv;
        }
        const needsTranslate = Math.abs(pl.p[0]) > 1e-9 || Math.abs(pl.p[1]) > 1e-9 || Math.abs(pl.p[2]) > 1e-9;
        if (needsTranslate) {
          const tv = newVar();
          variables.set(cur, tv);
          calls.push({ out: tv, op: 'cad.translate', source: name, inputs: [cur], params: { offset: [...pl.p] } });
          cur = tv;
        }
        // the object's variable is now the fully placed result
        variables.set(name, cur);
      }
      results.push({ name, type: obj.type, variable: verdict.calls.at(-1)?.out, calls: verdict.calls, disposition: 'translated' });
    } else if (verdict.kind === 'baked') {
      results.push({ name, type: obj.type, calls: [], disposition: 'baked', reason: verdict.reason });
    } else {
      results.push({ name, type: obj.type, calls: [], disposition: 'preserved-only', reason: verdict.reason });
    }
  }

  // also mark unreachable (cycle) objects as baked
  for (const obj of doc.objects) {
    if (!results.some((r) => r.name === obj.name)) {
      results.push({ name: obj.name, type: obj.type, calls: [], disposition: 'baked', reason: 'dependency-cycle' });
    }
  }

  const code = lower(calls, baseName);
  return { calls, objects: results, code };
}

/** M5.2 — lower the call plan to .fai.js source. faijs syntax: top-level
 * statement flow with `let partN = cad.x(...)`; no wrapper function. */
function lower(calls: CadCall[], baseName: string): string {
  const lines: string[] = [];
  lines.push(`// Generated by faijs FCStd port — ${baseName}`);
  lines.push(`// Units: mm (faijs contract; FCStd internal units are mm)`);
  for (const call of calls) {
    const id = `s${lines.length - 2}`; // statement id sN
    const args = renderArgs(call);
    lines.push(`let ${call.out} = ${call.op}(${args}); // ${id} ${call.source}`);
  }
  // final shape: union of root calls that nobody consumes; faijs scripts
  // end with the output-producing statement (no return, per fixtures).
  const consumed = new Set(calls.flatMap((c) => c.inputs));
  const roots = calls.filter((c) => !consumed.has(c.out)).map((c) => c.out);
  if (roots.length > 1) {
    lines.push(`let part_out = cad.group({ members: [${roots.join(', ')}] });`);
  } else if (roots.length === 0) {
    lines.push(`// no translated geometry (all baked)`);
  }
  return lines.join('\n') + '\n';
}

/**
 * M5.2 — render one IR value as JS. Plain values JSON-encode (byte-identical to
 * the pre-JsExpr output); a `JsExpr` marker renders verbatim, and a container
 * holding one renders element-wise so the expression survives into the source.
 */
function renderValue(v: unknown): string {
  if (isJsExpr(v)) return v.__jsExpr;
  if (Array.isArray(v)) {
    if (v.some(isJsExpr)) return `[${v.map(renderValue).join(', ')}]`;
    return JSON.stringify(v);
  }
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.some(([, val]) => containsJsExpr(val))) {
      return `{ ${entries.map(([k, val]) => `${k}: ${renderValue(val)}`).join(', ')} }`;
    }
    return JSON.stringify(v);
  }
  return JSON.stringify(v);
}

/** True when a value is or (recursively) contains a `JsExpr` marker. */
function containsJsExpr(v: unknown): boolean {
  if (isJsExpr(v)) return true;
  if (Array.isArray(v)) return v.some(containsJsExpr);
  if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).some(containsJsExpr);
  return false;
}

function renderArgs(call: CadCall): string {
  const positional: string[] = [
    ...call.inputs.map((i) => i),
    ...(call.literals ?? []).map((l) => renderValue(l)),
  ].filter((s) => s.length > 0); // M7.1: drop empty entries so we never emit `(, `
  const named: string[] = [];
  for (const [k, v] of Object.entries(call.params ?? {})) {
    if (v === undefined) continue;
    named.push(`${k}: ${renderValue(v)}`);
  }
  const namedBlock = named.length ? `{ ${named.join(', ')} }` : '';
  // M7.1: no leading comma when there are no positional args — a call with only
  // named params must render as `cad.sketch({ ... })`, never `cad.sketch(, {...})`.
  const rest = namedBlock ? (positional.length ? `, ${namedBlock}` : namedBlock) : '';
  return `${positional.join(', ')}${rest}`;
}
