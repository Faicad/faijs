/**
 * @facade/faijs-draw — the 2D drawing DSL over core's pure `geometry2d` base.
 *
 * Provides the fluent `cad.draw` scripting entry and the primitive contour
 * factories that feed core's placement pipeline (`sketchOnPlane`) into 3D.
 *
 * @module
 */

export { draw } from './draw'
export type { DrawNamespaceFunction, DrawSession } from './draw'
export { polygon, roundedRectangle, rectangle, circle } from './drawing-factories'

// Re-export the core geometry base this package sits on, for convenience when
// callers build on `draw` output without importing core directly.
export type { Blueprint, Curve2dObj, BaseSketcher2d } from '@faicad/faijs/geometry2d'