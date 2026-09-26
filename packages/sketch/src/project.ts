/**
 * project — single-point conversion between the canonical sketch model and the
 * two downstream projection dialects (§4.5).
 *
 *   canonical  ⇄  FCStd (`fcstd-types`, integer ConstraintType + PointPos)
 *   canonical  ⇄  CadQuery (tag + string constraint names, 0..1 positions)
 *
 * One implementation, two projections: the FCStd side feeds the planegcs solve
 * pipeline; the CadQuery side feeds `cq-compat-sketch`. Constraints with no
 * counterpart in a target dialect raise an explicit `E_SKETCHC_*` — never a
 * silent downgrade.
 */
import { PointPos, type FcstdGeoRef, type FcstdSketchGeom, type FcstdSketchCon } from './fcstd-types.js'
import { ConstraintType } from './fcstd-types.js'
import type { At, Ref, SketchConstraint, SketchConstraintKind, SketchGeom } from './canonical.js'

/** Projection error with a stable `E_SKETCHC_*` code. */
export class SketchProjectionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`)
    this.name = 'SketchProjectionError'
  }
}

// ── at / Ref resolution ──

/**
 * Map a canonical `At` to an FCStd `PointPos`. Throws `E_SKETCHC_UNMAPPED` when there is no counterpart.
 *
 * @param at - the canonical position.
 * @returns the FCStd `PointPos` integer.
 */
export function atToFreeCad(at: At | undefined): number {
  if (at === undefined) return PointPos.none
  if (at === 'start') return PointPos.start
  if (at === 'end') return PointPos.end
  if (at === 'center') return PointPos.mid
  if (at === 'mid') {
    throw new SketchProjectionError('E_SKETCHC_UNMAPPED', 'at "mid" (arc/line midpoint) has no FCStd PointPos')
  }
  if (typeof at === 'number') {
    if (at === 0) return PointPos.start
    if (at === 1) return PointPos.end
    throw new SketchProjectionError('E_SKETCHC_UNMAPPED', `parametric at ${at} has no FCStd PointPos`)
  }
  throw new SketchProjectionError('E_SKETCHC_UNMAPPED', `unsupported at ${String(at)}`)
}

/**
 * Map an FCStd `PointPos` to a canonical `At` (`mid` FCStd means the centre).
 *
 * @param pos - the FCStd `PointPos` integer.
 * @returns the canonical position, or `undefined` for `none`.
 */
export function atFromFreeCad(pos: number): At | undefined {
  switch (pos) {
    case PointPos.none: return undefined
    case PointPos.start: return 'start'
    case PointPos.end: return 'end'
    case PointPos.mid: return 'center'
    default: return undefined
  }
}

/**
 * Map a canonical `At` to a CadQuery 0..1 parameter (`null` = the arc-centre `None` argument).
 *
 * @param at - the canonical position.
 * @returns the CadQuery 0..1 parameter, or `null` for centre.
 */
export function atToCadQuery(at: At | undefined): number | null {
  if (at === undefined) return null
  if (at === 'start') return 0
  if (at === 'end') return 1
  if (at === 'mid') return 0.5
  if (at === 'center') return null
  return at
}

/**
 * Map a CadQuery 0..1 parameter to a canonical `At`.
 *
 * @param v - the CadQuery parameter, or `null`/`undefined` for centre.
 * @returns the canonical position, or `undefined` for `null`/`undefined`.
 */
export function atFromCadQuery(v: number | null | undefined): At | undefined {
  if (v === null || v === undefined) return undefined
  if (v === 0) return 'start'
  if (v === 1) return 'end'
  if (v === 0.5) return 'mid'
  return v
}

/**
 * Build the tag → index lookup for a geometry list in one pass.
 *
 * @param geoms - canonical geometry list.
 * @returns tag → geometry index.
 */
export function buildTagIndex(geoms: SketchGeom[]): Map<string, number> {
  const index = new Map<string, number>()
  geoms.forEach((g, i) => {
    if (g.tag !== undefined) index.set(g.tag, i)
  })
  return index
}

/**
 * Resolve a canonical `Ref` to an FCStd `(geoId, pos)` pair.
 *
 * @param ref - the canonical reference (tag or index + at).
 * @param tagIndex - tag → index map (from {@link buildTagIndex}).
 * @param geoms - the geometry array (for bounds checking of index refs).
 * @returns the FCStd `(geoId, pos)` pair.
 * @throws SketchProjectionError `E_SKETCHC_BAD_REF` for unknown tag or out-of-range index.
 */
export function refToFreeCad(ref: Ref, tagIndex: Map<string, number>, geoms: SketchGeom[]): FcstdGeoRef {
  let geoId: number
  if ('tag' in ref) {
    const found = tagIndex.get(ref.tag)
    if (found === undefined) {
      throw new SketchProjectionError('E_SKETCHC_BAD_REF', `unknown tag "${ref.tag}"`)
    }
    geoId = found
  } else {
    if (!Number.isInteger(ref.index) || ref.index < 0 || ref.index >= geoms.length) {
      throw new SketchProjectionError('E_SKETCHC_BAD_REF', `index ${ref.index} out of range [0, ${geoms.length})`)
    }
    geoId = ref.index
  }
  return { geoId, pos: atToFreeCad(ref.at) }
}

// ── geometry projection ──

/**
 * Project canonical geometry to the FCStd shape consumed by the solver.
 *
 * @param geoms - canonical geometry.
 * @returns FCStd geometry records (same order/index).
 * @throws SketchProjectionError `E_SKETCHC_UNSUPPORTED_GEOM` for reserved kinds.
 */
export function toFreeCadGeoms(geoms: SketchGeom[]): FcstdSketchGeom[] {
  return geoms.map((g, index): FcstdSketchGeom => {
    switch (g.kind) {
      case 'line':
        return { kind: 'line', index, x1: g.x1, y1: g.y1, z1: 0, x2: g.x2, y2: g.y2, z2: 0 }
      case 'circle':
        return { kind: 'circle', index, cx: g.cx, cy: g.cy, cz: 0, radius: g.r }
      case 'arc': {
        // Pass the canonical signed span (a0, a1) through unchanged. planegcs builds
        // the arc from the pinned start/end endpoints *and* the signed start/end
        // angles, so a CW arc (a1 < a0) is drawn as the short clockwise arc.
        // Normalising a1 into a CCW span would instead produce the long arc through
        // those same endpoints. Arc orientation is carried back to the caller via
        // solveSketch (input ccw preserved), not recovered here.
        const a0 = g.a0
        const a1 = g.a1
        return {
          kind: 'arc', index, cx: g.cx, cy: g.cy, cz: 0, radius: g.r,
          startAngle: a0, endAngle: a1,
          x1: g.cx + g.r * Math.cos(a0), y1: g.cy + g.r * Math.sin(a0), z1: 0,
          x2: g.cx + g.r * Math.cos(a1), y2: g.cy + g.r * Math.sin(a1), z2: 0,
        }
      }
      case 'point':
      case 'ellipse':
      case 'bspline':
        throw new SketchProjectionError('E_SKETCHC_UNSUPPORTED_GEOM', `geometry kind "${g.kind}" is not supported in the first release`)
    }
  })
}

/**
 * Project FCStd geometry back to the canonical model (reserved kinds are reported).
 *
 * @param geoms - FCStd geometry records from the solver.
 * @returns canonical geometry (same order/index).
 */
export function fromFreeCadGeoms(geoms: FcstdSketchGeom[]): SketchGeom[] {
  return geoms.map((g): SketchGeom => {
    switch (g.kind) {
      case 'line':
        return { kind: 'line', x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 }
      case 'circle':
        return { kind: 'circle', cx: g.cx, cy: g.cy, r: g.radius }
      case 'arc': {
        const ccw = normalizeArcCcw(g.startAngle, g.endAngle)
        return { kind: 'arc', cx: g.cx, cy: g.cy, r: g.radius, a0: g.startAngle, a1: g.endAngle, ccw }
      }
      case 'point':
        return { kind: 'point', x: g.x, y: g.y }
      case 'ellipse':
        return { kind: 'ellipse', cx: g.cx, cy: g.cy, rx: g.majorRadius, ry: g.minorRadius, angle: g.angleXU }
      case 'bspline':
        return { kind: 'bspline', poles: g.poles, knots: g.knots, degree: g.degree, periodic: g.periodic }
    }
  })
}

/** True when the arc span is counter-clockwise as stored. */
function normalizeArcCcw(startAngle: number, endAngle: number): boolean {
  let sweep = endAngle - startAngle
  while (sweep <= 0) sweep += 2 * Math.PI
  while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI
  return sweep > 0
}

// ── constraint projection ──

/** FCStd constraint shape produced by one canonical constraint. */
interface FcstdConstraintShape {
  type: number
  refs: FcstdGeoRef[]
  value?: number
}

/** `'noop'`: no FCStd constraint is needed (the implicit fixed frame covers it). */
type Mapped = FcstdConstraintShape | 'noop'

function mapConstraint(c: SketchConstraint, tagIndex: Map<string, number>, geoms: SketchGeom[]): Mapped {
  const ref = (r: Ref): FcstdGeoRef => refToFreeCad(r, tagIndex, geoms)
  switch (c.kind) {
    case 'fixed':
      // FCStd has no explicit fixed constraint — the implicit fixed frame
      // (RtPnt + H/V axes) absorbs the rigid-body DoF (§4.5).
      return 'noop'
    case 'coincident':
      return { type: ConstraintType.Coincident, refs: [ref(c.a), ref(c.b)] }
    case 'horizontal':
      return { type: ConstraintType.Horizontal, refs: [ref(c.of)] }
    case 'vertical':
      return { type: ConstraintType.Vertical, refs: [ref(c.of)] }
    case 'parallel':
      return { type: ConstraintType.Parallel, refs: [ref(c.a), ref(c.b)] }
    case 'perpendicular':
      return { type: ConstraintType.Perpendicular, refs: [ref(c.a), ref(c.b)] }
    case 'tangent':
      return { type: ConstraintType.Tangent, refs: [ref(c.a), ref(c.b)] }
    case 'distance':
      return { type: ConstraintType.Distance, refs: [ref(c.a), ref(c.b)], value: c.value }
    case 'distanceX':
      return { type: ConstraintType.DistanceX, refs: [ref(c.a), ref(c.b)], value: c.value }
    case 'distanceY':
      return { type: ConstraintType.DistanceY, refs: [ref(c.a), ref(c.b)], value: c.value }
    case 'length': {
      // Length is expressed as a point-to-point Distance over the element ends.
      const base = ref(c.of)
      const start = { geoId: base.geoId, pos: PointPos.start }
      const end = { geoId: base.geoId, pos: PointPos.end }
      return { type: ConstraintType.Distance, refs: [start, end], value: c.value }
    }
    case 'angle':
      return { type: ConstraintType.Angle, refs: [ref(c.a), ref(c.b)], value: c.value }
    case 'orientation':
      throw new SketchProjectionError('E_SKETCHC_UNMAPPED', 'constraint "orientation" has no FCStd counterpart')
    case 'radius':
      return { type: ConstraintType.Radius, refs: [ref(c.of)], value: c.value }
    case 'diameter':
      return { type: ConstraintType.Diameter, refs: [ref(c.of)], value: c.value }
    case 'arcAngle':
      throw new SketchProjectionError('E_SKETCHC_UNMAPPED', 'constraint "arcAngle" has no FCStd counterpart')
    case 'equal':
      return { type: ConstraintType.Equal, refs: [ref(c.a), ref(c.b)] }
    case 'pointOnObject':
      return { type: ConstraintType.PointOnObject, refs: [ref(c.p), ref(c.on)] }
    case 'symmetric':
      return { type: ConstraintType.Symmetric, refs: [ref(c.p1), ref(c.p2), ref(c.about)] }
  }
}

/** Result of projecting canonical constraints to FCStd. */
export interface ProjectedConstraints {
  /** FCStd constraints (index matches the canonical constraint order for kept items). */
  constraints: FcstdSketchCon[]
  /** canonical constraint indices mapped to a deliberate no-op (fixed). */
  noops: number[]
}

/**
 * Project canonical constraints to the FCStd shape the solver consumes.
 *
 * @param constraints - canonical constraints.
 * @param geoms - canonical geometry (for tag/index resolution).
 * @returns FCStd constraints plus the no-op (`fixed`) indices.
 */
export function toFreeCadConstraints(constraints: SketchConstraint[], geoms: SketchGeom[]): ProjectedConstraints {
  const tagIndex = buildTagIndex(geoms)
  const out: FcstdSketchCon[] = []
  const noops: number[] = []
  constraints.forEach((c, index) => {
    const mapped = mapConstraint(c, tagIndex, geoms)
    if (mapped === 'noop') {
      noops.push(index)
      return
    }
    out.push({ index, type: mapped.type, refs: mapped.refs, value: mapped.value ?? 0, isDriving: true, name: '' })
  })
  return { constraints: out, noops }
}

// ── CadQuery projection (constraint type names) ──

/** CadQuery constraint names for the canonical kinds it supports (the other 8). */
export const CONSTRAINT_KIND_TO_CADQUERY: Partial<Record<SketchConstraintKind, string>> = {
  fixed: 'FixedPoint',
  coincident: 'Coincident',
  angle: 'Angle',
  length: 'Length',
  distance: 'Distance',
  radius: 'Radius',
  orientation: 'Orientation',
  arcAngle: 'ArcAngle',
}

/** CadQuery constraint name → canonical kind. */
export const CADQUERY_TO_CONSTRAINT_KIND: Record<string, SketchConstraintKind> = Object.fromEntries(
  Object.entries(CONSTRAINT_KIND_TO_CADQUERY).map(([kind, name]) => [name, kind as SketchConstraintKind]),
)

/**
 * Map a canonical constraint kind to its CadQuery name.
 *
 * @param kind - canonical constraint kind.
 * @returns the CadQuery constraint name.
 * @throws SketchProjectionError `E_SKETCHC_UNSUPPORTED_BY_CQ` when CQ has no counterpart.
 */
export function constraintKindToCadQuery(kind: SketchConstraintKind): string {
  const name = CONSTRAINT_KIND_TO_CADQUERY[kind]
  if (!name) {
    throw new SketchProjectionError('E_SKETCHC_UNSUPPORTED_BY_CQ', `constraint "${kind}" is not supported by CadQuery`)
  }
  return name
}

/**
 * Map a CadQuery constraint name to its canonical kind.
 *
 * @param name - CadQuery constraint name.
 * @returns the canonical kind.
 * @throws SketchProjectionError `E_SKETCHC_UNSUPPORTED_CONSTRAINT` for unknown names.
 */
export function constraintKindFromCadQuery(name: string): SketchConstraintKind {
  const kind = CADQUERY_TO_CONSTRAINT_KIND[name]
  if (!kind) {
    throw new SketchProjectionError('E_SKETCHC_UNSUPPORTED_CONSTRAINT', `unknown CadQuery constraint "${name}"`)
  }
  return kind
}