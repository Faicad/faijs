/**
 * faces — `sketchFaces`: solve a canonical sketch, chain the solved geometry
 * into closed contours and build the face through core's **unified 2D→3D
 * placement pipeline** (`buildSketchOnPlaneWith`, E2/F4): the contours are
 * lifted onto a target plane (named plane, e.g. `'XY'` / `'XZ'`) by the same
 * shared placement core used by `cad.sketchOnPlane`, so a solved sketch can be
 * placed on an arbitrary plane rather than only the implicit z=0 frame.
 *
 * The solve → contour build hand-off is a distinct, failable step (§3.3): a
 * sketch can solve successfully yet yield zero closed loops (dangling
 * segments); that is a real failure mode and is surfaced explicitly rather
 * than treated as a solved sketch.
 */
import { buildSketchOnPlaneWith } from '@faicad/faijs/api'
import type { ProfileLoop } from '@faicad/faijs/api/profile'
import type { SketchOnPlaneParams } from '@faicad/faijs/api'
import { getBrepApi } from '@faicad/faijs/brep/handle-bridge'
import type { Shape } from '@faicad/faijs/mesh/types'
import type { SketchConstraint, SketchGeom, SolveOutcome, ConflictDetail } from './canonical.js'
import type { SketchParams } from './op.js'
import { solveSketch, type SolveSketchOptions } from './solve.js'
import { toFreeCadGeoms } from './project.js'
import { extractContours } from './contour.js'

/** One-line description of a conflicting constraint, e.g. `length(bottom) = 80`. */
function describeConflict(d: ConflictDetail): string {
  const refs = d.refs.join(', ')
  const val = typeof d.value === 'number' ? ` = ${d.value}` : ''
  return `${d.kind}(${refs})${val}`
}

/**
 * Build the `E_SKETCHC_CONFLICTING` error message. Conflict details are
 * resolved to tags (never bare solver indices); falls back to numeric indices
 * when the solver reports none (§3.2, §5.1 probe caveat).
 */
function conflictingMessage(outcome: SolveOutcome): string {
  const header = 'E_SKETCHC_CONFLICTING: conflicting constraints detected'
  const details = outcome.conflictDetails
  if (details && details.length > 0) {
    return `${header}\n${details.map((d) => `  - ${describeConflict(d)}`).join('\n')}`
  }
  const idx = outcome.problemConstraints.length > 0
    ? ` (indices: ${outcome.problemConstraints.join(', ')})`
    : ''
  return `${header}${idx}`
}

/** Options for {@link sketchFaces}. */
export interface SketchFacesOptions extends SolveSketchOptions {
  /** Product form: `'face'` (default) builds a face; `'wire'` returns the outer wire only. */
  as?: 'face' | 'wire'
  /**
   * Named target plane (`'XY'` default; e.g. `'XZ'` / `'YZ'`) or an explicit
   * plane frame (A3, 2026-09-28): `{ origin, normal, xAxis? }` for arbitrary
   * sketch planes (the sketchOnPlane hand-off, D3 option (b)).
   */
  plane?: SketchParams['plane']
  /** Diagnostics observer (the script-face op forwards this to the host sink). */
  onDiagnostic?: (outcome: SolveOutcome) => void
}

/**
 * Build the shape from an already-solved outcome (shared by op + wrapper).
 *
 * @param outcome - a converged solve outcome.
 * @param as - product form: `'face'` (default) or `'wire'`.
 * @param plane - named plane or explicit frame `{ origin, normal, xAxis? }` (default `'XY'`).
 * @returns the placement face or outer wire.
 */
export function shapeFromSolved(outcome: SolveOutcome, as?: 'face' | 'wire', plane?: SketchParams['plane']): Shape {
  // 2026-09-27裁定: a conflicting over-constraint is a HARD error on the
  // script face — the message must point at the clashing constraints (§3.2).
  // Under- and redundant-constraint still solve normally; only a hard solver
  // failure blocks face construction as before.
  if (!outcome.converged && outcome.status === 'conflicting') {
    throw new Error(conflictingMessage(outcome))
  }
  if (!outcome.converged) {
    throw new Error(`E_SKETCHC_SOLVE_FAILED: ${outcome.reason ?? outcome.status}`)
  }
  const contours = extractContours(toFreeCadGeoms(outcome.geoms))
  if (contours.length === 0) {
    throw new Error('E_SKETCHC_NO_CONTOUR: solved sketch produced no closed loop')
  }
  const loops: ProfileLoop[] = contours.map((c) => ({ segments: c.segments }))
  // A3 (D3 (b)): the placement hand-off goes through the SAME shared
  // placement core (`buildSketchOnPlaneWith`) for both named planes and
  // explicit frames — the contours land on the target plane in one step.
  const planeSpec: SketchOnPlaneParams['plane'] =
    typeof plane === 'string' ? { name: plane } : (plane ?? { name: 'XY' })
  return buildSketchOnPlaneWith(getBrepApi(), {
    contours: loops,
    plane: planeSpec,
    as,
  })
}

/**
 * Solve a canonical sketch and build its planar face / outer wire.
 *
 * @param geoms - canonical geometry (stored coordinates are the initial guess).
 * @param constraints - canonical constraints (default: none).
 * @param opts - solver selection, product form, target plane and diagnostics observer.
 * @returns the face (`as:'wire'` → the outer wire as a 1D curve), placed on `opts.plane`.
 */
export async function sketchFaces(
  geoms: SketchGeom[],
  constraints: SketchConstraint[] = [],
  opts?: SketchFacesOptions,
): Promise<Shape> {
  const outcome = await solveSketch(geoms, constraints, opts)
  opts?.onDiagnostic?.(outcome)
  return shapeFromSolved(outcome, opts?.as, opts?.plane)
}
