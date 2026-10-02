/**
 * cadquery-selectors/types — shared types for the CadQuery selector subsystem.
 *
 * Companion to `2026-10-02-cadquery-selector-parity-plan.md`. These types are
 * the machine-readable description of the CadQuery string-syntax selector
 * grammar (upstream `cadquery/selectors.py` `_makeGrammar` /
 * `_makeExpressionGrammar`), so faijs' string selectors can be *verified*
 * against the reference implementation rather than approximated.
 */

/** A topological entity kind that selectors can target. */
export type EntityKind = 'face' | 'edge' | 'vertex'

/** A single narrowing step: pick `kind` sub-entities, then filter by `sel`. */
export interface SelStep {
  kind: EntityKind
  sel: string
}

/** A 3-D vector (component-wise, arbitrary scale). Kept non-normalised to
 * mirror CadQuery's `axes` table which stores `(1,1,0)` for `XY` etc. */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * A parse atom. Every string-syntax atom maps to exactly one descriptor,
 * mirroring upstream `_SimpleStringSyntaxSelector._chooseSelector`.
 */
export type AtomDesc =
  | { kind: 'dir'; vec: Vec3 } // bare axis `X` / `(x,y,z)` — DirectionSelector
  | { kind: 'parallel'; vec: Vec3 } // `|A` — ParallelDirSelector
  | { kind: 'perpendicular'; vec: Vec3 } // `#A` — PerpendicularDirSelector
  | { kind: 'signed'; vec: Vec3; sign: 1 | -1 } // `+A` / `-A` — DirectionSelector
  | { kind: 'minmax'; vec: Vec3; max: boolean } // `>A` / `<A` — DirectionMinMaxSelector
  | { kind: 'minmaxNth'; vec: Vec3; max: boolean; n: number } // `>A[k]` — DirectionNthSelector
  | { kind: 'centerNth'; vec: Vec3; max: boolean; n: number | null } // `>>A` / `<<A[k]` — CenterNthSelector
  | { kind: 'type'; name: string } // `%TYPE` — TypeSelector (name already upper-cased)

/**
 * Abstract syntax tree produced by the string grammar. Mirrors the pyparsing
 * `infix_notation` node shape: `and`/`or`/`exc` are n-ary left folds of their
 * (odd-indexed) operands; `not` is unary, right-associative, highest precedence.
 */
export type SelectorExpr =
  | { op: 'atom'; desc: AtomDesc }
  | { op: 'and' | 'or' | 'exc'; terms: SelectorExpr[] }
  | { op: 'not'; term: SelectorExpr }

/**
 * The geometry quantities a lifted entity exposes to predicates. Projected
 * lazily (each field is a function so a predicate only pays for what it reads).
 * `center` mirrors CadQuery's `Shape.Center()` — for faces this is the
 * area-weighted surface center of mass, NOT the bounding-box center.
 */
export interface EntityProj {
  /** Stable identity for de-dup / set keys (kernel hashCode). */
  hash: number
  /** CadQuery `Shape.Center()`: vertex point / linear COM / surface COM. */
  center: Vec3
  /** `Face.Center()` normal — oriented outward via owning solid. Null for non-faces. */
  surfaceNormal?: Vec3
  /** `Edge.tangentAt(0.5)` — oriented along the edge's parameter direction. */
  tangent?: Vec3
  /** `Face/Edge.geomType()` upcased, e.g. 'PLANE' / 'LINE' / 'CIRCLE'. */
  geomType?: string
  /** Only used for edge `%type` ordering of LUT (results present when edge). */
  isEdge: boolean
  isFace: boolean
  isVertex: boolean
}