/**
 * Pure-TypeScript 2D analytic curve model (faijs port of brepjs).
 *
 * Adapted from brepjs `src/kernel/geometry2d.ts` (Apache-2.0), preserving core
 * algorithms and naming. Differences from brepjs:
 * - discriminant field renamed `__bk2d` → `kind2d` (2026-09-27 decision),
 *   bbox discriminant `__bk2d_bbox` → `kind2d_b`.
 * - All curves are plain data objects (no kernel handles, no dispose), per the
 *   faijs "2D curves are pure objects" design (docs/plans/2d-sketching: A1/B1).
 *
 * Pure TS, zero WASM, zero external deps. All 2D curves represented as plain
 * objects with a `kind2d` discriminant.
 *
 * License: adapted from brepjs (Apache-2.0). Retained per faijs convention for
 * brepjs-ported files (cf. svg-to-solid.ts).
 *
 * @module
 */
// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** Line: origin + unit direction + length. */
export interface Line2d {
  readonly kind2d: 'line'
  readonly ox: number
  readonly oy: number
  readonly dx: number
  readonly dy: number
  readonly len: number
}
/** Full circle. sense=true → CCW. */
export interface Circle2d {
  readonly kind2d: 'circle'
  readonly cx: number
  readonly cy: number
  readonly radius: number
  readonly sense: boolean
}
/** Ellipse (or arc of one, via trim). */
export interface Ellipse2d {
  readonly kind2d: 'ellipse'
  readonly cx: number
  readonly cy: number
  readonly majorRadius: number
  readonly minorRadius: number
  readonly xDirAngle: number
  readonly sense: boolean
}
/** Bezier curve (De Casteljau). */
export interface Bezier2d {
  readonly kind2d: 'bezier'
  readonly poles: [number, number][]
}
/** B-spline (De Boor). */
export interface BSpline2d {
  readonly kind2d: 'bspline'
  readonly poles: [number, number][]
  readonly knots: number[]
  readonly multiplicities: number[]
  readonly degree: number
  readonly isPeriodic: boolean
}
/** Trimmed wrapper over another curve. */
export interface TrimmedCurve2d {
  readonly kind2d: 'trimmed'
  readonly basis: Curve2dObj
  readonly tStart: number
  readonly tEnd: number
}
/**
 * A 2D curve expressed as one of the supported analytic or spline kinds.
 * Discriminated by the `kind2d` field.
 */
export type Curve2dObj = Line2d | Circle2d | Ellipse2d | Bezier2d | BSpline2d | TrimmedCurve2d

/**
 * Mutable 2D bounding box carried by the curve-specific bbox helpers.
 * `kind2d_b` marks the discriminant used to detect this box type.
 */
export interface CurveBBox2d {
  readonly kind2d_b: true
  xMin: number
  yMin: number
  xMax: number
  yMax: number
}

/**
 * Evaluate a curve at parameter t to a 2D point.
 * @param c - the curve to evaluate.
 * @param t - the parameter value within the curve's domain.
 * @returns the 2D point `[x, y]` on the curve.
 */
export function evaluateCurve2d(c: Curve2dObj, t: number): [number, number] {
  switch (c.kind2d) {
    case 'line':
      return [c.ox + c.dx * t, c.oy + c.dy * t]
    case 'circle': {
      const angle = c.sense ? t : -t
      return [c.cx + c.radius * Math.cos(angle), c.cy + c.radius * Math.sin(angle)]
    }
    case 'ellipse': {
      const angle = c.sense ? t : -t
      const cos = Math.cos(c.xDirAngle)
      const sin = Math.sin(c.xDirAngle)
      const x = c.majorRadius * Math.cos(angle)
      const y = c.minorRadius * Math.sin(angle)
      return [c.cx + x * cos - y * sin, c.cy + x * sin + y * cos]
    }
    case 'bezier':
      return evaluateBezier(c.poles, t)
    case 'bspline':
      return evaluateBSpline2d(c, t)
    case 'trimmed': {
      const mapped = c.tStart + t * (c.tEnd - c.tStart)
      return evaluateCurve2d(c.basis, mapped)
    }
  }
}

/**
 * Tangent (non-normalized direction derivative) at parameter t.
 * @param c - the curve to differentiate.
 * @param t - the parameter value within the curve's domain.
 * @returns the unnormalized tangent vector `[dx, dy]` at `t`.
 */
export function tangentCurve2d(c: Curve2dObj, t: number): [number, number] {
  switch (c.kind2d) {
    case 'line':
      return [c.dx, c.dy]
    case 'circle': {
      const angle = c.sense ? t : -t
      const sign = c.sense ? 1 : -1
      return [-c.radius * Math.sin(angle) * sign, c.radius * Math.cos(angle) * sign]
    }
    case 'ellipse': {
      const angle = c.sense ? t : -t
      const sign = c.sense ? 1 : -1
      const cos = Math.cos(c.xDirAngle)
      const sin = Math.sin(c.xDirAngle)
      const dx = -c.majorRadius * Math.sin(angle) * sign
      const dy = c.minorRadius * Math.cos(angle) * sign
      return [dx * cos - dy * sin, dx * sin + dy * cos]
    }
    case 'bezier': {
      // Numerical differentiation
      const h = 1e-8
      const p0 = evaluateBezier(c.poles, Math.max(0, t - h))
      const p1 = evaluateBezier(c.poles, Math.min(1, t + h))
      const dt = Math.min(1, t + h) - Math.max(0, t - h)
      return [(p1[0] - p0[0]) / dt, (p1[1] - p0[1]) / dt]
    }
    case 'bspline': {
      const h = 1e-8
      const kFirst = c.knots[0]!
      const kLast = c.knots[c.knots.length - 1]!
      const p0 = evaluateBSpline2d(c, Math.max(kFirst, t - h))
      const p1 = evaluateBSpline2d(c, Math.min(kLast, t + h))
      const dt = Math.min(kLast, t + h) - Math.max(kFirst, t - h)
      return [(p1[0] - p0[0]) / dt, (p1[1] - p0[1]) / dt]
    }
    case 'trimmed': {
      const mapped = c.tStart + t * (c.tEnd - c.tStart)
      const tan = tangentCurve2d(c.basis, mapped)
      const scale = c.tEnd - c.tStart
      return [tan[0] * scale, tan[1] * scale]
    }
  }
}

/**
 * Parameter domain of a curve.
 * @param c - the curve whose domain to read.
 * @returns the inclusive `first` and `last` parameter bounds.
 */
export function curveBounds(c: Curve2dObj): { first: number; last: number } {
  switch (c.kind2d) {
    case 'line':
      return { first: 0, last: c.len }
    case 'circle':
    case 'ellipse':
      return { first: 0, last: 2 * Math.PI }
    case 'bezier':
      return { first: 0, last: 1 }
    case 'bspline':
      return { first: c.knots[0]!, last: c.knots[c.knots.length - 1]! }
    case 'trimmed':
      return { first: 0, last: 1 }
  }
}

/**
 * OCCT-style type name of a curve.
 * @param c - the curve to name.
 * @returns the uppercase OCCT type name such as `LINE`, `CIRCLE` or `BSPLINE_CURVE`.
 */
export function curveTypeName(c: Curve2dObj): string {
  switch (c.kind2d) {
    case 'line':
      return 'LINE'
    case 'circle':
      return 'CIRCLE'
    case 'ellipse':
      return 'ELLIPSE'
    case 'bezier':
      return 'BEZIER_CURVE'
    case 'bspline':
      return 'BSPLINE_CURVE'
    case 'trimmed':
      return 'TRIMMED_' + curveTypeName(c.basis)
  }
}

// ---------------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------------

/**
 * Line segment from (x1,y1) to (x2,y2).
 * @param x1 - the x coordinate of the start point.
 * @param y1 - the y coordinate of the start point.
 * @param x2 - the x coordinate of the end point.
 * @param y2 - the y coordinate of the end point.
 * @returns a Line2d describing the segment.
 */
export function makeLine2d(x1: number, y1: number, x2: number, y2: number): Line2d {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  return {
    kind2d: 'line',
    ox: x1,
    oy: y1,
    dx: len > 0 ? dx / len : 1,
    dy: len > 0 ? dy / len : 0,
    len,
  }
}

/**
 * Full circle with the given center, radius and winding sense.
 * @param cx - the x coordinate of the center.
 * @param cy - the y coordinate of the center.
 * @param radius - the circle radius.
 * @param sense - true for counter-clockwise winding (default true).
 * @returns a Circle2d.
 */
export function makeCircle2d(cx: number, cy: number, radius: number, sense: boolean = true): Circle2d {
  return { kind2d: 'circle', cx, cy, radius, sense }
}

/**
 * Arc through three points; returns a trimmed circle, or a line if collinear.
 * @param x1 - the x coordinate of the start point.
 * @param y1 - the y coordinate of the start point.
 * @param xm - the x coordinate of the mid point.
 * @param ym - the y coordinate of the mid point.
 * @param x2 - the x coordinate of the end point.
 * @param y2 - the y coordinate of the end point.
 * @returns a Curve2dObj: a trimmed arc circle, or a straight line when the points are collinear.
 */
export function makeArc2dThreePoints(
  x1: number,
  y1: number,
  xm: number,
  ym: number,
  x2: number,
  y2: number,
): Curve2dObj {
  // Circumscribed circle through 3 points
  const d = 2 * (x1 * (ym - y2) + xm * (y2 - y1) + x2 * (y1 - ym))
  if (Math.abs(d) < 1e-12) {
    // Degenerate (collinear): return a line
    return makeLine2d(x1, y1, x2, y2)
  }
  const cx =
    ((x1 * x1 + y1 * y1) * (ym - y2) +
      (xm * xm + ym * ym) * (y2 - y1) +
      (x2 * x2 + y2 * y2) * (y1 - ym)) /
    d
  const cy =
    ((x1 * x1 + y1 * y1) * (x2 - xm) +
      (xm * xm + ym * ym) * (x1 - x2) +
      (x2 * x2 + y2 * y2) * (xm - x1)) /
    d
  const radius = Math.sqrt((x1 - cx) ** 2 + (y1 - cy) ** 2)
  // Compute angles for start (p1), mid (pm), and end (p2)
  const a1 = Math.atan2(y1 - cy, x1 - cx)
  const am = Math.atan2(ym - cy, xm - cx)
  const a2 = Math.atan2(y2 - cy, x2 - cx)
  // Determine sense: CCW if mid-point angle is between start and end going CCW
  let da1m = am - a1
  if (da1m < 0) da1m += 2 * Math.PI
  let da12 = a2 - a1
  if (da12 < 0) da12 += 2 * Math.PI
  const sense = da1m < da12 // CCW if midpoint comes before endpoint
  const circle = makeCircle2d(cx, cy, radius, sense)
  if (!sense) {
    // CW circle evaluates angle = -t, so parameter t = -angle.
    const tStart = -a1
    let tEnd = -a2
    if (tEnd < tStart - 1e-9) tEnd += 2 * Math.PI
    return { kind2d: 'trimmed', basis: circle, tStart, tEnd }
  }
  // CCW: ensure tEnd >= tStart
  let tEnd = a2
  if (tEnd < a1 - 1e-9) tEnd += 2 * Math.PI
  return { kind2d: 'trimmed', basis: circle, tStart: a1, tEnd }
}

/**
 * Arc from a start point through a given tangent direction to an end point.
 * @param sx - the x coordinate of the start point.
 * @param sy - the y coordinate of the start point.
 * @param tx - the x component of the tangent direction at the start.
 * @param ty - the y component of the tangent direction at the start.
 * @param ex - the x coordinate of the end point.
 * @param ey - the y coordinate of the end point.
 * @returns a Curve2dObj: a trimmed circle arc, or a line when degenerate.
 */
export function makeArc2dTangent(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  ex: number,
  ey: number,
): Curve2dObj {
  const len = Math.sqrt(tx * tx + ty * ty)
  const ntx = len > 0 ? tx / len : 0
  const nty = len > 0 ? ty / len : 0
  const dx = sx - ex
  const dy = sy - ey
  const denom = 2 * (dy * ntx - dx * nty)
  if (Math.abs(denom) < 1e-12) {
    return makeLine2d(sx, sy, ex, ey)
  }
  const chord2 = dx * dx + dy * dy
  const t = -chord2 / denom
  const cx = sx - t * nty
  const cy = sy + t * ntx
  const radius = Math.abs(t)
  const a1 = Math.atan2(sy - cy, sx - cx)
  const a2 = Math.atan2(ey - cy, ex - cx)
  const ccwTanX = -(sy - cy) / radius
  const ccwTanY = (sx - cx) / radius
  const dotCcw = ntx * ccwTanX + nty * ccwTanY
  let aMid
  if (dotCcw > 0) {
    let da = a2 - a1
    if (da <= 0) da += 2 * Math.PI
    aMid = a1 + da / 2
  } else {
    let da = a2 - a1
    if (da >= 0) da -= 2 * Math.PI
    aMid = a1 + da / 2
  }
  const mx = cx + radius * Math.cos(aMid)
  const my = cy + radius * Math.sin(aMid)
  return makeArc2dThreePoints(sx, sy, mx, my, ex, ey)
}

/**
 * Ellipse with the given center, radii, major-axis direction and sense.
 * @param cx - the x coordinate of the center.
 * @param cy - the y coordinate of the center.
 * @param majorRadius - the semi-major radius.
 * @param minorRadius - the semi-minor radius.
 * @param xDirX - the x component of the major-axis direction (default 1).
 * @param xDirY - the y component of the major-axis direction (default 0).
 * @param sense - true for counter-clockwise winding (default true).
 * @returns an Ellipse2d.
 */
export function makeEllipse2d(
  cx: number,
  cy: number,
  majorRadius: number,
  minorRadius: number,
  xDirX: number = 1,
  xDirY: number = 0,
  sense: boolean = true,
): Ellipse2d {
  return {
    kind2d: 'ellipse',
    cx,
    cy,
    majorRadius,
    minorRadius,
    xDirAngle: Math.atan2(xDirY, xDirX),
    sense,
  }
}

/**
 * Bezier curve from control poles.
 * @param poles - the ordered control points `[x, y]` for the curve.
 * @returns a Bezier2d holding a copy of the poles.
 */
export function makeBezier2d(poles: [number, number][]): Bezier2d {
  return { kind2d: 'bezier', poles: [...poles] }
}

// ---------------------------------------------------------------------------
// Transform helpers
// ---------------------------------------------------------------------------

/**
 * Translate a curve by an offset.
 * @param c - the curve to translate.
 * @param dx - the x offset.
 * @param dy - the y offset.
 * @returns a new Curve2dObj translated by `(dx, dy)`.
 */
export function translateCurve2d(c: Curve2dObj, dx: number, dy: number): Curve2dObj {
  switch (c.kind2d) {
    case 'line':
      return { ...c, ox: c.ox + dx, oy: c.oy + dy }
    case 'circle':
      return { ...c, cx: c.cx + dx, cy: c.cy + dy }
    case 'ellipse':
      return { ...c, cx: c.cx + dx, cy: c.cy + dy }
    case 'bezier':
      return { ...c, poles: c.poles.map(([x, y]) => [x + dx, y + dy]) }
    case 'bspline':
      return { ...c, poles: c.poles.map(([x, y]) => [x + dx, y + dy]) }
    case 'trimmed':
      return { ...c, basis: translateCurve2d(c.basis, dx, dy) }
  }
}

/**
 * Rotate a curve by an angle about a center point.
 * @param c - the curve to rotate.
 * @param angle - the rotation angle in radians.
 * @param cx - the x coordinate of the rotation center.
 * @param cy - the y coordinate of the rotation center.
 * @returns a new Curve2dObj rotated by `angle` about `(cx, cy)`.
 */
export function rotateCurve2d(c: Curve2dObj, angle: number, cx: number, cy: number): Curve2dObj {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const rotatePoint = (x: number, y: number): [number, number] => {
    const rx = x - cx
    const ry = y - cy
    return [cx + rx * cos - ry * sin, cy + rx * sin + ry * cos]
  }
  switch (c.kind2d) {
    case 'line': {
      const [ox, oy] = rotatePoint(c.ox, c.oy)
      const ndx = c.dx * cos - c.dy * sin
      const ndy = c.dx * sin + c.dy * cos
      return { ...c, ox, oy, dx: ndx, dy: ndy }
    }
    case 'circle': {
      const [ncx, ncy] = rotatePoint(c.cx, c.cy)
      return { ...c, cx: ncx, cy: ncy }
    }
    case 'ellipse': {
      const [ncx, ncy] = rotatePoint(c.cx, c.cy)
      return { ...c, cx: ncx, cy: ncy, xDirAngle: c.xDirAngle + angle }
    }
    case 'bezier':
      return { ...c, poles: c.poles.map(([x, y]) => rotatePoint(x, y)) }
    case 'bspline':
      return { ...c, poles: c.poles.map(([x, y]) => rotatePoint(x, y)) }
    case 'trimmed': {
      const basis = rotateCurve2d(c.basis, angle, cx, cy)
      // A circle carries no frame angle, so its rotation must land in the
      // trim range: parameter IS the geometric angle (negated when
      // sense=false). Without this shift, rotating an arc about its own
      // circle center was a silent no-op.
      if (basis.kind2d === 'circle') {
        const shift = basis.sense ? angle : -angle
        return { ...c, basis, tStart: c.tStart + shift, tEnd: c.tEnd + shift }
      }
      return { ...c, basis }
    }
  }
}

/**
 * Scale a curve by a factor about a center point.
 * @param c - the curve to scale.
 * @param factor - the scale factor (may be negative to mirror-and-scale).
 * @param cx - the x coordinate of the scaling center.
 * @param cy - the y coordinate of the scaling center.
 * @returns a new Curve2dObj scaled by `factor` about `(cx, cy)`.
 */
export function scaleCurve2d(c: Curve2dObj, factor: number, cx: number, cy: number): Curve2dObj {
  const scalePoint = (x: number, y: number): [number, number] => [
    cx + (x - cx) * factor,
    cy + (y - cy) * factor,
  ]
  switch (c.kind2d) {
    case 'line': {
      // Scale BOTH endpoints and recompute direction/length (see brepjs notes:
      // scaling only origin left the endpoint wrong for factor != 1, most
      // damagingly for mirror factor=-1 which reflected the origin but kept the
      // original direction).
      const [ox, oy] = scalePoint(c.ox, c.oy)
      const [ex, ey] = scalePoint(c.ox + c.dx * c.len, c.oy + c.dy * c.len)
      const ndx = ex - ox
      const ndy = ey - oy
      const nlen = Math.sqrt(ndx * ndx + ndy * ndy)
      return {
        ...c,
        ox,
        oy,
        dx: nlen > 0 ? ndx / nlen : c.dx,
        dy: nlen > 0 ? ndy / nlen : c.dy,
        len: nlen,
      }
    }
    case 'circle': {
      const [ncx, ncy] = scalePoint(c.cx, c.cy)
      return { ...c, cx: ncx, cy: ncy, radius: c.radius * Math.abs(factor) }
    }
    case 'ellipse': {
      const [ncx, ncy] = scalePoint(c.cx, c.cy)
      return {
        ...c,
        cx: ncx,
        cy: ncy,
        majorRadius: c.majorRadius * Math.abs(factor),
        minorRadius: c.minorRadius * Math.abs(factor),
      }
    }
    case 'bezier':
      return { ...c, poles: c.poles.map(([x, y]) => scalePoint(x, y)) }
    case 'bspline':
      return { ...c, poles: c.poles.map(([x, y]) => scalePoint(x, y)) }
    case 'trimmed':
      return { ...c, basis: scaleCurve2d(c.basis, factor, cx, cy) }
  }
}

/**
 * Mirror a curve through a center point (a half-turn).
 * @param c - the curve to mirror.
 * @param cx - the x coordinate of the mirror center.
 * @param cy - the y coordinate of the mirror center.
 * @returns a new Curve2dObj rotated 180 degrees about `(cx, cy)`.
 */
export function mirrorAtPoint(c: Curve2dObj, cx: number, cy: number): Curve2dObj {
  // A point mirror IS a half-turn. Routing through rotate keeps every curve
  // type's parameterization exact: scale(-1) reflected conic centers but left
  // their angular parameterization behind.
  return rotateCurve2d(c, Math.PI, cx, cy)
}

/**
 * Mirror a curve across an axis defined by a point and a direction vector.
 * @param c - the curve to mirror.
 * @param ox - the x coordinate of a point on the mirror axis.
 * @param oy - the y coordinate of a point on the mirror axis.
 * @param dx - the x component of the axis direction vector.
 * @param dy - the y component of the axis direction vector.
 * @returns a new Curve2dObj reflected across the given axis.
 */
export function mirrorAcrossAxis(
  c: Curve2dObj,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
): Curve2dObj {
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1e-15) return c
  const nx = dx / len
  const ny = dy / len
  const reflectPoint = (x: number, y: number): [number, number] => {
    const rx = x - ox
    const ry = y - oy
    const dot = rx * nx + ry * ny
    return [ox + 2 * dot * nx - rx, oy + 2 * dot * ny - ry]
  }
  switch (c.kind2d) {
    case 'line': {
      const [nox, noy] = reflectPoint(c.ox, c.oy)
      const ndx = 2 * (c.dx * nx + c.dy * ny) * nx - c.dx
      const ndy = 2 * (c.dx * nx + c.dy * ny) * ny - c.dy
      return { ...c, ox: nox, oy: noy, dx: ndx, dy: ndy }
    }
    case 'circle': {
      const [ncx, ncy] = reflectPoint(c.cx, c.cy)
      return { ...c, cx: ncx, cy: ncy, sense: !c.sense }
    }
    case 'ellipse': {
      const [ncx, ncy] = reflectPoint(c.cx, c.cy)
      // Reflect the major-axis direction angle across the mirror axis
      const cos2 = nx * nx - ny * ny
      const sin2 = 2 * nx * ny
      const newAngle = Math.atan2(
        sin2 * Math.cos(c.xDirAngle) - cos2 * Math.sin(c.xDirAngle),
        cos2 * Math.cos(c.xDirAngle) + sin2 * Math.sin(c.xDirAngle),
      )
      return { ...c, cx: ncx, cy: ncy, xDirAngle: newAngle, sense: !c.sense }
    }
    case 'bezier':
      return { ...c, poles: c.poles.map(([x, y]) => reflectPoint(x, y)) }
    case 'bspline':
      return { ...c, poles: c.poles.map(([x, y]) => reflectPoint(x, y)) }
    case 'trimmed': {
      const basis = mirrorAcrossAxis(c.basis, ox, oy, dx, dy)
      // Reflection maps a circle's geometric angle theta to 2*phi - theta
      // (phi = axis angle). The sense flip on the basis absorbs the negation;
      // the 2*phi rotation has nowhere to live on a frameless circle, so it
      // lands in the trim range (sign follows the ORIGINAL sense).
      if (c.basis.kind2d === 'circle' && basis.kind2d === 'circle') {
        const phi = Math.atan2(ny, nx)
        const shift = c.basis.sense ? -2 * phi : 2 * phi
        return { ...c, basis, tStart: c.tStart + shift, tEnd: c.tEnd + shift }
      }
      return { ...c, basis }
    }
  }
}

// ---------------------------------------------------------------------------
// 2D curve–curve intersection
// ---------------------------------------------------------------------------
/**
 * Compute intersection points (and overlapping segments) between two 2D curves.
 * Handles analytic cases (line-line, line-circle, circle-circle) and falls back
 * to numerical sampling + Newton refinement for general curves.
 * @param c1 - the first curve.
 * @param c2 - the second curve.
 * @param tolerance - the geometric tolerance used for candidate filtering.
 * @returns the intersection points and any overlapping curve segments.
 */
export function intersectCurves2dFn(
  c1: Curve2dObj,
  c2: Curve2dObj,
  tolerance: number,
): { points: [number, number][]; segments: Curve2dObj[] } {
  const b1 = unwrapCurve(c1)
  const b2 = unwrapCurve(c2)
  // Analytic: line-line
  if (b1.kind2d === 'line' && b2.kind2d === 'line') {
    return intersectLineLine(c1, b1, c2, b2, tolerance)
  }
  // Analytic: line-circle / circle-line
  if (b1.kind2d === 'line' && b2.kind2d === 'circle') {
    return { points: intersectLineCircle(c1, b1, c2, b2, tolerance), segments: [] }
  }
  if (b1.kind2d === 'circle' && b2.kind2d === 'line') {
    return { points: intersectLineCircle(c2, b2, c1, b1, tolerance), segments: [] }
  }
  // Analytic: circle-circle
  if (b1.kind2d === 'circle' && b2.kind2d === 'circle') {
    return { points: intersectCircleCircle(c1, b1, c2, b2, tolerance), segments: [] }
  }
  // General: numerical (with self-intersection handling)
  const isSelf = c1 === c2
  return numericalIntersect(c1, c2, tolerance, isSelf)
}

/**
 * Serialize a curve (JSON round-trip).
 * @param c - the curve to serialize.
 * @returns the curve as a JSON string.
 */
export function serializeCurve2d(c: Curve2dObj): string {
  return JSON.stringify(c)
}
/**
 * Deserialize a curve previously produced by {@link serializeCurve2d}.
 * @param data - the JSON string describing the curve.
 * @returns the reconstructed Curve2dObj.
 */
export function deserializeCurve2d(data: string): Curve2dObj {
  return JSON.parse(data)
}

// ---------------------------------------------------------------------------
// BBox helpers
// ---------------------------------------------------------------------------

/**
 * Create an empty (inverted) curve bounding box.
 * @returns a fresh CurveBBox2d whose mins are +Infinity and maxes are -Infinity.
 */
export function createCurveBBox2d(): CurveBBox2d {
  return { kind2d_b: true, xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity }
}

/**
 * Expand a curve bounding box to include a curve's extent.
 * Uses analytic extremes for lines and circles/arcs and sampling otherwise.
 * @param bbox - the box to expand in place.
 * @param c - the curve whose extent is incorporated.
 * @param _tol - reserved tolerance parameter (unused).
 */
export function addCurveToBBox(bbox: CurveBBox2d, c: Curve2dObj, _tol: number): void {
  const basis = c.kind2d === 'trimmed' ? c.basis : c
  // Analytic: lines need only 2 endpoints (no sampling)
  if (basis.kind2d === 'line') {
    const bounds = curveBounds(c)
    if (!isFinite(bounds.first) || !isFinite(bounds.last)) return
    const [x0, y0] = evaluateCurve2d(c, bounds.first)
    const [x1, y1] = evaluateCurve2d(c, bounds.last)
    bbox.xMin = Math.min(bbox.xMin, x0, x1)
    bbox.yMin = Math.min(bbox.yMin, y0, y1)
    bbox.xMax = Math.max(bbox.xMax, x0, x1)
    bbox.yMax = Math.max(bbox.yMax, y0, y1)
    return
  }
  // Analytic: circles/arcs — endpoints + axis extremes
  if (basis.kind2d === 'circle') {
    const bounds = curveBounds(c)
    if (!isFinite(bounds.first) || !isFinite(bounds.last)) return
    const { cx, cy, radius, sense } = basis
    const [x0, y0] = evaluateCurve2d(c, bounds.first)
    const [x1, y1] = evaluateCurve2d(c, bounds.last)
    let xMin = Math.min(x0, x1)
    let xMax = Math.max(x0, x1)
    let yMin = Math.min(y0, y1)
    let yMax = Math.max(y0, y1)
    // Check axis-aligned extreme angles within the arc's parameter range
    const tStart = c.kind2d === 'trimmed' ? c.tStart : bounds.first
    const tEnd = c.kind2d === 'trimmed' ? c.tEnd : bounds.last
    for (let k = 0; k < 4; k++) {
      const angle = (k * Math.PI) / 2
      const t = sense ? angle : -angle
      // Check if t (or t + 2π) falls within [tStart, tEnd]
      for (let wrap = 0; wrap <= 1; wrap++) {
        const tt = t + wrap * 2 * Math.PI
        if (tt >= tStart - 1e-10 && tt <= tEnd + 1e-10) {
          const ex = cx + radius * Math.cos(angle)
          const ey = cy + radius * Math.sin(angle)
          xMin = Math.min(xMin, ex)
          xMax = Math.max(xMax, ex)
          yMin = Math.min(yMin, ey)
          yMax = Math.max(yMax, ey)
          break
        }
      }
    }
    bbox.xMin = Math.min(bbox.xMin, xMin)
    bbox.yMin = Math.min(bbox.yMin, yMin)
    bbox.xMax = Math.max(bbox.xMax, xMax)
    bbox.yMax = Math.max(bbox.yMax, yMax)
    return
  }
  // General: sample (bezier, bspline, ellipse)
  const bounds = curveBounds(c)
  if (!isFinite(bounds.first) || !isFinite(bounds.last)) return
  const nSamples = 20
  const dt = (bounds.last - bounds.first) / nSamples
  for (let i = 0; i <= nSamples; i++) {
    const t = bounds.first + i * dt
    const [x, y] = evaluateCurve2d(c, t)
    if (x < bbox.xMin) bbox.xMin = x
    if (y < bbox.yMin) bbox.yMin = y
    if (x > bbox.xMax) bbox.xMax = x
    if (y > bbox.yMax) bbox.yMax = y
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Unwrap trimmed wrappers to get the basis curve type. */
function unwrapCurve(c: Curve2dObj): Curve2dObj {
  let cur = c
  while (cur.kind2d === 'trimmed') cur = cur.basis
  return cur
}

/** Check if parameter t is within the curve's domain. */
function inDomain(c: Curve2dObj, t: number, tol: number): boolean {
  const b = curveBounds(c)
  return t >= b.first - tol && t <= b.last + tol
}

/** Find parameter on curve c closest to point (px, py), searching near tGuess. */
function refineParam(c: Curve2dObj, px: number, py: number, maxRatio = 0.1): number | null {
  const bounds = curveBounds(c)
  if (!isFinite(bounds.first) || !isFinite(bounds.last)) return null
  const N = 80
  const dt = (bounds.last - bounds.first) / N
  let bestT = bounds.first
  let bestD = Infinity
  for (let i = 0; i <= N; i++) {
    const t = bounds.first + i * dt
    const [ex, ey] = evaluateCurve2d(c, t)
    const d = (ex - px) ** 2 + (ey - py) ** 2
    if (d < bestD) {
      bestD = d
      bestT = t
    }
  }
  // bestD is squared geometric distance. Derive a scale-relative threshold
  // from the curve's geometric extent (not parameter span).
  const [sx, sy] = evaluateCurve2d(c, bounds.first)
  const [ex, ey] = evaluateCurve2d(c, bounds.last)
  const [mx, my] = evaluateCurve2d(c, (bounds.first + bounds.last) / 2)
  const geomExtent = Math.max(
    Math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2),
    Math.sqrt((mx - sx) ** 2 + (my - sy) ** 2),
    1e-6,
  )
  const maxDist = geomExtent * maxRatio
  return bestD < maxDist * maxDist ? bestT : null
}

/**
 * Parameter on a curve closest to a point.
 *
 * This is the general "point → parameter" primitive used by corner/offset work:
 * it searches the curve's domain for the parameter whose evaluated point is
 * nearest to `(px, py)` and returns it when that nearest distance is within a
 * configurable fraction of the curve's geometric extent. Returns `null` when the
 * point lies too far off the curve (the raw gap-vs-extent guard) so callers can
 * distinguish "on/very near the curve" from "clearly off".
 *
 * @param c - the curve to search (line, arc, ellipse, bezier, bspline, trimmed).
 * @param px - the query point x.
 * @param py - the query point y.
 * @param maxRatio - the maximum acceptable nearest-distance / geometric-extent
 *   ratio (default 0.1; raise it to accept points that sit further off the curve).
 * @returns the domain parameter `t`, or `null` when `(px, py)` is off-curve by
 *   more than `maxRatio` of the curve's geometric extent.
 */
export function parameterOfPoint(c: Curve2dObj, px: number, py: number, maxRatio = 0.1): number | null {
  const bounds = curveBounds(c)
  if (!isFinite(bounds.first) || !isFinite(bounds.last)) return null

  // Coarse sample to get within one domain step of the nearest point (semantics,
  // curvature, and per-kernel sensitivity: `refineParam`'s N=80 grid).
  const seed = refineParam(c, px, py, maxRatio)
  if (seed === null) return null

  // Refine to the projection foot: for the farthest/nearest parameter the chord
  // `(curve(t) − P)` is perpendicular to the tangent, i.e. g(t)=dot(·)=0. Solve
  // g(t)=0 with Newton on a central-difference derivative.
  const span = bounds.last - bounds.first
  const hbase = span * 1e-6
  let t = seed
  const fixed = new Set<string>()
  for (let i = 0; i < 24; i++) {
    const [ex, ey] = evaluateCurve2d(c, t)
    const [tx, ty] = tangentCurve2d(c, t)
    const g = (ex - px) * tx + (ey - py) * ty
    if (Math.abs(g) < 1e-12) break
    const h = Math.max(hbase, 1e-9)
    const [hx, hy] = evaluateCurve2d(c, Math.min(bounds.last, t + h))
    const [hT, hTy] = tangentCurve2d(c, Math.min(bounds.last, t + h))
    const gp = ((hx - px) * hT + (hy - py) * hTy - g) / h
    if (Math.abs(gp) < 1e-16) break
    const tn = t - g / gp
    t = Math.max(bounds.first, Math.min(bounds.last, tn))
    const key = t.toFixed(12)
    if (fixed.has(key)) break
    fixed.add(key)
    if (okConverge(c, px, py, t)) break
  }
  return t
}

/** True when `(px, py)` is within `1e-9` of the curve at parameter `t`. */
function okConverge(c: Curve2dObj, px: number, py: number, t: number): boolean {
  const [ex, ey] = evaluateCurve2d(c, t)
  return Math.hypot(ex - px, ey - py) < 1e-9
}

/** The unwrapped basis curve (strips any nesting of `trimmed` wrappers). */
function basisOf(c: Curve2dObj): Curve2dObj {
  let b = c
  while (b.kind2d === 'trimmed') b = b.basis
  return b
}

/**
 * Trim a curve to a sub-parameter range given in the basis curve's native domain.
 *
 * The returned `trimmed` curve keeps the full basis; its `t∈[0,1]` domain maps
 * into `[tStart, tEnd]` of the basis (so it is the inverse of `curveBounds` for
 * trimmed curves). Parameters are in the basis's native domain (a line: distance
 * along `[0,len]`; an arc/ellipse: angle `[.., ..]`).
 *
 * @param c - the curve to trim (may itself be already-trimmed; the basis is reused).
 * @param tStart - the basis-domain parameter where the sub-curve starts.
 * @param tEnd - the basis-domain parameter where the sub-curve ends.
 * @returns the trimmed `Curve2dObj`.
 */
export function trimCurve(c: Curve2dObj, tStart: number, tEnd: number): Curve2dObj {
  return { kind2d: 'trimmed', basis: basisOf(c), tStart, tEnd }
}

/**
 * Split a curve at a native-domain parameter into two trimmed sub-curves.
 *
 * This is the splice primitive that D1 boolean-splitting and D3 corner
 * (fillet/chamfer) use: it cuts a single curve at an interior parameter into
 * two `TrimmedCurve2d` sharing the same basis, covering `[first, t]` and
 * `[t, last]`. Returns `null` when `t` is not strictly interior.
 *
 * @param c - the curve to split.
 * @param t - the native-domain split parameter (strictly inside the basis domain).
 * @returns the two sub-curves, or `null` when `t` is outside the interior.
 */
export function splitCurveAt(c: Curve2dObj, t: number): [Curve2dObj, Curve2dObj] | null {
  const basis = basisOf(c)
  const { first, last } = curveBounds(basis)
  if (t <= first || t >= last) return null
  return [trimCurve(basis, first, t), trimCurve(basis, t, last)]
}

function intersectLineLine(
  c1: Curve2dObj,
  l1: Line2d,
  c2: Curve2dObj,
  l2: Line2d,
  tol: number,
): { points: [number, number][]; segments: Curve2dObj[] } {
  const det = l1.dx * l2.dy - l1.dy * l2.dx
  if (Math.abs(det) >= 1e-14) {
    // Non-parallel: solve for intersection
    const ex = l2.ox - l1.ox
    const ey = l2.oy - l1.oy
    const t1 = (ex * l2.dy - ey * l2.dx) / det
    const t2 = (ex * l1.dy - ey * l1.dx) / det
    if (!inDomain(c1, t1, tol) || !inDomain(c2, t2, tol)) return { points: [], segments: [] }
    return { points: [[l1.ox + t1 * l1.dx, l1.oy + t1 * l1.dy]], segments: [] }
  }
  // Parallel — check if collinear and overlapping
  const ex = l2.ox - l1.ox
  const ey = l2.oy - l1.oy
  const cross = ex * l1.dy - ey * l1.dx
  if (Math.abs(cross) > tol) return { points: [], segments: [] } // parallel but not collinear
  // Project c2 endpoints onto c1's parameter space
  const b1 = curveBounds(c1)
  const b2 = curveBounds(c2)
  const p2s = evaluateCurve2d(c2, b2.first)
  const p2e = evaluateCurve2d(c2, b2.last)
  const t2sOn1 = (p2s[0] - l1.ox) * l1.dx + (p2s[1] - l1.oy) * l1.dy
  const t2eOn1 = (p2e[0] - l1.ox) * l1.dx + (p2e[1] - l1.oy) * l1.dy
  const overlapStart = Math.max(b1.first, Math.min(t2sOn1, t2eOn1))
  const overlapEnd = Math.min(b1.last, Math.max(t2sOn1, t2eOn1))
  if (overlapEnd - overlapStart < tol) return { points: [], segments: [] } // no meaningful overlap
  const sx = l1.ox + overlapStart * l1.dx
  const sy = l1.oy + overlapStart * l1.dy
  const ex2 = l1.ox + overlapEnd * l1.dx
  const ey2 = l1.oy + overlapEnd * l1.dy
  const seg = makeLine2d(sx, sy, ex2, ey2)
  return { points: [], segments: [seg] }
}

function intersectLineCircle(
  cLine: Curve2dObj,
  line: Line2d,
  cCirc: Curve2dObj,
  circ: Circle2d,
  tol: number,
): [number, number][] {
  // Vector from circle center to line origin
  const fx = line.ox - circ.cx
  const fy = line.oy - circ.cy
  // Quadratic: |f + t*d|^2 = r^2
  const a = line.dx * line.dx + line.dy * line.dy // = 1 for normalized
  const b = 2 * (fx * line.dx + fy * line.dy)
  const c = fx * fx + fy * fy - circ.radius * circ.radius
  const disc = b * b - 4 * a * c
  if (disc < -tol) return []
  const results: [number, number][] = []
  const sqrtDisc = Math.sqrt(Math.max(0, disc))
  const t1 = (-b - sqrtDisc) / (2 * a)
  const t2 = (-b + sqrtDisc) / (2 * a)
  for (const tLine of disc < tol * tol ? [t1] : [t1, t2]) {
    if (!inDomain(cLine, tLine, tol)) continue
    const px = line.ox + tLine * line.dx
    const py = line.oy + tLine * line.dy
    // Check that the point is in the circle's domain
    const tCirc = refineParam(cCirc, px, py)
    if (tCirc === null) continue
    const [cx2, cy2] = evaluateCurve2d(cCirc, tCirc)
    if ((cx2 - px) ** 2 + (cy2 - py) ** 2 > tol * tol * 1e6) continue
    results.push([px, py])
  }
  return results
}

function intersectConcentricArcs(c1: Curve2dObj, c2: Curve2dObj, tol: number): [number, number][] {
  const b1 = curveBounds(c1)
  const b2 = curveBounds(c2)
  const isFullCircle1 = Math.abs(b1.last - b1.first - 2 * Math.PI) < 1e-10
  const isFullCircle2 = Math.abs(b2.last - b2.first - 2 * Math.PI) < 1e-10
  if (isFullCircle1 && isFullCircle2) return []
  if (isFullCircle1) {
    return [evaluateCurve2d(c2, b2.first), evaluateCurve2d(c2, b2.last)]
  }
  if (isFullCircle2) {
    return [evaluateCurve2d(c1, b1.first), evaluateCurve2d(c1, b1.last)]
  }
  const pts: [number, number][] = []
  const checks: [Curve2dObj, [number, number]][] = [
    [c2, evaluateCurve2d(c1, b1.first)],
    [c2, evaluateCurve2d(c1, b1.last)],
    [c1, evaluateCurve2d(c2, b2.first)],
    [c1, evaluateCurve2d(c2, b2.last)],
  ]
  for (const [target, pt] of checks) {
    const t = refineParam(target, pt[0], pt[1])
    if (t !== null) {
      const [ex, ey] = evaluateCurve2d(target, t)
      if ((ex - pt[0]) ** 2 + (ey - pt[1]) ** 2 < tol * tol * 100) pts.push(pt)
    }
  }
  const deduped: [number, number][] = []
  for (const p of pts) {
    if (!deduped.some(([ddx, ddy]) => (ddx - p[0]) ** 2 + (ddy - p[1]) ** 2 < tol * tol * 100)) {
      deduped.push(p)
    }
  }
  return deduped
}

function intersectCircleCircle(
  c1: Curve2dObj,
  circ1: Circle2d,
  c2: Curve2dObj,
  circ2: Circle2d,
  tol: number,
): [number, number][] {
  const dx = circ2.cx - circ1.cx
  const dy = circ2.cy - circ1.cy
  const d = Math.sqrt(dx * dx + dy * dy)
  if (d > circ1.radius + circ2.radius + tol) return []
  if (d < Math.abs(circ1.radius - circ2.radius) - tol) return []
  if (d < 1e-14) {
    if (Math.abs(circ1.radius - circ2.radius) > tol) return []
    return intersectConcentricArcs(c1, c2, tol)
  }
  const a = (circ1.radius * circ1.radius - circ2.radius * circ2.radius + d * d) / (2 * d)
  const h2 = circ1.radius * circ1.radius - a * a
  const h = Math.sqrt(Math.max(0, h2))
  const mx = circ1.cx + (a * dx) / d
  const my = circ1.cy + (a * dy) / d
  const candidates: [number, number][] =
    h < tol
      ? [[mx, my]]
      : [
          [mx + (h * dy) / d, my - (h * dx) / d],
          [mx - (h * dy) / d, my + (h * dx) / d],
        ]
  // Filter candidates that lie within both curves' domains
  const results: [number, number][] = []
  for (const [px, py] of candidates) {
    const t1 = refineParam(c1, px, py)
    const t2 = refineParam(c2, px, py)
    if (t1 === null || t2 === null) continue
    const [x1, y1] = evaluateCurve2d(c1, t1)
    const [x2, y2] = evaluateCurve2d(c2, t2)
    const tolSq = (tol * 10) ** 2
    if ((x1 - px) ** 2 + (y1 - py) ** 2 > tolSq) continue
    if ((x2 - px) ** 2 + (y2 - py) ** 2 > tolSq) continue
    results.push([px, py])
  }
  return results
}

/**
 * Numerical intersection via sampling + Newton refinement.
 * Samples both curves densely, finds close point pairs, refines with Newton.
 */
function numericalIntersect(
  c1: Curve2dObj,
  c2: Curve2dObj,
  tolerance: number,
  isSelf = false,
): { points: [number, number][]; segments: Curve2dObj[] } {
  const b1 = curveBounds(c1)
  const b2 = curveBounds(c2)
  if (!isFinite(b1.first) || !isFinite(b1.last) || !isFinite(b2.first) || !isFinite(b2.last)) {
    return { points: [], segments: [] }
  }
  const N = 100
  const pts1: { t: number; x: number; y: number }[] = []
  const pts2: { t: number; x: number; y: number }[] = []
  for (let i = 0; i <= N; i++) {
    const t1 = b1.first + ((b1.last - b1.first) * i) / N
    const [x1, y1] = evaluateCurve2d(c1, t1)
    pts1.push({ t: t1, x: x1, y: y1 })
    const t2 = b2.first + ((b2.last - b2.first) * i) / N
    const [x2, y2] = evaluateCurve2d(c2, t2)
    pts2.push({ t: t2, x: x2, y: y2 })
  }
  // Pre-compute segment bounds for curve2 (avoids recomputing N times in inner loop)
  const crossTol = Math.max(tolerance * 100, 0.5)
  const seg2Bounds = new Float64Array(N * 6) // xmin, xmax, ymin, ymax, tmid, _pad
  for (let j = 0; j < N; j++) {
    const a = pts2[j]!
    const b = pts2[j + 1]!
    const off = j * 6
    seg2Bounds[off] = Math.min(a.x, b.x)
    seg2Bounds[off + 1] = Math.max(a.x, b.x)
    seg2Bounds[off + 2] = Math.min(a.y, b.y)
    seg2Bounds[off + 3] = Math.max(a.y, b.y)
    seg2Bounds[off + 4] = (a.t + b.t) / 2
  }
  // Find segment pairs where the curves are close
  const candidates: { t1: number; t2: number }[] = []
  const selfMinSep = (b1.last - b1.first) / 5
  for (let i = 0; i < N; i++) {
    const p1a = pts1[i]!
    const p1b = pts1[i + 1]!
    // Hoist outer segment AABB (computed once per outer iteration)
    const x1min = Math.min(p1a.x, p1b.x) - crossTol
    const x1max = Math.max(p1a.x, p1b.x) + crossTol
    const y1min = Math.min(p1a.y, p1b.y) - crossTol
    const y1max = Math.max(p1a.y, p1b.y) + crossTol
    const t1mid = (p1a.t + p1b.t) / 2
    for (let j = 0; j < N; j++) {
      const off = j * 6
      if (x1max < seg2Bounds[off] || seg2Bounds[off + 1] < x1min) continue
      if (y1max < seg2Bounds[off + 2] || seg2Bounds[off + 3] < y1min) continue
      const t2mid = seg2Bounds[off + 4]
      if (isSelf && Math.abs(t1mid - t2mid) < selfMinSep) continue
      candidates.push({ t1: t1mid, t2: t2mid })
    }
  }
  // Refine candidates via Newton iteration
  const tol2 = tolerance * tolerance
  const found: [number, number][] = []
  for (const { t1: t1Init, t2: t2Init } of candidates) {
    let t1 = t1Init
    let t2 = t2Init
    for (let iter = 0; iter < 20; iter++) {
      const [x1, y1] = evaluateCurve2d(c1, t1)
      const [x2, y2] = evaluateCurve2d(c2, t2)
      const dx = x1 - x2
      const dy = y1 - y2
      if (dx * dx + dy * dy < tol2) break
      const d1 = tangentCurve2d(c1, t1)
      const d2 = tangentCurve2d(c2, t2)
      // Newton system: J * [dt1, dt2]^T = -[dx, dy]
      const det = d1[0] * -d2[1] - -d2[0] * d1[1]
      if (Math.abs(det) < 1e-14) break
      const dt1 = (-dx * -d2[1] - -dy * -d2[0]) / det
      const dt2 = (d1[0] * -dy - d1[1] * -dx) / det
      t1 += dt1
      t2 += dt2
      t1 = Math.max(b1.first, Math.min(b1.last, t1))
      t2 = Math.max(b2.first, Math.min(b2.last, t2))
    }
    const [x1, y1] = evaluateCurve2d(c1, t1)
    const [x2, y2] = evaluateCurve2d(c2, t2)
    // For self-intersection, only accept points with well-separated params
    if (isSelf && Math.abs(t1 - t2) < (b1.last - b1.first) * 0.05) continue
    if ((x1 - x2) ** 2 + (y1 - y2) ** 2 < tolerance * tolerance * 1e6) {
      const px = (x1 + x2) / 2
      const py = (y1 + y2) / 2
      let dup = false
      for (const [fx, fy] of found) {
        if ((fx - px) ** 2 + (fy - py) ** 2 < tolerance * tolerance * 1e4) {
          dup = true
          break
        }
      }
      if (!dup) found.push([px, py])
    }
  }
  return { points: found, segments: [] }
}

// ---------------------------------------------------------------------------
// Private curve evaluators
// ---------------------------------------------------------------------------

function evaluateBezier(poles: [number, number][], t: number): [number, number] {
  // De Casteljau
  const n = poles.length
  const work: [number, number][] = poles.map(([x, y]) => [x, y])
  for (let r = 1; r < n; r++) {
    for (let i = 0; i < n - r; i++) {
      const wi = work[i]!
      const wi1 = work[i + 1]!
      wi[0] = (1 - t) * wi[0] + t * wi1[0]
      wi[1] = (1 - t) * wi[1] + t * wi1[1]
    }
  }
  return work[0]!
}

function evaluateBSpline2d(c: BSpline2d, t: number): [number, number] {
  // Expand knots with multiplicities
  const fullKnots: number[] = []
  for (let i = 0; i < c.knots.length; i++) {
    const mult = c.multiplicities[i] ?? 1
    for (let j = 0; j < mult; j++) {
      fullKnots.push(c.knots[i]!)
    }
  }
  // De Boor evaluation
  const p = c.degree
  const n = c.poles.length
  const k = fullKnots.length
  const tClamped = Math.max(fullKnots[p]!, Math.min(fullKnots[k - p - 1]!, t))
  // Find span
  let span = p
  for (let i = p; i < k - p - 1; i++) {
    if (tClamped >= fullKnots[i]! && tClamped < fullKnots[i + 1]!) {
      span = i
      break
    }
  }
  if (tClamped >= fullKnots[k - p - 1]!) span = k - p - 2
  // Extract relevant control points
  const d: [number, number][] = []
  for (let j = 0; j <= p; j++) {
    const idx = Math.min(span - p + j, n - 1)
    const pole = c.poles[Math.max(0, idx)]!
    d.push([pole[0], pole[1]])
  }
  // De Boor recursion
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = span - p + j
      const left = fullKnots[i] ?? 0
      const right = fullKnots[i + p - r + 1] ?? 1
      const denom = right - left
      const alpha = denom > 1e-15 ? (tClamped - left) / denom : 0
      const dj = d[j]!
      const djPrev = d[j - 1]!
      dj[0] = (1 - alpha) * djPrev[0] + alpha * dj[0]
      dj[1] = (1 - alpha) * djPrev[1] + alpha * dj[1]
    }
  }
  return d[p]!
}