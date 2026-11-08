/**
 * primitives/screw/thread-spec — descriptive thread-spec parser
 *
 * Parses drawing-callout style thread specs ('M16-6H↧18', '1/4"-20-2B',
 * 'PT1/8') into a `ResolvedThreadSpec` shared by `fai_drill` (its `thread`
 * key) and `screw` (its `spec` key).
 *
 * Grammar (space/case tolerant; 'x'/'X' equal '×'; '↧' equal '↓'):
 *   metric  := 'M' <dia> [ '×' <pitch> ] [ '-' <class> ] [ ('↧'|'↓') <depth> ]
 *   imperial:= ( '#' <gauge> | <frac>'"' | <dec>'"' ) [ '-' <tpi> ] [ '-' <class> ] [ ('↧'|'↓') <depth> ]
 *   pipe    := ( 'PT' | 'R' | 'Rc' ) <size> [ ('↧'|'↓') <depth> ]
 *
 * The string is the drawing callout, so each suffix feeds its own field:
 * the class suffix ('-6H') becomes `toleranceClass`, the depth suffix
 * ('↧18'/'↓18') becomes `depth` (hole depth, NOT threadDepth). `specLabel`
 * is the normalized spec part WITHOUT class and depth — PMI display adopts
 * it directly (`formatThreadSpec` prefers `specLabel`).
 *
 * Any parse failure or out-of-table value throws {@link ThreadSpecError}
 * (code `E_THREAD_SPEC`) — never a silent fallback (project red line).
 */

import { getScrewSpecs, PIPE_SPECS } from './screw-db'
import type { ThreadSystem } from './screw-db'

/** Grammar help text appended to every parse failure. */
const GRAMMAR_HELP =
  'Supported grammar (space/case tolerant): '
  + 'metric \'M<dia>[×<pitch>][-<class>][↧|↓<depth>]\' (M2–M64, class [4-8][GH]); '
  + 'imperial \'(#<gauge> | <frac>" | <dec>")[-<tpi>][-<class>][↧|↓<depth>]\' (#4–1", class 1B|2B|3B); '
  + 'pipe \'PT|R|Rc<size>[↧|↓<depth>]\' (PT1/8–PT1/2, no class suffix).'

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
 * two optional ones exist only when the string (or explicit param) carries
 * them.
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
  /** Hole depth from the in-string suffix ('↧18'/'↓18'); omitted when absent. */
  depth?: number
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
 * @param spec - the drawing-callout spec string, e.g. 'M16-6H↧18'.
 * @returns the resolved spec (class/depth only when the string carries them).
 * @throws {ThreadSpecError} code `E_THREAD_SPEC` on any parse failure or
 *   out-of-table value (e.g. 'NPT1/2', 'M99', 'M16x', '-9Z', 'PT1/8-6H').
 */
export function parseThreadSpec(spec: string): ResolvedThreadSpec {
  if (typeof spec !== 'string' || spec.trim() === '') {
    throw new ThreadSpecError(`thread spec must be a non-empty string, got ${JSON.stringify(spec)}`)
  }
  // Normalize: drop all whitespace, uppercase, unify 'X' → '×' and '↧' → '↓'.
  const s = spec.replace(/\s+/gu, '').toUpperCase().replace(/X/g, '×').replace(/↧/g, '↓')
  let rest = s
  let depth: number | undefined
  const depthMatch = /↓(\d+(?:\.\d+)?)$/.exec(rest)
  if (depthMatch) {
    depth = Number(depthMatch[1])
    if (!(depth > 0)) throw new ThreadSpecError(`depth suffix must be positive in '${s}'`)
    rest = rest.slice(0, depthMatch.index)
  }
  if (rest.startsWith('M')) return parseMetric(rest, depth)
  if (/^(PT|R|RC)\d/.test(rest)) return parsePipe(rest, depth)
  return parseImperial(rest, depth)
}

/** Metric branch: `M<dia>[×<pitch>][-<class>]` (depth already stripped). */
function parseMetric(s: string, depth?: number): ResolvedThreadSpec {
  let rest = s
  let toleranceClass: string | undefined
  const classMatch = /-([0-9][GH])$/.exec(rest)
  if (classMatch) {
    const cls = classMatch[1]!
    if (!/^[4-8][GH]$/.test(cls)) {
      throw new ThreadSpecError(`metric tolerance class '-${cls}' is outside [4-8][GH] in '${s}'`)
    }
    toleranceClass = cls
    rest = rest.slice(0, classMatch.index)
  }
  const body = /^M(\d+(?:\.\d+)?)(?:×(\d+(?:\.\d+)?))?$/.exec(rest)
  if (!body) throw new ThreadSpecError(`cannot parse metric spec '${s}'`)
  const dia = Number(body[1])
  const pitchExplicit = body[2] !== undefined ? Number(body[2]) : undefined
  if (pitchExplicit !== undefined && !(pitchExplicit > 0)) {
    throw new ThreadSpecError(`pitch must be positive in '${s}'`)
  }
  const specs = getScrewSpecs('metric')
  const idx = specs.findIndex((e) => Math.abs(e.dia - dia) < 1e-9)
  if (idx < 0) throw new ThreadSpecError(`'M${body[1]}' is outside the metric table (M2–M64)`)
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
  }
}

/** Imperial branch: `(#<gauge> | <frac>" | <dec>")[-<tpi>][-<class>]` (depth already stripped). */
function parseImperial(s: string, depth?: number): ResolvedThreadSpec {
  let rest = s
  let toleranceClass: string | undefined
  const classMatch = /-([123]B)$/.exec(rest)
  if (classMatch) {
    toleranceClass = classMatch[1]!
    rest = rest.slice(0, classMatch.index)
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
  const dec = /^(\d+(?:\.\d+)?)"$/.exec(rest)
  if (gauge) {
    idx = specs.findIndex((e) => e.label === `#${gauge[1]}`)
  } else if (frac) {
    idx = specs.findIndex((e) => e.label === `${frac[1]}/${frac[2]}"`)
  } else if (dec) {
    const diaMm = Number(dec[1]) * 25.4
    idx = specs.findIndex((e) => Math.abs(e.dia - diaMm) < 1e-3)
  }
  if (idx < 0) throw new ThreadSpecError(`'${s}' does not match an imperial spec in the table (#4–1")`)
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
  }
}

/** Pipe branch: `(PT|R|Rc)<size>` — single pitch series, no class suffix. */
function parsePipe(s: string, depth?: number): ResolvedThreadSpec {
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
  }
}
