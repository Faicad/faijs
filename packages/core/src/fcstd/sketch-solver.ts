/**
 * M3.2 — SketchSolver interface (D5) with the planegcs WASM backend.
 *
 * faijs depends only on this interface; the WASM implementation is swappable
 * (前文 B R2/R3). Input: parsed sketch geometry + constraints (M3.1 types).
 * Output: solved geometry or a structured failure — the caller (M3.5) decides
 * between solution and initial-value fallback (D2).
 */
import type { Result } from '../vendored/brepjs/core/result.js';
import type { SketchGeom, SketchCon } from './sketch-parse.js';

export interface SolveOutcome {
  /** geometry after solve, same order/index as input */
  geoms: SketchGeom[];
  /** true when the solver reports Success with no conflicts */
  converged: boolean;
  /** diagnostics when not converged */
  reason?: 'conflicting' | 'redundant' | 'failed' | 'unsupported-constraint';
  /** constraint indices the solver flagged */
  problemConstraints: number[];
  /** constraint indices dropped because their GCS shape could not be pushed */
  droppedConstraints: number[];
}

export interface ExternalFixedSeg {
  /** negative geoId in link order: -3, -4, ... (GeoEnum.RefExt downward) */
  geoId: number;
  polyline: [number, number][];
}

export interface SketchSolver {
  /**
   * Solve constraints against the given geometry. The input geometry's stored
   * coordinates are used as the initial guess (D2 — they are FreeCAD's last
   * solution and the ideal starting point).
   *
   * `external` carries pre-projected fixed geometry (M6.3): immutable 2D
   * polylines that constraints may reference by negative geoId. When a
   * constraint references an external geoId not present here, the solver
   * drops that constraint (recorded in droppedConstraints).
   */
  solve(
    geoms: SketchGeom[],
    constraints: SketchCon[],
    external?: ExternalFixedSeg[],
  ): Promise<Result<SolveOutcome, never>>;
}

/** Constraint types the planegcs backend can express (P0 set, plan §7 M3.4). */
export const SUPPORTED_CONSTRAINT_TYPES = new Set<number>([
  1, // Coincident
  2, // Horizontal
  3, // Vertical
  4, // Parallel
  5, // Tangent
  6, // Distance
  7, // DistanceX
  8, // DistanceY
  9, // Angle
  10, // Perpendicular
  11, // Radius
  12, // Equal
  13, // PointOnObject
  14, // Symmetric
  18, // Diameter
]);

/** Returns true when every constraint in the sketch is expressible. */
export function allConstraintsSupported(constraints: SketchCon[]): boolean {
  return constraints.every((c) => SUPPORTED_CONSTRAINT_TYPES.has(c.type));
}
