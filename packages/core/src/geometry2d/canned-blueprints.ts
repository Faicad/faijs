/**
 * geometry2d — canned 2D shape factories that return `Blueprint`s (C2).
 *
 * Ported from brepjs `2d/blueprints/cannedBlueprints.ts` (Apache-2.0). Built on
 * `BlueprintSketcher`; each result is a closed contour ready for placement.
 *
 * @module
 */

import { BlueprintSketcher } from './blueprint-sketcher'
import { Blueprint } from './blueprint'

/** A point type local to this module. */
type Pt = readonly [number, number]

function lastOrThrow<T>(items: readonly T[]): T {
  const last = items[items.length - 1]
  if (last === undefined) throw new Error('[canned-blueprints] empty curve list')
  return last
}

/**
 * Create a regular polygon Blueprint inscribed in a circle of the given radius.
 * @param radius - circumscribed circle radius.
 * @param sidesCount - number of sides (3 = triangle, 6 = hexagon).
 * @param sagitta - when non-zero, sides become sagitta arcs (bulge height).
 * @returns a closed `Blueprint` representing the polygon.
 *
 * @example
 * ```ts
 * const hexagon = polysidesBlueprint(10, 6)
 * const roundedTriangle = polysidesBlueprint(10, 3, 2)
 * ```
 */
export function polysidesBlueprint(radius: number, sidesCount: number, sagitta = 0): Blueprint {
  const points: Pt[] = [...Array(sidesCount).keys()].map((i) => {
    const theta = -((Math.PI * 2) / sidesCount) * i
    return [radius * Math.sin(theta), radius * Math.cos(theta)]
  })
  const lastPoint = lastOrThrow(points)
  const blueprint = new BlueprintSketcher().movePointerTo([lastPoint[0], lastPoint[1]])
  if (sagitta) {
    points.forEach(([x, y]) => blueprint.sagittaArcTo([x, y], sagitta))
  } else {
    points.forEach(([x, y]) => blueprint.lineTo([x, y]))
  }
  return blueprint.done()
}

/**
 * Create an axis-aligned rectangle Blueprint (centered at the origin) with
 * optional rounded corners.
 * @param width - total width.
 * @param height - total height.
 * @param r - corner radius: a number for uniform rounding, or `{ rx, ry }`
 *   for elliptical corners. Clamped to half the respective dimension.
 * @returns the closed Blueprint representing the rounded rectangle.
 *
 * @example
 * ```ts
 * const sharp = roundedRectangleBlueprint(20, 10)
 * const rounded = roundedRectangleBlueprint(20, 10, 3)
 * const elliptical = roundedRectangleBlueprint(20, 10, { rx: 4, ry: 2 })
 * ```
 */
export function roundedRectangleBlueprint(
  width: number,
  height: number,
  r: number | { rx?: number; ry?: number } = 0,
): Blueprint {
  const { rx: inputRx = 0, ry: inputRy = 0 } = typeof r === 'number' ? { ry: r, rx: r } : r
  let rx = Math.min(inputRx, width / 2)
  let ry = Math.min(inputRy, height / 2)
  const withRadius = rx && ry
  if (!withRadius) {
    rx = 0
    ry = 0
  }
  const symmetricRadius = rx === ry
  const sk = new BlueprintSketcher([Math.min(0, -(width / 2 - rx)), -height / 2])
  const addFillet = (xDist: number, yDist: number): void => {
    if (!withRadius) return
    if (symmetricRadius) sk.tangentArc(xDist, yDist)
    else sk.ellipse(xDist, yDist, rx, ry, 0, false, true)
  }
  if (rx < width / 2) sk.hLine(width - 2 * rx)
  addFillet(rx, ry)
  if (ry < height / 2) sk.vLine(height - 2 * ry)
  addFillet(-rx, ry)
  if (rx < width / 2) sk.hLine(-(width - 2 * rx))
  addFillet(-rx, -ry)
  if (ry < height / 2) sk.vLine(-(height - 2 * ry))
  addFillet(rx, -ry)
  return new Blueprint(sk.close())
}