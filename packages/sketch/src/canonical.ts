/**
 * canonical — the faijs canonical sketch model (§4 of the sketch library plan).
 *
 * One model, projected outward: the FreeCAD side (`fcstd-types.ts`) and the
 * CadQuery side (`./project.ts`) are projections of this shape, not parallel
 * implementations. Geometry declarations carry coordinates that ARE the solve
 * initial guess; constraints pull them exact.
 *
 * Units follow the project contract: lengths in mm, angles in degrees.
 */

/**
 * A position on an element. `number` is the 0..1 parametric position (0 =
 * start, 1 = end, 0.5 = arc/line midpoint). `'center'` is the circle/arc/ellipse
 * centre — semantically distinct from `'mid'`.
 */
export type At = number | 'start' | 'end' | 'mid' | 'center'

/** An element reference: `tag` (named) or `index` (array position); `at` omitted = whole element. */
export type Ref = { tag: string; at?: At } | { index: number; at?: At }

/**
 * Canonical sketch geometry. Supports `line` + `circle` + `arc` + `ellipse` +
 * `point` + `bspline` (ellipse/point reopened 2026-09-28, bspline 2026-09-29 —
 * the solver chain already consumed all three; only the op-entry schema was
 * narrower than the chain).
 *
 * `construction` (2026-09-30): reference geometry — symmetry axes, centrelines,
 * helper lines the constraints may be tied to but that must NOT become part of
 * the profile loop. It participates in the solve exactly like any other geom
 * (its whole point is to anchor constraints) and is filtered out of contour
 * extraction (`contour.ts`), which is what keeps a reference line's (often
 * arbitrary) coordinates from invading the profile chain.
 */
export type SketchGeom =
  | { tag?: string; construction?: boolean; kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { tag?: string; construction?: boolean; kind: 'circle'; cx: number; cy: number; r: number }
  | { tag?: string; construction?: boolean; kind: 'arc'; cx: number; cy: number; r: number; a0: number; a1: number; ccw?: boolean }
  | { tag?: string; construction?: boolean; kind: 'point'; x: number; y: number }
  | {
      tag?: string
      construction?: boolean
      kind: 'ellipse'
      cx: number
      cy: number
      rx: number
      ry: number
      a0?: number
      a1?: number
      /** major-axis rotation, radians */
      angle?: number
    }
  | {
      tag?: string
      construction?: boolean
      kind: 'bspline'
      poles: { x: number; y: number }[]
      knots: number[]
      degree: number
      periodic?: boolean
    }

/** Canonical constraint kinds (string enums; integer enums only appear at projection boundaries). */
export type SketchConstraint =
  | { kind: 'fixed'; of: Ref }
  | { kind: 'coincident'; a: Ref; b: Ref }
  | { kind: 'horizontal'; of: Ref }
  | { kind: 'vertical'; of: Ref }
  | { kind: 'parallel'; a: Ref; b: Ref }
  | { kind: 'perpendicular'; a: Ref; b: Ref }
  | { kind: 'tangent'; a: Ref; b: Ref }
  | { kind: 'distance'; a: Ref; b: Ref; value: number }
  | { kind: 'distanceX'; a: Ref; b: Ref; value: number }
  | { kind: 'distanceY'; a: Ref; b: Ref; value: number }
  | { kind: 'length'; of: Ref; value: number }
  | { kind: 'angle'; a: Ref; b: Ref; value: number }
  | { kind: 'orientation'; of: Ref; dir: [number, number] }
  | { kind: 'radius'; of: Ref; value: number }
  | { kind: 'diameter'; of: Ref; value: number }
  | { kind: 'arcAngle'; of: Ref; value: number }
  | { kind: 'equal'; a: Ref; b: Ref }
  | { kind: 'pointOnObject'; p: Ref; on: Ref }
  | { kind: 'symmetric'; p1: Ref; p2: Ref; about: Ref }

/** The `kind` string of a canonical constraint. */
export type SketchConstraintKind = SketchConstraint['kind']

/**
 * A canonical constraint involved in a conflict or redundancy, resolved to
 * human-readable element identifiers (tags) so a host / error message can point
 * at *where* the problem is (§3.2 of the 2026-09-27 over-constraint plan).
 */
export interface ConflictDetail {
  /** canonical constraint kind, e.g. `'length'` / `'coincident'`. */
  kind: SketchConstraintKind
  /** element identifiers the constraint references, as tags or `geom#<n>` fallbacks. */
  refs: string[]
  /** the constraint's value when it carries one (length / radius / angle / distance…). */
  value?: number
}

/** A canonical sketch: geometry declarations plus constraints. */
export interface SketchInput {
  geoms: SketchGeom[]
  constraints?: SketchConstraint[]
}

/**
 * Solve status (§5): under- and over-constraint are allowed, but never silent.
 */
export type SolveStatus =
  /** all constraints satisfied, zero remaining DoF */
  | 'solved'
  /** free DoF remain; solved to a minimal-displacement solution */
  | 'underconstrained'
  /** redundant constraints were dropped; solved */
  | 'redundant'
  /** constraints conflict; best-effort least-squares solution returned */
  | 'conflicting'
  /** solver failed numerically (not an under/over-constraint cause) */
  | 'failed'

/**
 * Result of one canonical solve: solved geometry plus explicit diagnostics.
 *
 * `converged` is false only for `failed` — under/redundant/conflicting all
 * produce geometry (allowed ≠ silent: the status and diagnostics carry the
 * story).
 */
export interface SolveOutcome {
  /** solved geometry, same order/index as input */
  geoms: SketchGeom[]
  /** true unless `status === 'failed'` */
  converged: boolean
  /** explicit solve status (§5) */
  status: SolveStatus
  /** remaining degrees of freedom when known (-1 = not reported) */
  dof: number
  /** constraint indices the solver flagged (conflicting/redundant) */
  problemConstraints: number[]
  /** constraint indices dropped because they could not be projected/pushed */
  droppedConstraints: number[]
  /** per-problem-constraint residual magnitude when available */
  residuals?: number[]
  /** resolved conflict details (tags) when `status === 'conflicting'` (§3.2) */
  conflictDetails?: ConflictDetail[]
  /** human-readable detail for a non-solved status */
  reason?: string
}