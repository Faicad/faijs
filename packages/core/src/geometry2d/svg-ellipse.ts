/**
 * geometry2d — SVG-style elliptical arc construction (SVG endpoint form).
 *
 * Ported from brepjs `2d/blueprints/ellipseUtils.ts` (Apache-2.0). Adapts the
 * SVG F.6.5/F.6.6 endpoint→center conversion onto the pure `Curve2dObj` base:
 * the resulting elliptical arc is a `TrimmedCurve2d` over an `Ellipse2d`, whose
 * parameter is the sweep angle in radians (CCW positive).
 *
 * @module
 */

import { makeEllipse2d, type Curve2dObj } from './curve2d'
import { normalize2d } from './point'

const DEG2RAD = Math.PI / 180
const TWO_PI = Math.PI * 2

/** A `[x, y]` 2D point. */
type Pt = [number, number]

function bug(caller: string, message: string): never {
  throw new Error(`[geometry2d/svg-ellipse] ${caller}: ${message}`)
}

/** Rotate a 2D point by `rad` radians. */
function rotate2d([x, y]: Pt, rad: number): Pt {
  return [x * Math.cos(rad) - y * Math.sin(rad), x * Math.sin(rad) + y * Math.cos(rad)]
}

/** Signed angle from `[ux,uy]` to `[vx,vy]` in `[−π, π]`. */
function radianAngle(ux: number, uy: number, vx: number, vy: number): number {
  const dot = ux * vx + uy * vy
  const mod = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy))
  if (mod < 1e-12) bug('radianAngle', 'Cannot compute angle between zero-length vectors')
  let rad = Math.acos(Math.max(-1, Math.min(1, dot / mod)))
  if (ux * vy - uy * vx < 0) rad = -rad
  return rad
}

/**
 * Compute arc start/end angles from the unit-circle parameterization (SVG F6.5.5).
 * @param xcr1 - first unit-circle x.
 * @param ycr1 - first unit-circle y.
 * @param xcr2 - second unit-circle x.
 * @param ycr2 - second unit-circle y.
 * @param fS - sweep flag.
 * @returns the `{ startAngle, endAngle }` pair (radians).
 */
function computeArcAngles(xcr1: number, ycr1: number, xcr2: number, ycr2: number, fS: boolean): { startAngle: number; endAngle: number } {
  const startAngle = radianAngle(1, 0, xcr1, ycr1)
  let deltaAngle = radianAngle(xcr1, ycr1, -xcr2, -ycr2)
  while (deltaAngle > TWO_PI) deltaAngle -= TWO_PI
  while (deltaAngle < 0) deltaAngle += TWO_PI
  if (!fS) deltaAngle -= TWO_PI
  let endAngle = startAngle + deltaAngle
  while (endAngle > TWO_PI) endAngle -= TWO_PI
  while (endAngle < 0) endAngle += TWO_PI
  return { startAngle, endAngle }
}

/**
 * Normalize ellipse radii so the major axis is horizontal, adjusting rotation.
 * @param horizontalRadius - the radius along the SVG x-axis.
 * @param verticalRadius - the radius along the SVG y-axis.
 * @param rotation - rotation in degrees.
 * @returns the normalized radius set.
 */
export function normalizeEllipseRadii(
  horizontalRadius: number,
  verticalRadius: number,
  rotation: number,
): { majorRadius: number; minorRadius: number; rotationAngle: number } {
  if (horizontalRadius < verticalRadius) {
    return { majorRadius: verticalRadius, minorRadius: horizontalRadius, rotationAngle: rotation + 90 }
  }
  return { majorRadius: horizontalRadius, minorRadius: verticalRadius, rotationAngle: rotation }
}

/**
 * Convert SVG elliptical-arc endpoint parameters to the centerly parametrization
 * (SVG F6.5.1–F6.5.6).
 * @param x1 - start x.
 * @param y1 - start y.
 * @param x2 - end x.
 * @param y2 - end y.
 * @param rx - x radius.
 * @param ry - y radius.
 * @param phi - rotation angle (radians).
 * @param fA - large-arc flag.
 * @param fS - sweep flag.
 * @returns the center, radii and angular parametrization.
 */
export function convertSvgEllipseParams(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rx: number,
  ry: number,
  phi: number,
  fA: boolean,
  fS: boolean,
): { cx: number; cy: number; startAngle: number; endAngle: number; clockwise: boolean; rx: number; ry: number } {
  if (rx < 0) rx = -rx
  if (ry < 0) ry = -ry
  if (rx < 1e-10 || ry < 1e-10) bug('convertSvgEllipseParams', 'rx and ry cannot be 0')
  const s_phi = Math.sin(phi)
  const c_phi = Math.cos(phi)
  const hd_x = (x1 - x2) / 2
  const hd_y = (y1 - y2) / 2
  const hs_x = (x1 + x2) / 2
  const hs_y = (y1 + y2) / 2
  // F6.5.1: transform to (x', y')
  const x1_ = c_phi * hd_x + s_phi * hd_y
  const y1_ = c_phi * hd_y - s_phi * hd_x
  // F.6.6: correct out-of-range radii
  const lambda = (x1_ * x1_) / (rx * rx) + (y1_ * y1_) / (ry * ry)
  if (lambda > 1) {
    rx = rx * Math.sqrt(lambda)
    ry = ry * Math.sqrt(lambda)
  }
  const rxry = rx * ry
  const rxy1_ = rx * y1_
  const ryx1_ = ry * x1_
  const sum_of_sq = rxy1_ * rxy1_ + ryx1_ * ryx1_
  if (!sum_of_sq) bug('convertSvgEllipseParams', 'Start point cannot be the same as end point')
  let coe = Math.sqrt(Math.abs((rxry * rxry - sum_of_sq) / sum_of_sq))
  if (fA === fS) coe = -coe
  const cx_ = (coe * rxy1_) / ry
  const cy_ = (-coe * ryx1_) / rx
  // F6.5.3: back-transform to absolute center
  const cx = c_phi * cx_ - s_phi * cy_ + hs_x
  const cy = s_phi * cx_ + c_phi * cy_ + hs_y
  const { startAngle, endAngle } = computeArcAngles((x1_ - cx_) / rx, (y1_ - cy_) / ry, (x1_ + cx_) / rx, (y1_ + cy_) / ry, fS)
  return { cx, cy, startAngle, endAngle, clockwise: fS, rx, ry }
}

/**
 * Build an elliptical arc `Curve2dObj` from SVG endpoint parameters.
 * @param startUV - the start point.
 * @param endUV - the end point.
 * @param majorRadius - the major radius.
 * @param minorRadius - the minor radius.
 * @param rotationAngleDeg - rotation in degrees.
 * @param longAxis - SVG large-arc flag.
 * @param sweep - SVG sweep flag.
 * @returns a trimmed elliptical arc.
 */
export function makeEllipseArcFromSvgParams(
  startUV: Pt,
  endUV: Pt,
  majorRadius: number,
  minorRadius: number,
  rotationAngleDeg: number,
  longAxis: boolean,
  sweep: boolean,
): Curve2dObj {
  const radRotation = rotationAngleDeg * DEG2RAD
  const xDir = normalize2d(rotate2d([1, 0], radRotation))
  const phi = Math.atan2(xDir[1], xDir[0])
  const { majorRadius: maAxis, minorRadius: miAxis } = normalizeEllipseRadii(majorRadius, minorRadius, rotationAngleDeg)
  const { cx, cy, startAngle, endAngle, clockwise, rx, ry } = convertSvgEllipseParams(
    startUV[0], startUV[1], endUV[0], endUV[1], maAxis, miAxis, phi, longAxis, sweep,
  )
  return makeEllipseArcFromCenter(rx, ry, startAngle, endAngle, [cx, cy], xDir, clockwise)
}

/**
 * Build an elliptical arc as a trimmed ellipse over an angle range.
 * @param rx - x radius.
 * @param ry - y radius.
 * @param startAngle - start angle (radians, ellipse-param space).
 * @param endAngle - end angle (radians).
 * @param center - the ellipse center.
 * @param xDir - the in-plane X axis of the ellipse.
 * @param clockwise - sweep direction.
 * @returns a trimmed elliptical arc.
 */
export function makeEllipseArcFromCenter(
  rx: number,
  ry: number,
  startAngle: number,
  endAngle: number,
  center: Pt,
  xDir: Pt,
  clockwise: boolean,
): Curve2dObj {
  const sense = !clockwise
  const aStart = sense ? startAngle : -startAngle
  let aEnd = sense ? endAngle : -endAngle
  if (aEnd < aStart - 1e-9) aEnd += TWO_PI
  const ellipse = makeEllipse2d(center[0], center[1], rx, ry, xDir[0], xDir[1], sense)
  return { kind2d: 'trimmed', basis: ellipse, tStart: aStart, tEnd: aEnd }
}