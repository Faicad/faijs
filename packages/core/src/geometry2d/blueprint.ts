/**
 * Blueprint — ordered 2D profile of `Curve2dObj` segments (pure-data port of
 * brepjs `Blueprint`, Apache-2.0).
 *
 * Key adaptation: brepjs stores kernel-backed `Curve2D` handles that must be
 * disposed; faijs stores plain `Curve2dObj` objects (no handles, no dispose).
 * Kernel-coupling methods (sketchOnPlane / sketchOnFace / subFace / punchHole)
 * intentionally live in `geometry2d/bridge`, not here.
 *
 * @module
 */
import type { Curve2dObj } from './curve2d'
import { addCurveToBBox, evaluateCurve2d, curveBounds, intersectCurves2dFn, makeLine2d, mirrorAcrossAxis, mirrorAtPoint, rotateCurve2d, scaleCurve2d, translateCurve2d } from './curve2d'
import { centerOf, createBBox2d, isBBoxOut, mergeBBox, outsidePointOf, type BBox2d } from './bbox2d'

/** 2D point. */
export type Point2 = [number, number]

// `addCurveToBBox` writes xMin/yMin/xMax/yMax — same fields as BBox2d, so the
// structural subtype is satisfied by passing a plain BBox2d.
function curveBBox(c: Curve2dObj): BBox2d {
  const bb = createBBox2d()
  addCurveToBBox(bb as never, c, 1e-9)
  return bb
}

function containsBoxPoint(bb: BBox2d, pt: readonly [number, number]): boolean {
  return pt[0] >= bb.xMin && pt[0] <= bb.xMax && pt[1] >= bb.yMin && pt[1] <= bb.yMax
}

/**
 * True when `(x,y)` is within `tol` of curve `c`.
 * @param c - the curve to test against.
 * @param pt - the 2D point to test, `[x, y]`.
 * @param tol - the distance tolerance (default 1e-9).
 * @returns true when the point lies within `tol` of the curve.
 */
export function isOnCurve(c: Curve2dObj, pt: readonly [number, number], tol = 1e-9): boolean {
  const bb = curveBBox(c)
  if (!containsBoxPoint(bb, pt)) return false
  const b = curveBounds(c)
  const N = 32
  let best = Infinity
  for (let i = 0; i <= N; i++) {
    const t = b.first + ((b.last - b.first) * i) / N
    const [px, py] = evaluateCurve2d(c, t)
    const d2 = (px - pt[0]) ** 2 + (py - pt[1]) ** 2
    if (d2 < best) best = d2
  }
  return best <= tol * tol
}

/**
 * A planar 2D profile = an ordered sequence of 2D curves.
 * Shared base for `cad.profile`, drawn contours and (solved) `cad.sketch` outputs
 * on their way to `sketchOnPlane`/`sketchOnFace`.
 */
export class Blueprint {
  /** Ordered 2D curve segments composing this blueprint. */
  readonly curves: Curve2dObj[]

  private _bbox: BBox2d | null = null
  private _orientation: 'clockwise' | 'counterClockwise' | null = null
  private _guessedOrientation: 'clockwise' | 'counterClockwise' | null = null

  constructor(curves: Curve2dObj[]) {
    if (curves.length === 0) throw new Error('Blueprint requires at least one curve')
    this.curves = curves
  }

  /**
   * Return a shallow copy of this blueprint (new container, same curve objects).
   * @returns a new Blueprint with the same curves.
   */
  clone(): Blueprint {
    return new Blueprint([...this.curves])
  }

  /** Bounding box (cached). */
  get boundingBox(): BBox2d {
    if (!this._bbox) {
      const bb = createBBox2d()
      for (const c of this.curves) mergeBBox(bb, curveBBox(c))
      this._bbox = bb
    }
    return this._bbox
  }

  /** Winding orientation via shoelace (curve midpoints for non-lines). */
  get orientation(): 'clockwise' | 'counterClockwise' {
    if (this._orientation) return this._orientation
    if (this._guessedOrientation) return this._guessedOrientation
    const vertices: Point2[] = []
    for (const c of this.curves) {
      const b = curveBounds(c)
      vertices.push(firstPointOf(c))
      if (c.kind2d !== 'line') vertices.push(evaluate(c, (b.first + b.last) / 2) as Point2)
    }
    let area = 0
    for (let i = 0; i < vertices.length; i++) {
      const v1 = vertices[i]!
      const v2 = vertices[(i + 1) % vertices.length]!
      area += (v2[0] - v1[0]) * (v2[1] + v1[1])
    }
    this._guessedOrientation = area > 0 ? 'clockwise' : 'counterClockwise'
    return this._guessedOrientation
  }

  /**
   * Scale the blueprint about a center point.
   * @param factor - the scale factor to apply.
   * @param center - the scaling center `[x, y]` (defaults to the bounding-box center).
   * @returns a new Blueprint with every curve scaled about the center.
   */
  scale(factor: number, center?: Point2): Blueprint {
    const [cx, cy] = center ?? centerOf(this.boundingBox)
    return new Blueprint(this.curves.map((c) => scaleCurve2d(c, factor, cx, cy)))
  }

  /**
   * Translate the whole blueprint by a delta.
   * @param dxOrPoint - the x delta, or a full `[dx, dy]` offset point.
   * @param dy - the y delta (default 0, ignored when `dxOrPoint` is a point).
   * @returns a new Blueprint with every curve translated.
   */
  translate(dxOrPoint: number | Point2, dy?: number): Blueprint {
    const [dx, yy] = typeof dxOrPoint === 'number' ? [dxOrPoint, dy ?? 0] : [dxOrPoint[0], dxOrPoint[1]]
    return new Blueprint(this.curves.map((c) => translateCurve2d(c, dx, yy)))
  }

  /**
   * Rotate the whole blueprint about a center point.
   * @param angleDeg - the rotation angle in degrees.
   * @param center - the rotation center `[x, y]` (defaults to the origin).
   * @returns a new Blueprint with every curve rotated.
   */
  rotate(angleDeg: number, center?: Point2): Blueprint {
    const a = (angleDeg * Math.PI) / 180
    const [cx, cy] = center ?? [0, 0]
    return new Blueprint(this.curves.map((c) => rotateCurve2d(c, a, cx, cy)))
  }

  /**
   * Mirror the whole blueprint.
   * @param centerOrDirection - the mirror center (mode `center`) or the mirror axis direction.
   * @param origin - the axis origin `[x, y]` when mirroring across a plane (defaults to the origin).
   * @param mode - `center` mirrors about a point; `plane` mirrors across an axis.
   * @returns a new Blueprint with every curve mirrored.
   */
  mirror(centerOrDirection: Point2, origin?: Point2, mode: 'center' | 'plane' = 'center'): Blueprint {
    if (mode === 'plane') {
      const [ox, oy] = origin ?? [0, 0]
      const [dx, dy] = centerOrDirection
      return new Blueprint(this.curves.map((c) => mirrorAcrossAxis(c, ox, oy, dx, dy)))
    }
    const [cx, cy] = centerOrDirection
    return new Blueprint(this.curves.map((c) => mirrorAtPoint(c, cx, cy)))
  }

  /**
   * The starting point of the first curve.
   * @returns the 2D point where this blueprint begins.
   */
  get firstPoint(): Point2 {
    return firstPointOf(this.curves[0]!)
  }

  /**
   * The ending point of the last curve.
   * @returns the 2D point where this blueprint ends.
   */
  get lastPoint(): Point2 {
    return lastPointOf(this.curves[this.curves.length - 1]!)
  }

  /**
   * True when the profile closes back on itself.
   * @returns true when the first and last points coincide.
   */
  isClosed(): boolean {
    const fp = this.firstPoint
    const lp = this.lastPoint
    return Math.abs(fp[0] - lp[0]) < 1e-9 && Math.abs(fp[1] - lp[1]) < 1e-9
  }

  /**
   * True when a point is strictly inside (ray-cast); false on the boundary.
   * @param point - the 2D point to test, `[x, y]`.
   * @returns true when the point is strictly inside, false on/outside the boundary.
   */
  isInside(point: readonly [number, number]): boolean {
    const bbox = this.boundingBox
    const p: Point2 = [point[0], point[1]]
    if (!containsBoxPoint(bbox, p)) return false
    if (this.curves.some((c) => isOnCurve(c, p))) return false
    const outside = outsidePointOf(bbox)
    const segment = makeLine2d(p[0], p[1], outside[0], outside[1])
    const seen: Point2[] = []
    let crossCount = 0
    for (const c of this.curves) {
      if (isBBoxOut(curveBBox(segment), curveBBox(c))) continue
      const r = intersectCurves2dFn(segment, c, 1e-9)
      for (const pt of r.points) {
        if (!seen.some((s) => samePoint(s, pt))) {
          seen.push(pt)
          crossCount++
        }
      }
    }
    return crossCount % 2 === 1
  }

  /**
   * True when any curve of `this` intersects any curve of `other`.
   * @param other - the blueprint to test for intersections against.
   * @returns true when any pair of curves intersects.
   */
  intersects(other: Blueprint): boolean {
    if (isBBoxOut(this.boundingBox, other.boundingBox)) return false
    for (const a of this.curves) {
      for (const b of other.curves) {
        if (isBBoxOut(curveBBox(a), curveBBox(b))) continue
        const r = intersectCurves2dFn(a, b, 1e-9)
        if (r.points.length || r.segments.length) return true
      }
    }
    return false
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function evaluate(c: Curve2dObj, t: number): [number, number] {
  return evaluateCurve2d(c, t)
}

function firstPointOf(c: Curve2dObj): Point2 {
  return evaluateCurve2d(c, curveBounds(c).first)
}

function lastPointOf(c: Curve2dObj): Point2 {
  return evaluateCurve2d(c, curveBounds(c).last)
}

function samePoint(a: readonly [number, number], b: readonly [number, number], tol = 1e-9): boolean {
  return Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol
}