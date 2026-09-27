/**
 * drawing — the `cad.draw` fluent scripting entry (C3).
 *
 * `draw(session)` opens a pen session, runs the caller's chained drawing calls
 * on it, and produces a closed `Blueprint` (a placed contour). The `draw`
 * object also carries primitive factories (`draw.rectangle`,
 * `draw.roundedRectangle`, `draw.polygon`, `draw.circle`) so callers can
 * describe a contour declaratively. Imports core `geometry2d` only, per the
 * package boundary.
 *
 * @module
 */

import { BaseSketcher2d, Blueprint, BlueprintSketcher } from '@faicad/faijs/geometry2d'
import { rectangle, circle, ellipse, polygon, roundedRectangle } from './drawing-factories'

/**
 * A fluent drawing session body. `pen` is a `BaseSketcher2d` on which the
 * caller chains segments; after it returns the session closes the contour.
 *
 * @example
 * ```ts
 * draw((pen) => pen.hLineTo(10).vLineTo(10).hLineTo(0).close())
 * ```
 */
export type DrawSession = (pen: BaseSketcher2d) => void

/**
 * A callable with attached canned-shape factories: `draw(session)` runs a
 * chained sketching session, and `draw.rectangle`/`draw.circle`/etc build
 * primitives declaratively.
 */
export interface DrawNamespaceFunction {
  (session: DrawSession): Blueprint
  /** Rectangle factory (sharp corners). */
  rectangle: typeof rectangle
  /** Rounded-rectangle factory. */
  roundedRectangle: typeof roundedRectangle
  /** Regular-polygon factory. */
  polygon: typeof polygon
  /** Circle factory. */
  circle: typeof circle
  /** Ellipse factory. */
  ellipse: typeof ellipse
}

/**
 * Open a drawing session and close it into a `Blueprint`.
 * @returns the closed contour as a `Blueprint`.
 */
function drawSession(session: DrawSession): Blueprint {
  const pen = new BlueprintSketcher()
  session(pen)
  return new Blueprint(pen.close())
}

/**
 * The `cad.draw` entry: a callable session opener plus canned-shape factories.
 */
export const draw: DrawNamespaceFunction = Object.assign(drawSession, {
  rectangle,
  roundedRectangle,
  polygon,
  circle,
  ellipse,
})