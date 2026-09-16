/**
 * M6.2 — expression downgrade: <ExpressionEngine> → concrete values.
 *
 * Format (verified on TwoLengthsPadWithExpression.FCStd):
 *   <ExpressionEngine count="N">
 *     <Expression path="Length" expression="10 mm" />
 *   </ExpressionEngine>
 *
 * Scope: constant expressions only — number literals with optional unit
 * (mm/m/cm/in/deg/rad). Anything else (object references like Sketch.Constraints[3],
 * arithmetic with identifiers, functions) is NOT evaluated: the consumer must
 * treat the property as unknown and degrade (no heuristic fallback, plan §12).
 */

export type ExprValue = number | undefined;

const UNIT_TO_MM: Record<string, number> = {
  mm: 1, millimeter: 1,
  cm: 10, centimeter: 10,
  m: 1000, meter: 1000,
  in: 25.4, inch: 25.4, '"': 25.4,
  ft: 304.8, foot: 304.8,
  // angles: value kept in the expression's own unit; callers interpret
  deg: 1, degree: 1, '°': 1,
  rad: 1, radian: 1,
};

/**
 * Evaluate a constant expression. Returns undefined when the expression is
 * not a bare constant (reference/arithmetic/function) — explicit unsupported,
 * no guessing.
 */
export function evalConstantExpression(expr: string): ExprValue {
  const s = expr.trim();
  // number [unit]
  const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*([A-Za-z°"]*)$/.exec(s);
  if (!m) return undefined;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return undefined;
  const unit = m[2]!;
  if (unit === '') return value;
  const factor = UNIT_TO_MM[unit.toLowerCase()];
  if (factor === undefined) return undefined; // unknown unit → unsupported
  return value * factor;
}

export interface ExpressionBinding {
  /** property path, e.g. "Length" or ".Length" */
  path: string;
  /** raw expression string */
  expression: string;
  /** evaluated constant; undefined when not a constant expression */
  value?: number;
}

/**
 * Extract expression bindings from a parsed ExpressionEngine property.
 * `bindable` = every expression evaluated to a constant (then the property
 * values can be overridden); otherwise the engine is only partially readable.
 */
export function parseExpressionEngine(
  prop: { children: { children: { attributes: Record<string, string> }[] }[] } | undefined,
): ExpressionBinding[] {
  const engineEl = prop?.children[0];
  if (!engineEl) return [];
  const out: ExpressionBinding[] = [];
  for (const el of engineEl.children) {
    if (el.tagName !== 'Expression') continue;
    const path = el.attributes['path'] ?? '';
    const expression = el.attributes['expression'] ?? '';
    out.push({ path, expression, value: evalConstantExpression(expression) });
  }
  return out;
}

/** True when all bindings are constants → safe to override property values. */
export function allConstant(bindings: ExpressionBinding[]): boolean {
  return bindings.length > 0 && bindings.every((b) => b.value !== undefined);
}
