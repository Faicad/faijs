/**
 * drawing-factories — the `draw` package's primitive shape factories (C3).
 *
 * Each factory returns a closed `Blueprint` (a placed contour) ready to flow
 * through core's placement pipeline (`sketchOnPlane`) into a 3D feature. They
 * build on the core `geometry2d` pure base only.
 *
 * @module
 */

import {
  makeCircle2d,
  Blueprint,
  polysidesBlueprint,
  roundedRectangleBlueprint,
  type Point2,
} from '@faicad/faijs/geometry2d'

/**
 * The polygon factory — a regular polygon inscribed in a circle.
 * @param radius - circumscribed circle radius.
 * @param sides - number of sides.
 * @param sagitta - optional sagitta (bulged sides).
 * @returns the polygon Blueprint.
 */
export function polygon(radius: number, sides: number, sagitta = 0): Blueprint {
  return polysidesBlueprint(radius, sides, sagitta)
}

/**
 * Rectangle factory with optional rounded corners.
 * @param width - rectangle width.
 * @param height - rectangle height.
 * @param r - corner radius (number or `{rx, ry}`).
 * @returns the rounded rectangle Blueprint.
 */
export function roundedRectangle(
  width: number,
  height: number,
  r: number | { rx?: number; ry?: number } = 0,
): Blueprint {
  return roundedRectangleBlueprint(width, height, r)
}

/**
 * Rectangle factory (sharp corners).
 * @param width - rectangle width.
 * @param height - rectangle height.
 * @returns the rectangle Blueprint.
 */
export function rectangle(width: number, height: number): Blueprint {
  return roundedRectangleBlueprint(width, height, 0)
}

/**
 * Circle factory.
 * @param radius - the circle radius.
 * @param center - the circle center.
 * @returns a Blueprint whose single contour is a full circle.
 */
export function circle(radius: number, center: Point2 = [0, 0]): Blueprint {
  return new Blueprint([makeCircle2d(center[0], center[1], radius, true)])
}