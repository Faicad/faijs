/**
 * primitives/screw/drill-spec — drill-callout spec parser
 *
 * Parses drawing-callout style drill specs ('Ø2.5 完全贯穿', 'Ø5 深10',
 * 'Ø14 18 DEEP') into a {@link ResolvedDrillSpec}, consumed by
 * `fai_drill_tapper`'s `drill` key (the pilot-hole half of the two-string
 * tapped-hole contract; the tap half goes through `parseThreadSpec`).
 *
 * Grammar (space/case tolerant; '↧'/'▼' equal '↓'):
 *   drill := 'Ø' <diameter> [ depthSuffix ]
 *   depthSuffix := ( '↧' | '↓' | '▼' ) <depth> | '深' <depth> | <depth> ' DEEP' | 'THRU' | 'THROUGH' | '完全贯穿'
 *
 * A callout WITHOUT a depth suffix defaults to a through hole (drawing
 * convention: an undimensioned pilot is drilled through) — `depth` 0 / `thru`
 * true. The diameter symbol variants Ø/⌀/Φ/φ/ϕ/∅ are equivalent (NFKC folds
 * 'ϕ' onto 'φ'; the map covers the post-NFKC code points).
 *
 * OCR-variant tolerance is the same three-layer **whitelist** as
 * `thread-spec`, on the shared text layer (`./spec-text`): L1 character
 * equivalence (NFKC, one-char lookalike maps, digit-comma decimals, edge-junk
 * strip), L2 enumerated keyword suffixes (THRU/THROUGH, `<depth> DEEP`, and
 * the Chinese drawing keywords '完全贯穿' / '深<depth>'), L3 — none needed
 * (no tolerance-class tokens in a drill callout). Everything else —
 * homoglyphs, control characters, unknown characters, payloads over 64
 * chars — is an explicit reject.
 *
 * GOTCHA (why the multi-number guard runs BEFORE whitespace compaction):
 * a drill callout has no letter head ('M…'), so a bare second number cannot
 * be table-checked away the way 'M1618' is. Compacting 'Ø2.5 10' would
 * silently produce 'Ø2.5' + swallowed '10' — worse, 'Ø2.5 10' → 'Ø2.510'
 * reads as a VALID 2.51 mm pilot. A whitespace-separated digit pair is
 * therefore rejected outright.
 *
 * Any parse failure throws {@link ThreadSpecError} (code `E_THREAD_SPEC`)
 * — never a silent fallback (project red line).
 */

import {
  MAX_SPEC_LENGTH,
  INVISIBLE_RE,
  DEPTH_ARROW_VARIANTS_RE,
  LEADING_JUNK_RE,
  TRAILING_JUNK_RE,
  DEEP_RE,
  THROUGH_RE,
  CN_DEEP_RE,
  CN_THROUGH_RE,
  ThreadSpecError,
} from './spec-text'

/** Grammar help text appended to every parse failure. */
const DRILL_GRAMMAR_HELP =
  "Supported grammar (space/case tolerant, OCR variants whitelist-normalized): 'Ø<diameter>[↧|↓|▼<depth> | 深<depth> | <depth> DEEP | THRU | 完全贯穿]' — "
  + "e.g. 'Ø2.5', 'Ø2.5 完全贯穿', 'Ø5 深10'. Diameter symbols Ø/⌀/Φ/φ/ϕ/∅ are equivalent; "
  + 'a callout without a depth suffix defaults to a through hole. '
  + 'OCR whitelist: NFKC equivalents, digit-comma decimals, edge-junk strip; '
  + 'outside the whitelist is rejected (≤64 chars, no control chars, no unknown characters, '
  + 'no bare whitespace-separated second number).'

/** Every parse failure in this module carries the grammar help. */
function fail(detail: string): never {
  throw new ThreadSpecError(detail, DRILL_GRAMMAR_HELP)
}

/** Diameter-symbol variants (Ø, ⌀, Φ, φ, ∅) → 'Ø' ('ϕ' NFKC-folds onto 'φ' first). */
const DIAMETER_VARIANTS_RE = /[Ø⌀Φφ∅]/gu

/**
 * A whitespace-separated digit pair is NOT a depth notation — reject before
 * compaction (see the GOTCHA in the file header: 'Ø2.5 10' must not compact
 * into a silently-valid 'Ø2.510').
 */
const MULTI_NUMBER_RE = /\d\s+\d/u

/**
 * Post-normalization alphabet: 'Ø', 0–9, '↓', '.'. Anything else after L1
 * normalization is an explicit reject (letters, CJK remnants, homoglyphs,
 * injection payloads) — the whitelist never widens.
 */
const ALPHABET_RE = /[^Ø0-9↓.]/u

/**
 * A drill callout resolved from a descriptive string.
 *
 * `depth` is the pilot-hole depth in mm; 0 means a through hole. `thru` is
 * the readable form of `depth === 0` (kept as an explicit field because the
 * tapper cross-validation reads it per-string).
 */
export interface ResolvedDrillSpec {
  /** Drill (pilot) diameter in mm (> 0). */
  diameter: number
  /** Hole depth in mm; 0 = through hole. */
  depth: number
  /** True for a through hole ('THRU'/'完全贯穿' suffix, or no depth suffix at all). */
  thru: boolean
}

/**
 * Parse a descriptive drill callout into a {@link ResolvedDrillSpec}.
 *
 * Pure, table-free, geometry-free. Whitespace anywhere is ignored;
 * `ø5`, `⌀5` and `Φ5` are the same diameter. See the file header for the
 * whitelist contract and the two-string tapped-hole context.
 *
 * @param spec - the drawing-callout drill string, e.g. 'Ø2.5 完全贯穿'.
 * @returns the resolved drill spec (`depth` 0 / `thru` true for a through hole).
 * @throws {ThreadSpecError} code `E_THREAD_SPEC` on any parse failure or
 *   out-of-whitelist input (e.g. '2.5' without a diameter symbol, 'Ø2.5 10',
 *   'Ø', zero-width characters, Cyrillic homoglyphs).
 */
export function parseDrillSpec(spec: string): ResolvedDrillSpec {
  if (typeof spec !== 'string' || spec.trim() === '') {
    fail(`drill spec must be a non-empty string, got ${JSON.stringify(spec)}`)
  }
  // Layer 0 — hard input guards, before any normalization work.
  if (spec.length > MAX_SPEC_LENGTH) {
    fail(`drill spec is ${spec.length} characters — the whitelist limit is ${MAX_SPEC_LENGTH}`)
  }
  if (INVISIBLE_RE.test(spec)) {
    fail(
      'drill spec contains invisible/bidirectional control characters '
        + '(U+200B–U+200F, U+202A–U+202E, U+2060–U+206F, U+FEFF) — rejected',
    )
  }
  // Layer 1 — character equivalence classes: NFKC, then enumerated one-char maps.
  let s = spec.normalize('NFKC')
  if (INVISIBLE_RE.test(s)) {
    fail('drill spec contains invisible/bidirectional control characters — rejected')
  }
  s = s
    .toUpperCase()
    .replace(DIAMETER_VARIANTS_RE, 'Ø')
    .replace(DEPTH_ARROW_VARIANTS_RE, '↓')
    .replace(LEADING_JUNK_RE, '')
    .replace(TRAILING_JUNK_RE, '')
  // Chinese drawing keywords (enumerated L2 additions): substituted INTO the
  // ASCII grammar before the alphabet guard, so the closed-alphabet property
  // is preserved ('深10' → '↓10', '完全贯穿' → ' THRU ').
  s = s.replace(CN_DEEP_RE, '↓$1').replace(CN_THROUGH_RE, ' THRU ')
  // Layer 2 — enumerated keyword suffixes (matched before whitespace removal,
  // because '<n> DEEP' needs the separating whitespace to be unambiguous).
  let deepDepth: number | undefined
  const deepMatch = DEEP_RE.exec(s)
  if (deepMatch !== null) {
    deepDepth = Number(deepMatch[1])
    if (!(deepDepth > 0)) fail(`DEEP depth must be positive in '${s}'`)
    s = s.slice(0, deepMatch.index)
  }
  let thru = false
  const thruMatch = THROUGH_RE.exec(s)
  if (thruMatch !== null) {
    thru = true
    s = s.slice(0, thruMatch.index)
  }
  // Bare second number — reject BEFORE compaction (see file-header GOTCHA:
  // 'Ø2.5 10' would compact into a silently-valid 'Ø2.510').
  if (MULTI_NUMBER_RE.test(s)) {
    fail(
      `a bare second number is not a depth notation in '${s}' — `
        + "write the depth as '深<n>' / '↓<n>' / '<n> DEEP', or 'THRU' / '完全贯穿' for a through hole",
    )
  }
  // Compact: drop all whitespace.
  s = s.replace(/\s+/gu, '')
  // Digit-comma decimals after compaction, so '2, 5' is covered too.
  s = s.replace(/(\d),(\d)/g, '$1.$2')
  // Alphabet guard — anything outside the drill alphabet after L1 is a
  // homoglyph / injection / junk reject; the whitelist never widens.
  const badChar = ALPHABET_RE.exec(s)
  if (badChar !== null) {
    const ch = badChar[0]!
    const cp = ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')
    fail(`unsupported character U+${cp} (${JSON.stringify(ch)}) in '${s}' — outside the OCR whitelist alphabet`)
  }
  // Canonical depth suffix ('↓<n>').
  let depth = 0
  const depthMatch = /↓(\d+(?:\.\d+)?)$/.exec(s)
  if (depthMatch !== null) {
    const d = Number(depthMatch[1])
    if (!(d > 0)) fail(`depth suffix must be positive in '${s}'`)
    depth = d
    s = s.slice(0, depthMatch.index)
  }
  // Keyword contradictions — never silently resolved.
  if (thru && depth > 0) {
    fail(`THRU conflicts with a ↓ depth suffix in '${s}' — a through hole has no depth`)
  }
  if (thru && deepDepth !== undefined) {
    fail(`THRU conflicts with a DEEP depth in '${s}' — a through hole has no depth`)
  }
  if (depth > 0 && deepDepth !== undefined) {
    fail(`↓ depth suffix conflicts with a DEEP depth in '${s}' — keep exactly one depth notation`)
  }
  if (deepDepth !== undefined) depth = deepDepth
  const body = /^Ø(\d+(?:\.\d+)?)$/.exec(s)
  if (body === null) {
    fail(`cannot parse drill spec '${s}' — expected 'Ø<diameter>[depth suffix]'`)
  }
  const diameter = Number(body[1])
  if (!(diameter > 0)) {
    fail(`drill diameter must be positive in '${s}'`)
  }
  return { diameter, depth, thru: depth === 0 }
}
