/**
 * dim-spec — recursive {@link DimSpec} for `cad.sketch` unit-aware codegen.
 *
 * Every numeric field is explicitly declared:
 * - Length fields → `dim: 'length'`
 * - Angle fields → `dim: 'angle'`
 * - Pure numbers (counts, degrees, booleans) → `kind: 'plain'`
 * - String/boolean/ref fields → omitted (not numeric, `object` spec only
 *   descends into listed fields)
 *
 * Design doc §3.1 (user裁定 2026-10-10): `'plain'` is a legal, explicit
 * declaration — not an exemption. Every numeric parameter must be declared.
 */
import type { DimSpec } from '../units'

const LENGTH: DimSpec = { kind: 'dim', dim: 'length' }
const ANGLE: DimSpec = { kind: 'dim', dim: 'angle' }
const PLAIN: DimSpec = { kind: 'plain' }

/** [x, y] — both length. */
const PT2: DimSpec = { kind: 'array', item: LENGTH }

/** Pt2[] — array of length pairs (bspline control points). */
const PT2_ARRAY: DimSpec = { kind: 'array', item: PT2 }

/** [x, y, z] — all length (3D point, e.g. plane origin). */
const VEC3_LENGTH: DimSpec = { kind: 'array', item: LENGTH }

// ── shapes[] ──────────────────────────────────────────────────────────────

const shapeCases: Record<string, DimSpec> = {
  rect: { kind: 'object', fields: { w: LENGTH, d: LENGTH, cx: LENGTH, cy: LENGTH, angle: ANGLE } },
  roundedRect: { kind: 'object', fields: { w: LENGTH, d: LENGTH, r: LENGTH, cx: LENGTH, cy: LENGTH, angle: ANGLE } },
  circle: { kind: 'object', fields: { r: LENGTH, cx: LENGTH, cy: LENGTH } },
  ellipse: { kind: 'object', fields: { rx: LENGTH, ry: LENGTH, cx: LENGTH, cy: LENGTH, angle: ANGLE } },
  polygon: { kind: 'object', fields: { r: LENGTH, cx: LENGTH, cy: LENGTH, n: PLAIN, angle: ANGLE } },
  slot: { kind: 'object', fields: { w: LENGTH, d: LENGTH, cx: LENGTH, cy: LENGTH, angle: ANGLE } },
  trapezoid: { kind: 'object', fields: { w: LENGTH, h: LENGTH, cx: LENGTH, cy: LENGTH, a1: ANGLE, a2: ANGLE } },
  line: { kind: 'object', fields: { from: PT2, to: PT2 } },
  arc: { kind: 'object', fields: { cx: LENGTH, cy: LENGTH, r: LENGTH, a0: ANGLE, a1: ANGLE, ccw: PLAIN } },
  bspline: { kind: 'object', fields: { pts: PT2_ARRAY, degree: PLAIN } },
  point: { kind: 'object', fields: { x: LENGTH, y: LENGTH } },
  close: { kind: 'object', fields: {} },
}

// ── constraints[] ─────────────────────────────────────────────────────────
// Ref fields (of/a/b/p on/about) carry strings — not numeric, omitted.
// orientation `dir` is a direction vector — not length, declared `plain`.
// angle/arcAngle value is angle.

const constraintCases: Record<string, DimSpec> = {
  distance: { kind: 'object', fields: { value: LENGTH } },
  distanceX: { kind: 'object', fields: { value: LENGTH } },
  distanceY: { kind: 'object', fields: { value: LENGTH } },
  length: { kind: 'object', fields: { value: LENGTH } },
  radius: { kind: 'object', fields: { value: LENGTH } },
  diameter: { kind: 'object', fields: { value: LENGTH } },
  angle: { kind: 'object', fields: { value: ANGLE } },
  arcAngle: { kind: 'object', fields: { value: ANGLE } },
  parallel: { kind: 'object', fields: { dir: PLAIN } },
  perpendicular: { kind: 'object', fields: { dir: PLAIN } },
  orientation: { kind: 'object', fields: { dir: PLAIN } },
  fix: { kind: 'object', fields: {} },
  horizontal: { kind: 'object', fields: {} },
  vertical: { kind: 'object', fields: {} },
  collinear: { kind: 'object', fields: {} },
  concentric: { kind: 'object', fields: {} },
  equal: { kind: 'object', fields: {} },
  midpoint: { kind: 'object', fields: {} },
  symmetry: { kind: 'object', fields: {} },
  tangent: { kind: 'object', fields: {} },
  coincident: { kind: 'object', fields: {} },
  colinear: { kind: 'object', fields: {} },
}

// ── geoms[] (expanded canonical geometry) ─────────────────────────────────

const geomCases: Record<string, DimSpec> = {
  line: { kind: 'object', fields: { x1: LENGTH, y1: LENGTH, x2: LENGTH, y2: LENGTH } },
  circle: { kind: 'object', fields: { cx: LENGTH, cy: LENGTH, r: LENGTH } },
  arc: { kind: 'object', fields: { cx: LENGTH, cy: LENGTH, r: LENGTH, a0: ANGLE, a1: ANGLE, ccw: PLAIN } },
  point: { kind: 'object', fields: { x: LENGTH, y: LENGTH } },
  ellipse: { kind: 'object', fields: { cx: LENGTH, cy: LENGTH, rx: LENGTH, ry: LENGTH, angle: ANGLE, a0: ANGLE, a1: ANGLE } },
  bspline: {
    kind: 'object',
    fields: {
      poles: { kind: 'array', item: { kind: 'object', fields: { x: LENGTH, y: LENGTH } } },
      knots: { kind: 'array', item: PLAIN },
      degree: PLAIN,
    },
  },
}

// ── contours[] (segment loops: cad.profile / punchHole / sketchOn*) ────────
// The segment-loop data form shared by every 2D placement entry. Coordinates
// and radii are lengths; arc `startAngle`/`endAngle` are ANGLE — on the script
// face that means degrees (DEGREE = 1, RADIAN = 180/π), and the entry points
// convert once to the radians the geometry internals use. Never declare these
// `plain`: an arc's sweep IS dimensioned, and `plain` would let a bare number
// through — which is exactly what the unit system exists to refuse.
//
// `spline` carries NURBS control data: `poles` is a flat [x, y, x, y, …] run of
// lengths, while `knots`/`multiplicities`/`degree` are curve-parameter numbers
// (not lengths) → `plain`.

const segmentCases: Record<string, DimSpec> = {
  line: { kind: 'object', fields: { x1: LENGTH, y1: LENGTH, x2: LENGTH, y2: LENGTH } },
  arc: {
    kind: 'object',
    fields: {
      cx: LENGTH, cy: LENGTH, radius: LENGTH,
      startAngle: ANGLE, endAngle: ANGLE,
      ccw: PLAIN,
      x1: LENGTH, y1: LENGTH, x2: LENGTH, y2: LENGTH,
    },
  },
  spline: {
    kind: 'object',
    fields: {
      degree: PLAIN,
      poles: { kind: 'array', item: LENGTH },
      knots: { kind: 'array', item: PLAIN },
      multiplicities: { kind: 'array', item: PLAIN },
      weights: { kind: 'array', item: PLAIN },
      periodic: PLAIN,
      first: PLAIN,
      last: PLAIN,
    },
  },
}

// ── plane ─────────────────────────────────────────────────────────────────
// origin is a 3D point (length); normal and xAxis are direction vectors (plain).
// When plane is a string (named plane), the object spec falls through to fmtValue.

const planeSpec: DimSpec = {
  kind: 'object',
  fields: {
    origin: VEC3_LENGTH,
    normal: { kind: 'array', item: PLAIN },
    xAxis: { kind: 'array', item: PLAIN },
  },
}

// ── public API ────────────────────────────────────────────────────────────

/**
 * DimSpec for the `shapes[]` array of `cad.sketch`.
 * @returns a `tagged`-by-`kind` array spec; length fields → `dim:'length'`,
 *          angle fields → `dim:'angle'`, pure numbers → `plain`.
 */
export function shapesDimSpec(): DimSpec {
  return { kind: 'array', item: { kind: 'tagged', key: 'kind', cases: shapeCases } }
}

/**
 * DimSpec for the `constraints[]` array of `cad.sketch`.
 * @returns a `tagged`-by-`kind` array spec; length-valued constraints → `dim:'length'`,
 *          angle-valued constraints → `dim:'angle'`, pure numbers → `plain`.
 */
export function constraintsDimSpec(): DimSpec {
  return { kind: 'array', item: { kind: 'tagged', key: 'kind', cases: constraintCases } }
}

/**
 * DimSpec for the `contours[]` segment-loop form accepted by `cad.profile`,
 * `cad.punchHole`, `cad.sketchOnPlane`, `cad.sketchOnFace` and
 * `cad.sketchOnSurface`.
 *
 * Covers only the data form (`{ segments: […] }`). The drawn-contour form
 * (`Blueprint`) is pure geometry with no numeric parameters, so it needs no
 * declaration — `checkValueWithSpec` simply finds no fields to descend into.
 *
 * @returns an `array` of `{ segments: tagged-by-kind[] }` specs.
 */
export function contoursDimSpec(): DimSpec {
  return {
    kind: 'object',
    fields: {
      contours: {
        kind: 'array',
        item: {
          kind: 'object',
          fields: {
            segments: { kind: 'array', item: { kind: 'tagged', key: 'kind', cases: segmentCases } },
          },
        },
      },
    },
  }
}

/**
 * DimSpec for the top-level options object of `cad.sketch({ shapes, geoms, constraints, plane, ... })`.
 * @returns an `object` spec covering `shapes`/`geoms`/`constraints`/`plane` fields.
 */
export function sketchDimSpec(): DimSpec {
  return {
    kind: 'object',
    fields: {
      shapes: shapesDimSpec(),
      geoms: { kind: 'array', item: { kind: 'tagged', key: 'kind', cases: geomCases } },
      constraints: constraintsDimSpec(),
      plane: planeSpec,
    },
  }
}
