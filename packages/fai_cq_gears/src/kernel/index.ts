/**
 * Raw occt-wasm kernel primitives for the gear builders.
 *
 * This module was migrated verbatim from cq-compat (`gears.ts`) — see the
 * file header in gears.ts for the provenance and red lines (no direct
 * occt-wasm usage outside `getGearKernel`).
 */

export {
  getGearKernel,
  connectEdgesToWires,
  gearFaceFromWires,
  gearShellToSolid,
  gearEdgeEnds,
  buildGearSplineFace,
  soleGearFace,
  gearDistanceToFace,
  gearFaceDeviation,
  DEFAULT_GEAR_SPLINE_FACE_STRATEGY,
  GEAR_SPLINE_FACE_STRATEGIES,
} from './gears'
export type {
  GearKernel,
  GearAxis,
  GearEdgeEnds,
  GearSplineFaceStrategy,
  GearSplineFaceOptions,
  GearSplineGrid,
  GearDeviationStats,
} from './gears'
