/**
 * cadquery-selectors/grammar — CadQuery string-syntax selector grammar.
 *
 * Hand-rolled recursive-descent parser mirroring the upstream grammar
 * `cadquery/selectors.py::_makeGrammar` + `_makeExpressionGrammar`. No
 * pyparsing dependency is introduced; this small grammar is hand-parsed.
 *
 * Precedence (pyparsing infix_notation lists operators lowest→highest):
 *   `and` (lowest) < `or` < `exc`/`except` < `not` (highest)
 * so `not` binds tightest and `and` sits at the root of the tree.
 *
 * Atom forms (upstream `_makeGrammar`):
 *   * bare direction        `X`|`Y`|`Z`|`XY`|`XZ`|`YZ`|`(x,y,z)`  → DirectionSelector
 *   * named view            `front`|`back`|`left`|`right`|`top`|`bottom` → DirectionMinMax
 *   * `%TYPE`               type_op + caseless LUT member (upcased)  → TypeSelector
 *   * `>A` / `>A[k]`        direction_op + dir + optional index  → DirectionNth
 *   * `>>A` / `<<A[k]`      center_nth_op + dir + optional index  → CenterNth
 *   * `|A`|`#A`|`+A`|`-A`    other_op + direction  → Parallel / Perp / Direction
 *
 * Binary operators fold their operands into a single n-ary node, matching the
 * pyparsing odd-indexed reduce in the upstream callbacks.
 */

import type { AtomDesc, SelectorExpr, Vec3 } from './types'

/**
 * The complete set of syntax features this grammar supports, in one place.
 * The selector-parity plan drives its coverage gate off this list — adding a
 * syntax feature without a coverage entry fails that gate.
 */
export const SYNTAX_FEATURES: { group: string; name: string; token: string }[] = [
  // operator modifiers
  ...['>', '<', '>>', '<<', '|', '#', '+', '-', '%'].map((token) => ({
    group: 'modifier',
    name: token,
    token,
  })),
  // axes
  ...['X', 'Y', 'Z', 'XY', 'XZ', 'YZ', '(x,y,z)'].map((token) => ({
    group: 'axis',
    name: token,
    token,
  })),
  // type filter
  ...['PLANE', 'CYLINDER', 'CONE', 'SPHERE', 'TORUS', 'BEZIER', 'BSPLINE', 'REVOLUTION', 'EXTRUSION', 'OFFSET', 'OTHER', 'LINE', 'CIRCLE', 'ELLIPSE', 'HYPERBOLA', 'PARABOLA'].map(
    (token) => ({ group: 'type', name: token.toLowerCase(), token }),
  ),
  // named views
  ...['front', 'back', 'left', 'right', 'top', 'bottom'].map((token) => ({
    group: 'view',
    name: token,
    token,
  })),
  // logical connectives
  ...['and', 'or', 'exc', 'except', 'not'].map((token) => ({
    group: 'logical',
    name: token,
    token,
  })),
  // index suffix
  { group: 'index', name: '[k]', token: '[k]' },
]

/** Named views → (direction, max) — upstream `_SimpleStringSyntaxSelector.namedViews`. */
export const NAMED_VIEW: Record<string, { vec: Vec3; max: boolean }> = {
  front: { vec: { x: 0, y: 0, z: 1 }, max: true },
  back: { vec: { x: 0, y: 0, z: 1 }, max: false },
  left: { vec: { x: 1, y: 0, z: 0 }, max: false },
  right: { vec: { x: 1, y: 0, z: 0 }, max: true },
  top: { vec: { x: 0, y: 1, z: 0 }, max: true },
  bottom: { vec: { x: 0, y: 1, z: 0 }, max: false },
}

/** Axes table — upstream `_SimpleStringSyntaxSelector.axes` (kept NON-unit). */
export const AXES: Record<string, Vec3> = {
  X: { x: 1, y: 0, z: 0 },
  Y: { x: 0, y: 1, z: 0 },
  Z: { x: 0, y: 0, z: 1 },
  XY: { x: 1, y: 1, z: 0 },
  YZ: { x: 0, y: 1, z: 1 },
  XZ: { x: 1, y: 0, z: 1 },
}

/** Valid `%type` names — union of upstream geom_LUT_EDGE ∪ geom_LUT_FACE values. */
export const TYPE_NAMES: ReadonlySet<string> = new Set([
  'PLANE', 'CYLINDER', 'CONE', 'SPHERE', 'TORUS', 'BEZIER', 'BSPLINE',
  'REVOLUTION', 'EXTRUSION', 'OFFSET', 'OTHER',
  'LINE', 'CIRCLE', 'ELLIPSE', 'HYPERBOLA', 'PARABOLA',
])

// ── Lexer ───────────────────────────────────────────────────────────────────

type Tok =
  | { t: 'op'; v: string } // multi/single-char operator or bracket / comma
  | { t: 'word'; v: string } // identifier / keyword (upstream Word())
  | { t: 'num'; v: string } // numeric literal string (kept raw; no sign)

function lex(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    // multi-char direction selectors must be checked before their single char
    if ((c === '>' || c === '<') && src[i + 1] === c) {
      out.push({ t: 'op', v: c + c })
      i += 2
      continue
    }
    if (c === '(' || c === ')' || c === '[' || c === ']' || c === ',') {
      out.push({ t: 'op', v: c })
      i++
      continue
    }
    if (c === '>' || c === '<' || c === '|' || c === '#' || c === '%') {
      out.push({ t: 'op', v: c })
      i++
      continue
    }
    // `+` and `-` are context-dependent: operator (`+Z`) or sign (`[-1]`, `(-1,0,0)`).
    if (c === '+' || c === '-') {
      out.push({ t: 'op', v: c })
      i++
      continue
    }
    if (/[0-9]/.test(c) || c === '.') {
      let j = i
      while (j < n && /[0-9.]/.test(src[j])) j++
      out.push({ t: 'num', v: src.slice(i, j) })
      i = j
      continue
    }
    if (/[A-Za-z]/.test(c)) {
      let j = i
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++
      out.push({ t: 'word', v: src.slice(i, j) })
      i = j
      continue
    }
    throw new SyntaxError(`[cadquery-selectors] unexpected character "${c}" at ${i}`)
  }
  return out
}

// ── Parser (recursive descent over tokens) ──────────────────────────────────

class Parser {
  private readonly toks: Tok[]
  private pos = 0

  constructor(src: string) {
    this.toks = lex(src)
  }

  private peek(): Tok | undefined {
    return this.toks[this.pos]
  }

  private next(): Tok | undefined {
    return this.toks[this.pos++]
  }

  private eof(): boolean {
    return this.pos >= this.toks.length
  }

  /** Consume an operator token with value `v`, or throw. */
  private eatOp(v: string): void {
    const t = this.peek()
    if (!t || t.t !== 'op' || t.v !== v) {
      throw new SyntaxError(`[cadquery-selectors] expected "${v}"`)
    }
    this.pos++
  }

  /** Look at current token: is it an operator token with value v? */
  private atOp(v: string): boolean {
    const t = this.peek()
    return !!t && t.t === 'op' && t.v === v
  }

  /** Look at current token: is it the given keyword (case-insensitive)? */
  private atWord(w: string): boolean {
    const t = this.peek()
    return !!t && t.t === 'word' && t.v.toLowerCase() === w
  }

  parse(): SelectorExpr {
    const expr = this.parseAnd()
    if (!this.eof()) {
      throw new SyntaxError(`[cadquery-selectors] trailing input at position ${this.pos}`)
    }
    return expr
  }

  // `and` — lowest precedence; left-associative n-ary fold.
  private parseAnd(): SelectorExpr {
    const terms: SelectorExpr[] = [this.parseOr()]
    while (this.atWord('and')) {
      this.pos++
      terms.push(this.parseOr())
    }
    return terms.length === 1 ? terms[0]! : { op: 'and', terms }
  }

  private parseOr(): SelectorExpr {
    const terms: SelectorExpr[] = [this.parseExc()]
    while (this.atWord('or')) {
      this.pos++
      terms.push(this.parseExc())
    }
    return terms.length === 1 ? terms[0]! : { op: 'or', terms }
  }

  private parseExc(): SelectorExpr {
    const terms: SelectorExpr[] = [this.parseNot()]
    while (this.atWord('exc') || this.atWord('except')) {
      this.pos++
      terms.push(this.parseNot())
    }
    return terms.length === 1 ? terms[0]! : { op: 'exc', terms }
  }

  // `not` — highest precedence, unary, right-associative.
  private parseNot(): SelectorExpr {
    if (this.atWord('not')) {
      this.pos++
      return { op: 'not', term: this.parseNot() }
    }
    if (this.atOp('(')) {
      this.pos++
      const inner = this.parseAnd()
      this.eatOp(')')
      return inner
    }
    return { op: 'atom', desc: this.parseAtom() }
  }

  /** Parse an axis directive: bare word (X/Y/Z/XY/YZ/XZ) or `(x,y,z)` vector. */
  private parseDirection(): Vec3 | null {
    const t = this.peek()
    if (t && t.t === 'word') {
      const up = t.v.toUpperCase()
      if (up in AXES) {
        this.pos++
        return AXES[up]!
      }
      return null
    }
    if (t && t.t === 'op' && t.v === '(') {
      this.pos++
      const x = this.parseNumber()
      this.eatOp(',')
      const y = this.parseNumber()
      this.eatOp(',')
      const z = this.parseNumber()
      this.eatOp(')')
      return { x, y, z }
    }
    return null
  }

  /**
   * Parse a numeric literal, allowing an optional leading `+`/`-`. Numeric
   * grammar from upstream: integer [. [integer]] where integer = sign? digits.
   */
  private parseNumber(): number {
    let sign = 1
    if (this.atOp('-') || this.atOp('+')) {
      if (this.atOp('-')) sign = -1
      this.pos++
    }
    // ensure a numeric literal follows the sign
    if (!this.peek() || this.peek()!.t !== 'num') {
      throw new SyntaxError('[cadquery-selectors] expected a number')
    }
    const raw = (this.next() as Tok & { t: 'num' }).v
    const v = Number(raw)
    if (!Number.isFinite(v)) throw this.error('invalid number')
    return sign * v
  }

  /** Consume an optional index `[k]` where k is a signed integer; null if absent. */
  private parseIndex(): { n: number } | null {
    if (!this.atOp('[')) return null
    this.pos++
    const n = Math.trunc(this.parseNumber())
    this.eatOp(']')
    return { n }
  }

  private error(msg: string): SyntaxError {
    return new SyntaxError(`[cadquery-selectors] ${msg}`)
  }

  /** Parse a single atom (a leaf of the expression). Throws on unknown atom. */
  private parseAtom(): AtomDesc {
    const t = this.peek()
    if (!t) throw this.error('unexpected end of expression')

    // 1. bare direction — a word that is an axis name maps to DirectionSelector.
    if (t.t === 'word' && t.v.toUpperCase() in AXES) {
      this.pos++
      return { kind: 'dir', vec: AXES[t.v.toUpperCase()]! }
    }

    // 2. %TYPE
    if (t.t === 'op' && t.v === '%') {
      this.pos++
      const nameT = this.next()
      if (!nameT || nameT.t !== 'word') throw this.error('`%` must be followed by a geometry type')
      const up = nameT.v.toUpperCase()
      if (!TYPE_NAMES.has(up)) throw this.error(`invalid geometry type "%${nameT.v}"`)
      return { kind: 'type', name: up }
    }

    // 3./4. direction ops and center nth ops
    if (t.t === 'op' && (t.v === '>>' || t.v === '<<')) {
      this.pos++
      const vec = this.parseDirection()
      if (!vec) throw this.error('expected an axis or vector after `' + t.v + '`')
      const idx = this.parseIndex()
      const max = t.v === '>>'
      return { kind: 'centerNth', vec, max, n: idx ? idx.n : null }
    }
    if (t.t === 'op' && (t.v === '>' || t.v === '<')) {
      this.pos++
      const vec = this.parseDirection()
      if (!vec) throw this.error('expected an axis direction after `' + t.v + '`')
      const max = t.v === '>'
      const idx = this.parseIndex()
      if (idx) return { kind: 'minmaxNth', vec, max, n: idx.n }
      return { kind: 'minmax', vec, max }
    }
    // 5. other_op — `|` `#` `+` `-`
    if (t.t === 'op' && (t.v === '|' || t.v === '#' || t.v === '+' || t.v === '-')) {
      this.pos++
      const vec = this.parseDirection()
      if (!vec) throw this.error(`expected an axis direction after \`${t.v}\``)
      if (t.v === '|') return { kind: 'parallel', vec }
      if (t.v === '#') return { kind: 'perpendicular', vec }
      return { kind: 'signed', vec, sign: t.v === '+' ? 1 : -1 }
    }

    // 6. named view
    if (t.t === 'word' && t.v.toLowerCase() in NAMED_VIEW) {
      this.pos++
      const nv = NAMED_VIEW[t.v.toLowerCase()]!
      return { kind: 'minmax', vec: nv.vec, max: nv.max }
    }

    throw this.error(`unsupported selector atom near "${JSON.stringify(t)}"`)
  }
}

/**
 * Parse a raw CadQuery selector expression string into an AST.
 *
 * @param expr - The CadQuery selector string (e.g. `">Z and |X"`).
 * @returns The parsed selector AST.
 */
export function parseSelector(expr: string): SelectorExpr {
  if (expr == null || expr.trim() === '') {
    throw new SyntaxError('[cadquery-selectors] selector expression may not be empty')
  }
  return new Parser(expr).parse()
}