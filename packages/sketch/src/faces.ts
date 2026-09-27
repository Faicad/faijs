/**
 * faces — `sketchFaces`: solve a canonical sketch, chain the solved geometry
 * into closed contours and build the face through core's single face-
 * construction implementation (`buildProfileShape`).
 *
 * The solve → contour hand-off is a distinct, failable step (§3.3): a sketch
 * can solve successfully yet yield zero closed loops (dangling segments); that
 * is a real failure mode and is surfaced explicitly rather than treated as a
 * solved sketch.
 */
import { buildProfileShape, type ProfileLoop } from '@faicad/faijs/api/profile'
import type { Shape } from '@faicad/faijs/mesh/types'
import type { SketchConstraint, SketchGeom, SolveOutcome } from './canonical.js'
import { solveSketch, type SolveSketchOptions } from './solve.js'
import { toFreeCadGeoms } from './project.js'
import { extractContours } from './contour.js'

/** Options for {@link sketchFaces}. */
export interface SketchFacesOptions extends SolveSketchOptions {
  /** Product form: `'face'` (default) builds a face; `'wire'` returns the outer wire only. */
  as?: 'face' | 'wire'
  /** Diagnostics observer (the script-face op forwards this to the host sink). */
  onDiagnostic?: (outcome: SolveOutcome) => void
}

/**
 * Build the shape from an already-solved outcome (shared by op + wrapper).
 *
 * @param outcome - a converged solve outcome.
 * @param as - product form: `'face'` (default) or `'wire'`.
 * @returns the face or outer wire.
 */
export function shapeFromSolved(outcome: SolveOutcome, as?: 'face' | 'wire'): Shape {
  // D3 (2026-09-27): a conflicting over-constraint is allowed through with a
  // best-effort solve — the geometry carries the declared/last coordinates and
  // the conflict list travels in the diagnostic, not as an error. Only a hard
  // solver failure blocks face construction.
  if (!outcome.converged && outcome.status !== 'conflicting') {
    throw new Error(`E_SKETCHC_SOLVE_FAILED: ${outcome.reason ?? outcome.status}`)
  }
  const contours = extractContours(toFreeCadGeoms(outcome.geoms))
  if (contours.length === 0) {
    throw new Error('E_SKETCHC_NO_CONTOUR: solved sketch produced no closed loop')
  }
  const loops: ProfileLoop[] = contours.map((c) => ({ segments: c.segments }))
  return buildProfileShape({ contours: loops, as })
}

/**
 * Solve a canonical sketch and build its planar face / outer wire.
 *
 * @param geoms - canonical geometry (stored coordinates are the initial guess).
 * @param constraints - canonical constraints (default: none).
 * @param opts - solver selection, product form and diagnostics observer.
 * @returns the face (`as:'wire'` → the outer wire as a 1D curve).
 */
export async function sketchFaces(
  geoms: SketchGeom[],
  constraints: SketchConstraint[] = [],
  opts?: SketchFacesOptions,
): Promise<Shape> {
  const outcome = await solveSketch(geoms, constraints, opts)
  opts?.onDiagnostic?.(outcome)
  return shapeFromSolved(outcome, opts?.as)
}