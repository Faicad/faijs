/**
 * primitives/screw/thread-spec — descriptive thread-spec parser
 *
 * Parses drawing-callout style thread specs ('M16-6H↧18', '1/4"-20-2B',
 * 'PT1/8') into a `ResolvedThreadSpec` shared by `fai_drill` (its `thread`
 * key) and `screw` (its `spec` key).
 *
 * Grammar (space/case tolerant; 'x'/'X' equal '×'; '↧' equal '↓'):
 *   metric  := 'M' <dia> [ '×' <pitch> ] [ '-' <class> ] [ depthSuffix ]
 *   imperial:= ( '#' <gauge> | <frac>'"' | <dec>'"' ) [ '-' <tpi> ] [ '-' <class> ] [ depthSuffix ]
 *   pipe    := ( 'PT' | 'R' | 'Rc' ) <size> [ depthSuffix ]
 *   depthSuffix := ( '↧' | '↓' ) <depth> | <depth> ' DEEP' | 'THRU' | 'THROUGH'
 *
 * OCR-variant tolerance is a three-layer **whitelist** — normalization only
 * maps characters INTO the grammar alphabet above; it never widens the
 * grammar, and anything outside the whitelist is an explicit reject:
 *   L1 character equivalence — NFKC (full-width forms, fraction glyphs),
 *      enumerated one-char lookalike maps (dash / '×' / inch-quote /
 *      depth-arrow variants), digit-comma decimals ('1,5' → '1.5'), and an
 *      OCR edge-junk strip (stray brackets/quotes/punctuation at the ends;
 *      a leading '.' and a trailing '"' are meaningful and never stripped).
 *   L2 enumerated keyword suffixes — 'THRU'/'THROUGH' (through hole, sets
 *      `thru`) and '<depth> DEEP' (bare depth number before the word).
 *   L3 closed-alphabet repair of tolerance-class tokens — accepted only when
 *      exactly one candidate exists ('GH' → '6H', 'ZB' → '2B'); free numbers
 *      are NEVER guessed (silent wrong geometry beats a loud error never).
 *
 * Security boundary (all explicit rejects, code `E_THREAD_SPEC`):
 *   - input longer than {@link MAX_SPEC_LENGTH} characters (regex-DoS cap);
 *   - invisible/bidirectional control characters (U+200B–U+200F,
 *     U+202A–U+202E, U+2060–U+206F, U+FEFF);
 *   - any character outside the post-normalization alphabet — homoglyphs
 *     (Cyrillic 'М', Greek 'Ο'), injection payloads, markup, backticks.
 * Parse failures carry the nearest table entry (≤2 OCR-weighted edits) as a
 * suggestion in the error message — a hint, never auto-applied.
 *
 * The string is the drawing callout, so each suffix feeds its own field:
 * the class suffix ('-6H') becomes `toleranceClass`, the depth suffix
 * ('↧18'/'↓18'/'18 DEEP') becomes `depth` (hole depth, NOT threadDepth).
 * `specLabel` is the normalized spec part WITHOUT class and depth — PMI
 * display adopts it directly (`formatThreadSpec` prefers `specLabel`).
 *
 * Any parse failure or out-of-table value throws {@link ThreadSpecError}
 * (code `E_THREAD_SPEC`) — never a silent fallback (project red line).
 */

import { getScrewSpecs, PIPE_SPECS } from './screw-db'
import type { ThreadSystem } from './screw-db'

/** Grammar help text appended to every parse failure. */
const GRAMMAR_HELP =
  'Supported grammar (space/case tolerant, OCR variants whitelist-normalized): '
  + "metric 'M<dia>[×<pitch>][-<class>][↧|↓<depth> | <depth> DEEP | THRU]' (M2–M64, class [4-8][GH]); "
  + 'imperial \'(#<gauge> | <frac>" | <dec>")[-<tpi>][-<class>][↧|↓<depth> | <depth> DEEP | THRU]\' (#4–1", class 1B|2B|3B); '
  + "pipe 'PT|R|Rc<size>[↧|↓<depth> | <depth> DEEP | THRU]' (PT1/8–PT1/2, no class suffix). "
  + 'OCR whitelist: NFKC equivalents, dash/×/quote/arrow lookalikes, digit-comma decimals, '
  + "unique-candidate class repair ('GH'→'6H'); outside the whitelist is rejected "
  + '(≤64 chars, no control chars, no unknown characters).'

/**
 * Explicit parse failure for a descriptive thread spec.
 *
 * Carries code `E_THREAD_SPEC` so the statement boundary keeps the code
 * through `toOpFailure` (an `Error` with a string `code` property).
 */
export class ThreadSpecError extends Error {
  /** Stable error code, kept through the statement boundary (`toOpFailure`). */
  readonly code = 'E_THREAD_SPEC'
  constructor(detail: string) {
    super(`E_THREAD_SPEC: ${detail} ${GRAMMAR_HELP}`)
    this.name = 'ThreadSpecError'
  }
}

/**
 * A thread spec resolved from a descriptive string — the unified view shared
 * by `fai_drill`'s `thread` key and `screw`'s `spec` key.
 *
 * Superset of the legacy three-key resolution (`screwSystem` +
 * `screwSpecIdx` + `screwThread`): the first six fields are identical, the
 * optional ones exist only when the string (or explicit param) carries them.
 */
export interface ResolvedThreadSpec {
  /** Thread system. */
  system: ThreadSystem
  /** Index into the system's spec table (metric/imperial: `getScrewSpecs`; pipe: `PIPE_SPECS`). */
  specIdx: number
  /** Nominal diameter in mm (pipe: major diameter on the gauge plane). */
  nominalDiameter: number
  /** Actual pitch in mm. */
  pitch: number
  /** Normalized spec label WITHOUT tolerance class and depth ('M16', 'M16×1.5', '1/4"-20', 'PT1/8'). */
  specLabel: string
  /** Default pilot-hole diameter in mm (metric/imperial: nominal − pitch; pipe: tabulated tap drill). */
  pilotDia: number
  /** Tolerance class from the in-string suffix ('-6H'); omitted when absent. */
  toleranceClass?: string
  /** Hole depth from the in-string suffix ('↧18'/'↓18'/'18 DEEP'); omitted when absent. */
  depth?: number
  /** True when the string carries a THRU/THROUGH suffix — a through hole (`depth` stays undefined). */
  thru?: boolean
}

// ─── Layer 0 — hard input guards ────────────────────────────────────────────

/**
 * Whitelist length cap. The longest legitimate callout is ~20 chars; 64
 * kills overlong/DoS payloads before any normalization or regex work.
 */
const MAX_SPEC_LENGTH = 64

/**
 * Invisible & bidirectional control characters — an attack surface (spooner
 * text, bidi spoofing), never legitimate OCR output. Checked on the raw
 * input and again after NFKC (which leaves these code points unchanged).
 */
const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u

// ─── Layer 1 — character equivalence classes (enumerated, one char each) ────

/** Dash/minus variants (hyphen…horizontal bar, minus sign, full-width minus) → '-'. */
const DASH_VARIANTS_RE = /[\u2010-\u2015\u2212\uFF0D]/gu
/** NFKC turns '½' into '1⁄2'; the fraction slash is not '/'. */
const FRACTION_SLASH_RE = /\u2044/gu
/** Multiplication variants ('*', middle dot, asterisk operator) → '×'. */
const MULTIPLY_VARIANTS_RE = /[*·∗]/gu
/** Inch-mark quote variants (curly doubles, single/double prime) → '"'. */
const INCH_QUOTE_VARIANTS_RE = /[\u201C\u201D\u201E\u201F\u2032\u2033]/gu
/**
 * NFKC splits '″' (double prime, U+2033) into two '′' primes — a double
 * prime is ONE inch mark, so collapse the pair before the single-char map.
 */
const DOUBLE_PRIME_PAIR_RE = /\u2032\u2032/gu
/** Depth-arrow variants (↧, ⇩, ⤓) → '↓'. */
const DEPTH_ARROW_VARIANTS_RE = /[\u21A7\u21E9\u2913]/gu

/**
 * OCR lead-in junk. A leading '.' is meaningful ('.25"' decimal inch) and a
 * leading '-' is a malformed spec, not junk — neither is stripped.
 */
const LEADING_JUNK_RE = /^[\s"'(){}[\];:，。；：、「『【《]+/u
/**
 * OCR trailing junk. A trailing '"' is the inch mark — never stripped (and a
 * trailing '-' is malformed, not junk).
 */
const TRAILING_JUNK_RE = /[\s.,;:()[\]】」》』、，。；：]+$/u

// ─── Layer 2 — enumerated keyword suffixes ──────────────────────────────────

/** 'THRU' / 'THROUGH' trailing keyword (whitespace optional before it). */
const THROUGH_RE = /\s*(?:THROUGH|THRU)\s*$/
/** '<depth> DEEP' — bare depth number (whitespace-separated) before the word. */
const DEEP_RE = /(?:^|\s)(\d+(?:\.\d+)?)\s+DEEP\s*$/

/**
 * Post-normalization alphabet: A–Z, 0–9, '-', '×', '↓', '/', '"', '.', '#'.
 * Anything else after L1 normalization is an explicit reject (homoglyphs,
 * injection payloads, unknown punctuation) — the whitelist never widens.
 */
const ALPHABET_RE = /[^A-Z0-9\-×↓/"#.]/u

// ─── Layer 3 — closed-alphabet repair tables ────────────────────────────────

/** Valid metric tolerance classes ([4-8][GH]). */
const METRIC_CLASSES = ['4G', '4H', '5G', '5H', '6G', '6H', '7G', '7H', '8G', '8H'] as const
/** Valid imperial tolerance classes. */
const IMPERIAL_CLASSES = ['1B', '2B', '3B'] as const

/** Letter → digit lookalikes (a letter OCR'd where a digit was printed). */
const DIGIT_LOOKALIKES: Readonly<Record<string, string>> = {
  O: '0', Q: '0', I: '1', L: '1', Z: '2', A: '4', S: '5', G: '6', T: '7', B: '8',
}

/** Digit/letter → letter lookalikes ('6'/'N'/'8' OCR'd where 'G'/'H'/'B' was printed). */
const LETTER_LOOKALIKES: Readonly<Record<string, string>> = {
  '6': 'G', N: 'H', '8': 'B',
}

/** Known OCR confusion pairs (concatenated, both directions) for the suggestion distance. */
const CONFUSION_PAIRS: ReadonlySet<string> = new Set([
  'O0', 'Q0', 'I1', 'L1', 'Z2', 'A4', 'S5', 'G6', 'T7', 'B8', '6G', 'NH', '8B',
])

/**
 * Closed-alphabet tolerance-class repair. Accepts a 2-char class token only
 * when it is already valid or when exactly one valid candidate exists
 * ('GH' → '6H'); no candidate ('9Z') or an ambiguous one returns undefined
 * and the caller rejects. Free numbers are never guessed.
 */
function repairClassToken(token: string, valid: readonly string[]): string | undefined {
  if (valid.includes(token)) return token
  const c0 = token.charAt(0)
  const c1 = token.charAt(1)
  if (c0 === '' || c1 === '') return undefined
  const pos0 = new Set(valid.map((c) => c.charAt(0)))
  const pos1 = new Set(valid.map((c) => c.charAt(1)))
  const cand0 = new Set<string>()
  if (pos0.has(c0)) cand0.add(c0)
  const mapped0 = DIGIT_LOOKALIKES[c0]
  if (mapped0 !== undefined && pos0.has(mapped0)) cand0.add(mapped0)
  const cand1 = new Set<string>()
  if (pos1.has(c1)) cand1.add(c1)
  const mapped1 = LETTER_LOOKALIKES[c1]
  if (mapped1 !== undefined && pos1.has(mapped1)) cand1.add(mapped1)
  const results: string[] = []
  for (const a of cand0) {
    for (const b of cand1) {
      results.push(a + b)
    }
  }
  return results.length === 1 ? results[0] : undefined
}

/** All canonical labels (metric + imperial + pipe, table order) for the nearest-entry suggestion. */
function allLabels(): readonly string[] {
  return [
    ...getScrewSpecs('metric').map((e) => e.label),
    ...getScrewSpecs('imperial').map((e) => e.label),
    ...PIPE_SPECS.map((e) => e.label),
  ]
}

/** Substitution cost: 0 same, 0.5 for a known OCR confusion pair, 1 otherwise. */
function substitutionCost(x: string, y: string): number {
  if (x === y) return 0
  if (CONFUSION_PAIRS.has(x + y) || CONFUSION_PAIRS.has(y + x)) return 0.5
  return 1
}

/** OCR-weighted edit distance (insert/delete 1, substitution per {@link substitutionCost}); Infinity past `cap`. */
function ocrDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return Infinity
  let prev: number[] = []
  let curr: number[] = []
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(
        prev[j - 1]! + substitutionCost(a.charAt(i - 1), b.charAt(j - 1)),
        prev[j]! + 1,
        curr[j - 1]! + 1,
      )
      curr[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > cap) return Infinity
    const swap = prev
    prev = curr
    curr = swap
  }
  const d = prev[b.length]!
  return d <= cap ? d : Infinity
}

/**
 * Nearest canonical label within ≤2 OCR-weighted edits — an error-message
 * suggestion only, never auto-applied. Equal-distance ties break toward the
 * label numerically closest to an 'M<dia>' input ('M17' → 'M16', not 'M12').
 */
function nearestLabel(s: string): string | undefined {
  const targetMatch = /^M(\d+(?:\.\d+)?)$/.exec(s)
  const target = targetMatch !== null ? Number(targetMatch[1]) : undefined
  let best: string | undefined
  let bestDist = Infinity
  let bestProx = Infinity
  for (const label of allLabels()) {
    const d = ocrDistance(s, label, 2)
    if (d === Infinity) continue
    const m = /^M(\d+(?:\.\d+)?)$/.exec(label)
    const prox = target !== undefined && m !== null ? Math.abs(Number(m[1]) - target) : Infinity
    if (d < bestDist || (d === bestDist && prox < bestProx)) {
      best = label
      bestDist = d
      bestProx = prox
    }
  }
  return best
}

/** Error-message suffix carrying the nearest table entry, when one exists. */
function suggestSuffix(s: string): string {
  const nearest = nearestLabel(s)
  return nearest === undefined ? '' : ` (nearest table entry: '${nearest}')`
}

/** Number rendering for labels: drop the float tail (6.0 → '6', 5.25 → '5.25'). */
function num(v: number): string {
  return String(Math.round(v * 1000) / 1000)
}

/**
 * Parse a descriptive thread spec into a {@link ResolvedThreadSpec}.
 *
 * Pure, table-driven, geometry-free. Whitespace anywhere is ignored;
 * `m16x1.5`, `M16 X 1.5` and `M16×1.5` are the same spec. `R`/`Rc` are
 * aliases of `PT` (one pipe table); the label canonicalizes to `PT…`.
 * An explicit metric pitch or imperial TPI is accepted as a custom value as
 * long as the nominal diameter is in the table.
 *
 * OCR-variant tolerance follows the three-layer whitelist documented at the
 * top of this file: L1 character equivalence (NFKC + enumerated lookalike
 * maps + digit-comma decimals + edge-junk strip), L2 keyword suffixes
 * (THRU/THROUGH, `<depth> DEEP`), L3 unique-candidate tolerance-class
 * repair. Everything else — homoglyphs, control characters, unknown
 * characters, payloads over 64 chars — is an explicit reject.
 *
 * @param spec - the drawing-callout spec string, e.g. 'M16-6H↧18'.
 * @returns the resolved spec (class/depth/thru only when the string carries them).
 * @throws {ThreadSpecError} code `E_THREAD_SPEC` on any parse failure,
 *   out-of-table value, or out-of-whitelist input (e.g. 'NPT1/2', 'M99',
 *   'M16x', '-9Z', 'PT1/8-6H', Cyrillic homoglyphs, zero-width characters).
 */
export function parseThreadSpec(spec: string): ResolvedThreadSpec {
  if (typeof spec !== 'string' || spec.trim() === '') {
    throw new ThreadSpecError(`thread spec must be a non-empty string, got ${JSON.stringify(spec)}`)
  }
  // Layer 0 — hard input guards, before any normalization work.
  if (spec.length > MAX_SPEC_LENGTH) {
    throw new ThreadSpecError(
      `thread spec is ${spec.length} characters — the whitelist limit is ${MAX_SPEC_LENGTH}`,
    )
  }
  if (INVISIBLE_RE.test(spec)) {
    throw new ThreadSpecError(
      'thread spec contains invisible/bidirectional control characters '
        + '(U+200B–U+200F, U+202A–U+202E, U+2060–U+206F, U+FEFF) — rejected',
    )
  }
  // Layer 1 — character equivalence classes: NFKC, then enumerated one-char maps.
  let s = spec.normalize('NFKC')
  if (INVISIBLE_RE.test(s)) {
    throw new ThreadSpecError(
      'thread spec contains invisible/bidirectional control characters — rejected',
    )
  }
  s = s
    .toUpperCase()
    .replace(DASH_VARIANTS_RE, '-')
    .replace(FRACTION_SLASH_RE, '/')
    .replace(MULTIPLY_VARIANTS_RE, '×')
    .replace(DOUBLE_PRIME_PAIR_RE, '"')
    .replace(INCH_QUOTE_VARIANTS_RE, '"')
    .replace(DEPTH_ARROW_VARIANTS_RE, '↓')
    .replace(LEADING_JUNK_RE, '')
    .replace(TRAILING_JUNK_RE, '')
  // Layer 2 — enumerated keyword suffixes (matched before whitespace removal,
  // because '<n> DEEP' needs the separating whitespace to be unambiguous).
  let deepDepth: number | undefined
  const deepMatch = DEEP_RE.exec(s)
  if (deepMatch !== null) {
    deepDepth = Number(deepMatch[1])
    if (!(deepDepth > 0)) throw new ThreadSpecError(`DEEP depth must be positive in '${s}'`)
    s = s.slice(0, deepMatch.index)
  }
  let thru = false
  const thruMatch = THROUGH_RE.exec(s)
  if (thruMatch !== null) {
    thru = true
    s = s.slice(0, thruMatch.index)
  }
  // Compact: drop all whitespace, unify 'X' → '×'.
  s = s.replace(/\s+/gu, '').replace(/X/g, '×')
  // Digit-comma decimals after compaction, so '1, 5' is covered too.
  s = s.replace(/(\d),(\d)/g, '$1.$2')
  // Alphabet guard — anything outside the grammar alphabet after L1 is a
  // homoglyph / injection / junk reject; the whitelist never widens.
  const badChar = ALPHABET_RE.exec(s)
  if (badChar !== null) {
    const ch = badChar[0]!
    const cp = ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')
    throw new ThreadSpecError(
      `unsupported character U+${cp} (${JSON.stringify(ch)}) in '${s}' — outside the OCR whitelist alphabet`,
    )
  }
  // Canonical depth suffix ('↓<n>').
  let depth: number | undefined
  const depthMatch = /↓(\d+(?:\.\d+)?)$/.exec(s)
  if (depthMatch !== null) {
    depth = Number(depthMatch[1])
    if (!(depth > 0)) throw new ThreadSpecError(`depth suffix must be positive in '${s}'`)
    s = s.slice(0, depthMatch.index)
  }
  // Keyword contradictions — never silently resolved.
  if (thru && depth !== undefined) {
    throw new ThreadSpecError(`THRU conflicts with a ↓ depth suffix in '${s}' — a through hole has no depth`)
  }
  if (thru && deepDepth !== undefined) {
    throw new ThreadSpecError(`THRU conflicts with a DEEP depth in '${s}' — a through hole has no depth`)
  }
  if (depth !== undefined && deepDepth !== undefined) {
    throw new ThreadSpecError(
      `↓ depth suffix conflicts with a DEEP depth in '${s}' — keep exactly one depth notation`,
    )
  }
  if (deepDepth !== undefined) depth = deepDepth
  if (s.startsWith('M')) return parseMetric(s, depth, thru)
  if (/^(PT|R|RC)\d/.test(s)) return parsePipe(s, depth, thru)
  return parseImperial(s, depth, thru)
}

/** Metric branch: `M<dia>[×<pitch>][-<class>]` (depth/keyword already stripped). */
function parseMetric(s: string, depth?: number, thru?: boolean): ResolvedThreadSpec {
  let rest = s
  let toleranceClass: string | undefined
  // L3 — every '-XX' tail in a metric spec is a class attempt (the metric
  // grammar has no other dash suffix), so try the closed-alphabet repair.
  const classMatch = /-([0-9A-Z]{2})$/.exec(rest)
  if (classMatch !== null) {
    const cls = classMatch[1]!
    const repaired = repairClassToken(cls, METRIC_CLASSES)
    if (repaired === undefined) {
      throw new ThreadSpecError(
        `metric tolerance class '-${cls}' is outside [4-8][GH] and has no unique OCR repair in '${s}'`,
      )
    }
    toleranceClass = repaired
    rest = rest.slice(0, classMatch.index)
  }
  const body = /^M(\d+(?:\.\d+)?)(?:×(\d+(?:\.\d+)?))?$/.exec(rest)
  if (!body) throw new ThreadSpecError(`cannot parse metric spec '${s}'${suggestSuffix(s)}`)
  const dia = Number(body[1])
  const pitchExplicit = body[2] !== undefined ? Number(body[2]) : undefined
  if (pitchExplicit !== undefined && !(pitchExplicit > 0)) {
    throw new ThreadSpecError(`pitch must be positive in '${s}'`)
  }
  const specs = getScrewSpecs('metric')
  const idx = specs.findIndex((e) => Math.abs(e.dia - dia) < 1e-9)
  if (idx < 0) {
    throw new ThreadSpecError(`'M${body[1]}' is outside the metric table (M2–M64)${suggestSuffix(`M${body[1]}`)}`)
  }
  const spec = specs[idx]!
  const pitch = pitchExplicit ?? spec.coarse
  return {
    system: 'metric',
    specIdx: idx,
    nominalDiameter: spec.dia,
    pitch,
    specLabel: spec.label + (pitchExplicit !== undefined ? `×${num(pitchExplicit)}` : ''),
    pilotDia: Math.round((spec.dia - pitch) * 1000) / 1000,
    ...(toleranceClass !== undefined ? { toleranceClass } : {}),
    ...(depth !== undefined ? { depth } : {}),
    ...(thru === true ? { thru: true } : {}),
  }
}

/** Imperial branch: `(#<gauge> | <frac>" | <dec>")[-<tpi>][-<class>]` (depth/keyword already stripped). */
function parseImperial(s: string, depth?: number, thru?: boolean): ResolvedThreadSpec {
  let rest = s
  let toleranceClass: string | undefined
  const classMatch = /-([0-9A-Z]{2})$/.exec(rest)
  if (classMatch !== null) {
    const token = classMatch[1]!
    // CRITICAL guard: '-18'/'-20' are TPIs, not classes — repair only
    // letter-tailed tokens, or '8'→'B' would steal TPI 18 as class 1B.
    if (/[A-Z]/.test(token.charAt(1))) {
      const repaired = repairClassToken(token, IMPERIAL_CLASSES)
      if (repaired === undefined) {
        throw new ThreadSpecError(
          `imperial tolerance class '-${token}' is outside 1B|2B|3B and has no unique OCR repair in '${s}'`,
        )
      }
      toleranceClass = repaired
      rest = rest.slice(0, classMatch.index)
    }
    // else: digit-tailed '-<n>' falls through to the TPI match below.
  }
  let tpiExplicit: number | undefined
  const tpiMatch = /-(\d+)$/.exec(rest)
  if (tpiMatch) {
    tpiExplicit = Number(tpiMatch[1])
    rest = rest.slice(0, tpiMatch.index)
  }
  const specs = getScrewSpecs('imperial')
  let idx = -1
  const gauge = /^#(\d+)$/.exec(rest)
  const frac = /^(\d+)\/(\d+)"$/.exec(rest)
  const dec = /^(\d+(?:\.\d+)?|\.\d+)"$/.exec(rest)
  if (gauge) {
    idx = specs.findIndex((e) => e.label === `#${gauge[1]}`)
  } else if (frac) {
    idx = specs.findIndex((e) => e.label === `${frac[1]}/${frac[2]}"`)
  } else if (dec) {
    const diaMm = Number(dec[1]) * 25.4
    idx = specs.findIndex((e) => Math.abs(e.dia - diaMm) < 1e-3)
  }
  if (idx < 0) {
    throw new ThreadSpecError(`'${s}' does not match an imperial spec in the table (#4–1")${suggestSuffix(s)}`)
  }
  const spec = specs[idx]!
  if (tpiExplicit !== undefined && !(tpiExplicit > 0)) {
    throw new ThreadSpecError(`TPI must be positive in '${s}'`)
  }
  const tpi = tpiExplicit ?? spec.coarse
  const pitch = 25.4 / tpi
  return {
    system: 'imperial',
    specIdx: idx,
    nominalDiameter: spec.dia,
    pitch,
    specLabel: spec.label + (tpiExplicit !== undefined ? `-${tpiExplicit}` : ''),
    pilotDia: Math.round((spec.dia - pitch) * 1000) / 1000,
    ...(toleranceClass !== undefined ? { toleranceClass } : {}),
    ...(depth !== undefined ? { depth } : {}),
    ...(thru === true ? { thru: true } : {}),
  }
}

/** Pipe branch: `(PT|R|Rc)<size>` — single pitch series, no class suffix. */
function parsePipe(s: string, depth?: number, thru?: boolean): ResolvedThreadSpec {
  const m = /^(PT|R|RC)(\d+\/\d+)$/.exec(s)
  if (!m) {
    throw new ThreadSpecError(
      `cannot parse pipe spec '${s}' (pipe threads take no tolerance-class or TPI suffix)`,
    )
  }
  const size = m[2]!
  const idx = PIPE_SPECS.findIndex((e) => e.label === `PT${size}`)
  if (idx < 0) throw new ThreadSpecError(`'PT${size}' is outside the pipe table (PT1/8–PT1/2)`)
  const spec = PIPE_SPECS[idx]!
  return {
    system: 'pipe',
    specIdx: idx,
    nominalDiameter: spec.majorDia,
    pitch: spec.pitch,
    specLabel: spec.label,
    pilotDia: spec.pilotDia,
    ...(depth !== undefined ? { depth } : {}),
    ...(thru === true ? { thru: true } : {}),
  }
}
