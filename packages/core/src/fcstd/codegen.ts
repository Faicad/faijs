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
import { translateObject } from './feature-translate.js';

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
  baseName: string,
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

  for (const name of order) {
    const node = nodes.get(name)!;
    const obj = node.obj;

    if (obj.type === 'Sketcher::SketchObject') {
      const verdict = sketchVerdict.get(name);
      const usable = verdict && verdict.level !== 'L2' && (verdict.loopCount ?? 0) > 0;
      if (usable) {
        // D1: solved contour is recorded in mapping.json (gcs field) for the
        // future editable-sketch upgrade. The script surface has no sketch
        // declaration syntax yet (M6 wiring), so no variable is emitted.
        variables.set(name, `@sketch:${name}`);
        results.push({
          name, type: obj.type, calls: [], disposition: 'translated',
          sketch: verdict,
        });
      } else {
        results.push({
          name, type: obj.type, calls: [], disposition: 'baked',
          reason: verdict?.reason ?? 'sketch-not-solved', sketch: verdict,
        });
      }
      continue;
    }

    if (obj.type === 'App::Origin' || obj.type === 'App::Plane' || obj.type === 'App::Line') {
      results.push({ name, type: obj.type, calls: [], disposition: 'preserved-only', reason: 'datum' });
      continue;
    }

    // '@sketch:' entries are M3 records, not script-surface variables —
    // a Pad/Pocket profile referencing them stays baked until M6 wires
    // sketch contours into the cad face.
    const verdict = translateObject(obj, (dep) => {
      const v = variables.get(dep);
      return v !== undefined && !v.startsWith('@sketch:') ? v : undefined;
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

function renderArgs(call: CadCall): string {
  const positional: string[] = call.inputs.map((i) => i);
  const named: string[] = [];
  for (const [k, v] of Object.entries(call.params)) {
    if (v === undefined) continue;
    named.push(`${k}: ${JSON.stringify(v)}`);
  }
  const rest = named.length ? `, { ${named.join(', ')} }` : '';
  return `${positional.join(', ')}${rest}`;
}
