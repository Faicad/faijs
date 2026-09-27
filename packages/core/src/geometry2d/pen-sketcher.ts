/**
 * geometry2d — 2D `BaseSketcher2d` pen (C1), adapted for the pure-object base.
 *
 * Ported from brepjs `2d/blueprints/baseSketcher2d.ts` (Apache-2.0).
 *
 * The brepjs original accumulates kernel-backed `Curve2D` handles (mutable:
 * `delete`/`reverse`/`tangentAt`). Here those are replaced by the pure
 * `Curve2dObj` base of `geometry2d/curve2d` — each pen method emits a plain
 * object, the pointer advances by plain arithmetic, and end-tangent lookup maps
 * to `tangentCurve2d`. `curves()`/`close()` return the ordered `Curve2dObj[]`,
 * which feeds `Blueprint` and the 2D→3D placement pipeline.
 *
 * Not-yet-ported (honest `throw`s, per the D-group/port plan):
 *   · `ellipse*`     — needs the SVG ellipse→arc helper;
 *   · `smoothSplit*` — needs the spline control helper;
 *   · `customCorner`/`closeWithMirror` — needs 2D corner/mirror ops (D-group).
 *
 * @module
 */

import {
  makeLine2d,
  makeArc2dThreePoints,
  makeArc2dTangent,
  makeBezier2d,
  tangentCurve2d,
  type Curve2dObj,
} from './curve2d'
import { makeEllipseArcFromSvgParams, normalizeEllipseRadii } from './svg-ellipse'
import { distance2d, normalize2d, polarAngle2d, polarToCartesian, samePoint } from './point'

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI

/** A `[x, y]` 2D point (plain tuple). */
export type Point2 = [number, number]

/** Options accepted by the spline methods. */
export type SplineOptions = {
  /** Explicit start tangent; defaults to `[1,0]` or the previous segment's end tangent. */
  startTangent?: Point2
  /** Explicit end tangent, or the literal `'symmetric'` (mirror of the start tangent). */
  endTangent?: Point2 | 'symmetric'
  /** Start control-length factor. */
  startFactor?: number
  /** End control-length factor. */
  endFactor?: number
}

/** Corner modes accepted by `customCorner` (D-group, not yet ported). */
export type CornerMode = 'fillet' | 'chamfer' | 'dogbone'

/** Guard-style error: throw so callers immediately see pen misuse. */
function bug(caller: string, message: string): never {
  throw new Error(`[geometry2d/pen] ${caller}: ${message}`)
}

/** Non-normalized tangent at the end of a curve (t=1 within its direct parameter space). */
function endTangent(c: Curve2dObj): [number, number] {
  return tangentCurve2d(c, 1)
}

/**
 * Base class for 2D flood-pen sketchers that accumulate `Curve2dObj` segments.
 *
 * Provides the shared pen-drawing API (lines, arcs, beziers) used by the
 * drawing DSL. Subclasses implement `close()` to package the accumulated curves
 * as a `Blueprint` or plain curve list.
 */
export class BaseSketcher2d {
  /** Current pen position `[x, y]`. */
  pointer: Point2
  /** The starting point of the pen run. */
  firstPoint: Point2
  /** Accumulated segments, in draw order. */
  pendingCurves: Curve2dObj[]
  /** A queued one-shot corner transform (D-group; unused until ported). */
  _nextCorner: ((a: Curve2dObj, b: Curve2dObj) => Curve2dObj[]) | null

  constructor(origin: Point2 = [0, 0]) {
    this.pointer = origin
    this.firstPoint = origin
    this.pendingCurves = []
    this._nextCorner = null
  }

  /**
   * The most recently drawn curve, or `null`.
   * @returns the last drawn curve, or `null` when nothing has been drawn.
   */
  _lastCurve(): Curve2dObj | null {
    return this.pendingCurves.length ? this.pendingCurves[this.pendingCurves.length - 1]! : null
  }

  /**
   * Fetch the last drawn curve, or throw a misuse error.
   * @param caller - the calling method name (for the error message).
   * @returns the last curve.
   */
  _requireLastCurve(caller: string): Curve2dObj {
    const c = this._lastCurve()
    if (!c) bug(caller, 'You need a previous curve to continue')
    return c
  }

  /**
   * Add a relative offset to the current pointer.
   * @param xDist - relative x distance.
   * @param yDist - relative y distance.
   * @returns the resulting absolute point.
   */
  _resolveRelative(xDist: number, yDist: number): Point2 {
    return [this.pointer[0] + xDist, this.pointer[1] + yDist]
  }

  /**
   * Save a curve and advance the pen to `end`.
   * @param curve - the curve to record.
   * @param end - the new pen position.
   * @returns this pen, for chaining.
   */
  _saveCurveAndAdvance(curve: Curve2dObj, end: Point2): this {
    this.saveCurve(curve)
    this.pointer = end
    return this
  }

  /** The current pen position `[x, y]`. */
  get penPosition(): Point2 {
    return this.pointer
  }

  /** The current pen angle in degrees (direction of the last segment's end tangent). */
  get penAngle(): number {
    const last = this._lastCurve()
    if (!last) return 0
    const [dx, dy] = endTangent(last)
    return Math.atan2(dy, dx) * RAD2DEG
  }

  /**
   * Move the pen to an absolute position before any segment is drawn.
   * @param point - the absolute start position.
   * @returns this pen, for chaining.
   */
  movePointerTo(point: Point2): this {
    if (this.pendingCurves.length) bug('movePointerTo', 'You can only move the pointer if there is no curve defined')
    this.pointer = point
    this.firstPoint = point
    return this
  }

  /**
   * Record a segment, applying a queued corner transform if present.
   * @param curve - the curve to record.
   */
  saveCurve(curve: Curve2dObj): void {
    if (!this._nextCorner) {
      this.pendingCurves.push(curve)
      return
    }
    const previous = this.pendingCurves.pop()
    if (!previous) bug('saveCurve', 'No previous curve available for custom corner')
    const cornered = this._nextCorner!(previous, curve)
    this.pendingCurves.push(...cornered)
    this._nextCorner = null
  }

  /**
   * Draw a straight line to an absolute point.
   * @param point - the absolute end point.
   * @returns this pen, for chaining.
   */
  lineTo(point: Point2): this {
    return this._saveCurveAndAdvance(makeLine2d(this.pointer[0], this.pointer[1], point[0], point[1]), point)
  }

  /**
   * Draw a straight line by relative horizontal and vertical distances.
   * @param x - relative x distance.
   * @param y - relative y distance.
   * @returns this pen, for chaining.
   */
  line(x: number, y: number): this {
    return this.lineTo(this._resolveRelative(x, y))
  }

  /**
   * Draw a vertical line of the given signed distance.
   * @param distance - signed vertical distance.
   * @returns this pen, for chaining.
   */
  vLine(distance: number): this {
    return this.line(0, distance)
  }

  /**
   * Draw a horizontal line of the given signed distance.
   * @param distance - signed horizontal distance.
   * @returns this pen, for chaining.
   */
  hLine(distance: number): this {
    return this.line(distance, 0)
  }

  /**
   * Draw a vertical line to an absolute Y coordinate.
   * @param yPos - the absolute y.
   * @returns this pen, for chaining.
   */
  vLineTo(yPos: number): this {
    return this.lineTo([this.pointer[0], yPos])
  }

  /**
   * Draw a horizontal line to an absolute X coordinate.
   * @param xPos - the absolute x.
   * @returns this pen, for chaining.
   */
  hLineTo(xPos: number): this {
    return this.lineTo([xPos, this.pointer[1]])
  }

  /**
   * Draw a line to an absolute point in polar form.
   * @param polar - `[radius, angleDeg]`.
   * @returns this pen, for chaining.
   */
  polarLineTo(polar: Point2): this {
    const [x, y] = polarToCartesian(polar[0], polar[1] * DEG2RAD)
    return this.lineTo([x, y])
  }

  /**
   * Draw a line in polar relative form.
   * @param distance - radial distance.
   * @param angle - angle in degrees.
   * @returns this pen, for chaining.
   */
  polarLine(distance: number, angle: number): this {
    const [x, y] = polarToCartesian(distance, angle * DEG2RAD)
    return this.line(x, y)
  }

  /**
   * Draw a line tangent to the previous curve.
   * @param distance - distance along the tangent.
   * @returns this pen, for chaining.
   */
  tangentLine(distance: number): this {
    const previous = this._requireLastCurve('tangentLine')
    const [dx, dy] = normalize2d(endTangent(previous))
    return this.line(dx * distance, dy * distance)
  }

  /**
   * Draw a circular arc through a mid-point to an absolute end point.
   * @param end - the absolute end point.
   * @param midPoint - a point on the arc.
   * @returns this pen, for chaining.
   */
  threePointsArcTo(end: Point2, midPoint: Point2): this {
    const curve = makeArc2dThreePoints(this.pointer[0], this.pointer[1], midPoint[0], midPoint[1], end[0], end[1])
    return this._saveCurveAndAdvance(curve, end)
  }

  /**
   * Draw a circular arc through a via-point to an end point, both relative.
   * @param x - relative x end distance.
   * @param y - relative y end distance.
   * @param viaX - relative via x distance.
   * @param viaY - relative via y distance.
   * @returns this pen, for chaining.
   */
  threePointsArc(x: number, y: number, viaX: number, viaY: number): this {
    const [ax, ay] = this.pointer
    return this.threePointsArcTo([ax + x, ay + y], [ax + viaX, ay + viaY])
  }

  /**
   * Draw a circular arc to an absolute end, bulging `sagitta` off the chord.
   * @param end - the absolute end point.
   * @param sagitta - the sagitta (signed bulge off the chord).
   * @returns this pen, for chaining.
   */
  sagittaArcTo(end: Point2, sagitta: number): this {
    const [x0, y0] = this.pointer
    const [x1, y1] = end
    const midX = (x0 + x1) / 2
    const midY = (y0 + y1) / 2
    const sX = -(y1 - y0)
    const sY = x1 - x0
    const sLen = Math.hypot(sX, sY)
    if (sLen < 1e-12) bug('sagittaArcTo', 'Start and end points cannot be identical')
    const sag: Point2 = [midX + (sX / sLen) * sagitta, midY + (sY / sLen) * sagitta]
    return this.threePointsArcTo(end, sag)
  }

  /**
   * Draw a circular arc to a relative end, bulging `sagitta`.
   * @param x - relative x end distance.
   * @param y - relative y end distance.
   * @param sagitta - the sagitta.
   * @returns this pen, for chaining.
   */
  sagittaArc(x: number, y: number, sagitta: number): this {
    return this.sagittaArcTo(this._resolveRelative(x, y), sagitta)
  }

  /**
   * Draw a vertical sagitta arc of `distance` and `sagitta`.
   * @param distance - vertical distance.
   * @param sagitta - the sagitta.
   * @returns this pen, for chaining.
   */
  vSagittaArc(distance: number, sagitta: number): this {
    return this.sagittaArc(0, distance, sagitta)
  }

  /**
   * Draw a horizontal sagitta arc of `distance` and `sagitta`.
   * @param distance - horizontal distance.
   * @param sagitta - the sagitta.
   * @returns this pen, for chaining.
   */
  hSagittaArc(distance: number, sagitta: number): this {
    return this.sagittaArc(distance, 0, sagitta)
  }

  /**
   * Draw a circular arc to an absolute end via a bulge factor.
   * @param end - the absolute end point.
   * @param bulge - the bulge factor.
   * @returns this pen, for chaining.
   */
  bulgeArcTo(end: Point2, bulge: number): this {
    if (!bulge) return this.lineTo(end)
    const halfChord = distance2d(this.pointer, end) / 2
    return this.sagittaArcTo(end, -bulge * halfChord)
  }

  /**
   * Draw a circular arc to a relative end via a bulge factor.
   * @param x - horizontal end distance.
   * @param y - vertical end distance.
   * @param bulge - the bulge factor.
   * @returns this pen, for chaining.
   */
  bulgeArc(x: number, y: number, bulge: number): this {
    return this.bulgeArcTo(this._resolveRelative(x, y), bulge)
  }

  /**
   * Draw a vertical bulge arc.
   * @param distance - vertical distance.
   * @param bulge - the bulge factor.
   * @returns this pen, for chaining.
   */
  vBulgeArc(distance: number, bulge: number): this {
    return this.bulgeArc(0, distance, bulge)
  }

  /**
   * Draw a horizontal bulge arc.
   * @param distance - horizontal distance.
   * @param bulge - the bulge factor.
   * @returns this pen, for chaining.
   */
  hBulgeArc(distance: number, bulge: number): this {
    return this.bulgeArc(distance, 0, bulge)
  }

  /**
   * Draw a circular arc tangent to the previous curve, ending at `end`.
   * @param end - the absolute end point.
   * @returns this pen, for chaining.
   */
  tangentArcTo(end: Point2): this {
    const previous = this._requireLastCurve('tangentArc')
    const arc = makeArc2dTangent(this.pointer[0], this.pointer[1], ...endTangent(previous), end[0], end[1])
    return this._saveCurveAndAdvance(arc, end)
  }

  /**
   * Draw a tangent arc to a relative offset.
   * @param x - horizontal end distance.
   * @param y - vertical end distance.
   * @returns this pen, for chaining.
   */
  tangentArc(x: number, y: number): this {
    return this.tangentArcTo(this._resolveRelative(x, y))
  }

  /**
   * Draw an elliptical arc (SVG-style endpoint parameters).
   * @param end - the absolute end point.
   * @param horizontalRadius - the horizontal radius.
   * @param verticalRadius - the vertical radius.
   * @param rotation - rotation in degrees.
   * @param longAxis - SVG large-arc flag.
   * @param sweep - SVG sweep flag.
   * @returns this pen, for chaining.
   */
  ellipseTo(end: Point2, horizontalRadius: number, verticalRadius: number, rotation = 0, longAxis = false, sweep = false): this {
    const { majorRadius, minorRadius, rotationAngle } = normalizeEllipseRadii(horizontalRadius, verticalRadius, rotation)
    const arc = makeEllipseArcFromSvgParams(this.pointer, end, majorRadius, minorRadius, rotationAngle, longAxis, sweep)
    return this._saveCurveAndAdvance(arc, end)
  }

  /**
   * Draw an elliptical arc to a relative end point.
   * @param x - relative x end distance.
   * @param y - relative y end distance.
   * @param horizontalRadius - the horizontal radius.
   * @param verticalRadius - the vertical radius.
   * @param rotation - rotation in degrees.
   * @param longAxis - SVG large-arc flag.
   * @param sweep - SVG sweep flag.
   * @returns this pen, for chaining.
   */
  ellipse(x: number, y: number, horizontalRadius: number, verticalRadius: number, rotation = 0, longAxis = false, sweep = false): this {
    return this.ellipseTo(this._resolveRelative(x, y), horizontalRadius, verticalRadius, rotation, longAxis, sweep)
  }

  /**
   * Draw a half-ellipse arc to an absolute end point with a given minor radius.
   * @param end - the absolute end point.
   * @param minorRadius - the minor radius.
   * @param sweep - SVG sweep flag.
   * @returns this pen, for chaining.
   */
  halfEllipseTo(end: Point2, minorRadius: number, sweep = false): this {
    const angle = polarAngle2d(end, this.pointer)
    const dist = distance2d(end, this.pointer)
    return this.ellipseTo(end, dist / 2, minorRadius, angle * RAD2DEG, true, sweep)
  }

  /**
   * Draw a half-ellipse arc to a relative end point with a given minor radius.
   * @param x - relative x end distance.
   * @param y - relative y end distance.
   * @param minorRadius - the minor radius.
   * @param sweep - SVG sweep flag.
   * @returns this pen, for chaining.
   */
  halfEllipse(x: number, y: number, minorRadius: number, sweep = false): this {
    return this.halfEllipseTo(this._resolveRelative(x, y), minorRadius, sweep)
  }

  /**
   * Draw a Bezier curve to an absolute end through control points.
   * @param end - the absolute end point.
   * @param controlPoints - one control point (quadratic) or two (cubic).
   * @returns this pen, for chaining.
   */
  bezierCurveTo(end: Point2, controlPoints: Point2[]): this {
    const poles: [number, number][] = [[this.pointer[0], this.pointer[1]], ...controlPoints, [end[0], end[1]]]
    return this._saveCurveAndAdvance(makeBezier2d(poles), end)
  }

  /**
   * Draw a quadratic Bezier to an absolute end point.
   * @param end - the absolute end point.
   * @param controlPoint - the single control point.
   * @returns this pen, for chaining.
   */
  quadraticBezierCurveTo(end: Point2, controlPoint: Point2): this {
    return this.bezierCurveTo(end, [controlPoint])
  }

  /**
   * Draw a cubic Bezier to an absolute end point.
   * @param end - the absolute end point.
   * @param startControlPoint - the start control point.
   * @param endControlPoint - the end control point.
   * @returns this pen, for chaining.
   */
  cubicBezierCurveTo(end: Point2, startControlPoint: Point2, endControlPoint: Point2): this {
    return this.bezierCurveTo(end, [startControlPoint, endControlPoint])
  }

  /**
   * Draw a smooth cubic spline to an absolute end point.
   * @param _end - the absolute end point.
   * @param _config - spline smoothing options.
   * @returns this pen, for chaining.
   * @throws not yet ported (needs the spline control helper).
   */
  smoothSplineTo(_end: Point2, _config?: SplineOptions): this {
    throw new Error('[geometry2d/pen] smoothSplineTo is not yet ported')
  }

  /**
   * Draw a smooth cubic spline to a relative end point.
   * @param _x - relative x end distance.
   * @param _y - relative y end distance.
   * @param _config - spline smoothing options.
   * @returns this pen, for chaining.
   * @throws not yet ported (needs the spline control helper).
   */
  smoothSpline(_x: number, _y: number, _config?: SplineOptions): this {
    throw new Error('[geometry2d/pen] smoothSpline is not yet ported')
  }

  /**
   * Change the corner between the previous and next segment.
   * @param _radius - the corner radius.
   * @param _mode - the corner kind.
   * @returns this pen, for chaining.
   * @throws D-group corner ops (fillet/chamfer/dogbone) are not yet ported.
   */
  customCorner(_radius: number, _mode: CornerMode = 'fillet'): this {
    throw new Error('[geometry2d/pen] customCorner: D-group corner ops are not yet ported')
  }

  /**
   * Close the sketch by drawing a final segment back to the start.
   * @returns the closed, ordered curve list.
   */
  close(): Curve2dObj[] {
    if (!samePoint(this.pointer, this.firstPoint)) {
      this.lineTo(this.firstPoint)
    }
    return [...this.pendingCurves]
  }

  /**
   * Close by mirroring the drawn segments across the start→current chord.
   * @returns the closed, mirror-augmented curve list.
   * @throws not yet ported (needs the curve-mirror transform).
   */
  closeWithMirror(): Curve2dObj[] {
    throw new Error('[geometry2d/pen] closeWithMirror is not yet ported')
  }

  /**
   * The ordered drawn curve list (no implicit close).
   * @returns the drawn segments in draw order.
   */
  curves(): Curve2dObj[] {
    return [...this.pendingCurves]
  }
}