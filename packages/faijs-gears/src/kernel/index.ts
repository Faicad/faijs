/**
 * Raw kernel primitives for the gear builders.
 *
 * This module was migrated verbatim from cq-compat (`gears.ts`) — see the
 * file header in gears.ts for the provenance, the red lines, and the
 * 2026-10-14 内核取用面收敛 contract (`GearKernel = { l1, occt }`, taken via
 * `gearKernel()`; the package holds no raw-slot read and no kernel bootstrap).
 */

export {
  gearKernel,
  gearIsFace,
  gearIsShell,
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
  GearOcct,
  GearAxis,
  GearEdgeEnds,
  GearSplineFaceStrategy,
  GearSplineFaceOptions,
  GearSplineGrid,
  GearDeviationStats,
} from './gears'
