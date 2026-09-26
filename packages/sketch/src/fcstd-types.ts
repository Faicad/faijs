/**
 * fcstd-types — FCStd sketch geometry / constraint model (migrated from
 * `@faicad/faijs-fcstd`'s `sketch-parse.ts`, type half only).
 *
 * These are the FreeCAD-shaped records the solver pipeline consumes: geometry
 * carries an `index` (geoId) and 3D sketch-local coordinates; constraints carry
 * the `ConstraintType` integer and `(geoId, pos)` refs. The canonical,
 * projection-friendly model lives in `./canonical.ts` — this module is the
 * internal/FCStd-projection representation.
 *
 * Field format per the fcstd port plan §5.2/§5.3:
 * - geometry coordinates are 3D (X/Y/Z); sketch-local Z is usually 0
 * - `<Constrain>` carries Type as the ConstraintType enum integer
 * - ElementIds/ElementPositions take precedence over First/Second/Third
 * - IsDriving defaults to true when missing
 * - geoId: >= 0 own geometry; -1 HAxis/RtPnt; -2 VAxis; <= -3 external
 */

/** ConstraintType enum values (src/Mod/Sketcher/App/Constraint.h:52-77) */
export const ConstraintType = {
  Coincident: 1,
  Horizontal: 2,
  Vertical: 3,
  Parallel: 4,
  Tangent: 5,
  Distance: 6,
  DistanceX: 7,
  DistanceY: 8,
  Angle: 9,
  Perpendicular: 10,
  Radius: 11,
  Equal: 12,
  PointOnObject: 13,
  Symmetric: 14,
  InternalAlignment: 15,
  SnellsLaw: 16,
  Block: 17,
  Diameter: 18,
  Weight: 19,
  Group: 20,
  Text: 21,
} as const

/**
 * Human-readable names for the ConstraintType enum integers (debugging/
 * diagnostics only).
 */
export const CONSTRAINT_NAMES: Record<number, string> = {
  1: 'Coincident', 2: 'Horizontal', 3: 'Vertical', 4: 'Parallel', 5: 'Tangent',
  6: 'Distance', 7: 'DistanceX', 8: 'DistanceY', 9: 'Angle', 10: 'Perpendicular',
  11: 'Radius', 12: 'Equal', 13: 'PointOnObject', 14: 'Symmetric',
  15: 'InternalAlignment', 16: 'SnellsLaw', 17: 'Block', 18: 'Diameter',
  19: 'Weight', 20: 'Group', 21: 'Text',
}

/** GeoEnum (src/Mod/Sketcher/App/GeoEnum.h:71-78) */
export const GeoId = {
  RtPnt: -1,
  HAxis: -1,
  VAxis: -2,
  RefExt: -3,
} as const

/** PointPos (GeoEnum.h:88-94) */
export const PointPos = {
  none: 0, // edge itself
  start: 1,
  end: 2,
  mid: 3, // center of circle/ellipse
} as const

/**
 * One parsed sketch geometry element (point, line, circle, arc, ellipse or
 * bspline), in 3D sketch-local coordinates.
 */
export type FcstdSketchGeom =
  | { kind: 'point'; index: number; x: number; y: number; z: number }
  | { kind: 'line'; index: number; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number }
  | { kind: 'circle'; index: number; cx: number; cy: number; cz: number; radius: number }
  | {
      kind: 'arc'
      index: number
      cx: number
      cy: number
      cz: number
      radius: number
      startAngle: number // radians
      endAngle: number
      /** arc endpoints derived from angles (kept for solver wiring) */
      x1: number
      y1: number
      z1: number
      x2: number
      y2: number
      z2: number
    }
  | {
      kind: 'ellipse'
      index: number
      cx: number
      cy: number
      cz: number
      majorRadius: number
      minorRadius: number
      /** rotation of major axis, radians */
      angleXU: number
      /** first focus (computed) */
      fx1: number
      fy1: number
      fx2: number
      fy2: number
    }
  | {
      /** Part::GeomBSplineCurve (Poles/Knots/Degree/IsPeriodic) */
      kind: 'bspline'
      index: number
      poles: { x: number; y: number }[]
      knots: number[]
      degree: number
      periodic: boolean
      /** curve start/end (exact for clamped splines; solver wiring + chaining) */
      x1: number
      y1: number
      z1: number
      x2: number
      y2: number
      z2: number
    }

/**
 * One (geometry, point) reference inside a constraint: a geoId plus a
 * PointPos selector.
 */
export interface FcstdGeoRef {
  /** geometry id: >= 0 own geometry; -1 HAxis/RtPnt; -2 VAxis; <= -3 external */
  geoId: number
  /** PointPos selector (0 = edge itself, 1/2 = start/end, 3 = center) */
  pos: number // PointPos
}

/**
 * One parsed sketch constraint.
 */
export interface FcstdSketchCon {
  /** index in the constraint list */
  index: number
  /** ConstraintType integer */
  type: number
  /** resolved element refs */
  refs: FcstdGeoRef[]
  /** driving dimension value (Distance/Angle/Radius/...) */
  value: number
  /** IsDriving; missing means true */
  isDriving: boolean
  /** raw name attribute */
  name: string
  /** InternalAlignmentType when type === 15 */
  internalAlignmentType?: number
}

/**
 * The fully parsed sketch: geometry, constraints, constrainedness and the set
 * of referenced external geoIds.
 */
export interface FcstdParsedSketch {
  geoms: FcstdSketchGeom[]
  constraints: FcstdSketchCon[]
  fullyConstrained: boolean
  /** geoIds <= -3 referenced by constraints */
  externalGeoIds: number[]
}