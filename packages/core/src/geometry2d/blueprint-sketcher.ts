/**
 * geometry2d — `BlueprintSketcher` (C2): a pen that packages its curves as a
 * `Blueprint`.
 *
 * Ported from brepjs `2d/blueprints/blueprintSketcher.ts` (Apache-2.0). Built
 * on the pure `BaseSketcher2d`. `done()` returns the still-open contour as a
 * `Blueprint`; callers that want a closed contour draw the closing segment
 * (the base `close()` does this) and wrap the result.
 *
 * @module
 */

import { Blueprint } from './blueprint'
import { BaseSketcher2d } from './pen-sketcher'

/**
 * A `BaseSketcher2d` that packages the drawn contour as a `Blueprint`.
 *
 * Extends the pen with a `done()` result owner; closes still go through:
 * `new Blueprint(pen.close())` yields the closed contour as a `Blueprint`.
 */
export class BlueprintSketcher extends BaseSketcher2d {
  /**
   * Package the accumulated curves as a `Blueprint` without closing.
   * @returns the open Blueprint of the drawn contour.
   */
  done(): Blueprint {
    return new Blueprint([...this.pendingCurves])
  }
}