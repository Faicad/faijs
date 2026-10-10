/**
 * dim-spec — recursive {@link DimSpec} for `cad.sketch` unit-aware codegen (方案 D).
 *
 * Each length field in shapes / constraints / plane is declared `dim: 'length'`.
 * Angle fields (radians internally, per `canonical.ts`) are intentionally left
 * unlisted → bare, pending the degree↔radian boundary decision (design doc §8.1).
 * Count fields (`polygon.n`, `bspline.degree`) and boolean fields (`arc.ccw`) are
 * likewise unlisted → bare.
 *
 * Unlisted fields and unknown `kind` values fall through to bare output, so old
 * unit-less sketch code round-trips byte-identically.
 */
import type { DimSpec } from '@faicad/faijs/units'

const LENGTH: DimSpec = { kind: 'dim', dim: 'length' }

/** [x, y] — both length. */
const PT2: DimSpec = { kind: 'array', item: LENGTH }

/** Pt2[] — array of length pairs (bspline control points). */
const PT2_ARRAY: DimSpec = { kind: 'array', item: PT2 }

/** [x, y, z] — all length (3D point, e.g. plane origin). */
const VEC3_LENGTH: DimSpec = { kind: 'array', item: LENGTH }

// ── shapes[] ──────────────────────────────────────────────────────────────
// angle fields (ellipse.angle, polygon.angle, trapezoid.a1/a2, arc.a0/a1) are
// radians → unlisted → bare.

const shapeCases: Record<string, DimSpec> = {
  rect: { kind: 'object', fields: { w: LENGTH, d: LENGTH, cx: LENGTH, cy: LENGTH } },
  roundedRect: { kind: 'object', fields: { w: LENGTH, d: LENGTH, r: LENGTH, cx: LENGTH, cy: LENGTH } },
  circle: { kind: 'object', fields: { r: LENGTH, cx: LENGTH, cy: LENGTH } },
  ellipse: { kind: 'object', fields: { rx: LENGTH, ry: LENGTH, cx: LENGTH, cy: LENGTH } },
  polygon: { kind: 'object', fields: { r: LENGTH, cx: LENGTH, cy: LENGTH } },
  slot: { kind: 'object', fields: { w: LENGTH, d: LENGTH, cx: LENGTH, cy: LENGTH } },
  trapezoid: { kind: 'object', fields: { w: LENGTH, h: LENGTH, cx: LENGTH, cy: LENGTH } },
  line: { kind: 'object', fields: { from: PT2, to: PT2 } },
  arc: { kind: 'object', fields: { cx: LENGTH, cy: LENGTH, r: LENGTH } },
  bspline: { kind: 'object', fields: { pts: PT2_ARRAY } },
  point: { kind: 'object', fields: { x: LENGTH, y: LENGTH } },
  close: { kind: 'object', fields: {} },
}

// ── constraints[] ─────────────────────────────────────────────────────────
// angle/arcAngle value is radians → unlisted → bare.
// orientation dir is a direction vector → unlisted → bare.
// Ref fields (of/a/b/p/on/about) carry no length → unlisted → bare.

const constraintCases: Record<string, DimSpec> = {
  distance: { kind: 'object', fields: { value: LENGTH } },
  distanceX: { kind: 'object', fields: { value: LENGTH } },
  distanceY: { kind: 'object', fields: { value: LENGTH } },
  length: { kind: 'object', fields: { value: LENGTH } },
  radius: { kind: 'object', fields: { value: LENGTH } },
  diameter: { kind: 'object', fields: { value: LENGTH } },
}

// ── geoms[] (expanded canonical geometry) ─────────────────────────────────
// angle fields (arc.a0/a1, ellipse.a0/a1/angle) are radians → bare.
// bspline knots/degree are non-length → bare.

const geomCases: Record<string, DimSpec> = {
  line: { kind: 'object', fields: { x1: LENGTH, y1: LENGTH, x2: LENGTH, y2: LENGTH } },
  circle: { kind: 'object', fields: { cx: LENGTH, cy: LENGTH, r: LENGTH } },
  arc: { kind: 'object', fields: { cx: LENGTH, cy: LENGTH, r: LENGTH } },
  point: { kind: 'object', fields: { x: LENGTH, y: LENGTH } },
  ellipse: { kind: 'object', fields: { cx: LENGTH, cy: LENGTH, rx: LENGTH, ry: LENGTH } },
  bspline: {
    kind: 'object',
    fields: {
      poles: { kind: 'array', item: { kind: 'object', fields: { x: LENGTH, y: LENGTH } } },
    },
  },
}

// ── plane ─────────────────────────────────────────────────────────────────
// origin is a 3D point (length); normal and xAxis are direction vectors (bare).
// When plane is a string (named plane), the object spec falls through to fmtValue.

const planeSpec: DimSpec = { kind: 'object', fields: { origin: VEC3_LENGTH } }

// ── public API ────────────────────────────────────────────────────────────

/**
 * DimSpec for the `shapes[]` array of `cad.sketch`.
 * @returns a `tagged`-by-`kind` array spec; length fields → `dim:'length'`, angles bare.
 */
export function shapesDimSpec(): DimSpec {
  return { kind: 'array', item: { kind: 'tagged', key: 'kind', cases: shapeCases } }
}

/**
 * DimSpec for the `constraints[]` array of `cad.sketch`.
 * @returns a `tagged`-by-`kind` array spec; length-valued constraints → `dim:'length'`, angles bare.
 */
export function constraintsDimSpec(): DimSpec {
  return { kind: 'array', item: { kind: 'tagged', key: 'kind', cases: constraintCases } }
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