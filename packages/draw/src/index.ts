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
export { polygon, roundedRectangle, rectangle, circle, ellipse } from './drawing-factories'
export { drawProjection, drawFaceOutline, projectPointToPlane, projectWire } from './projection'
export type { PlaneOrName } from './projection'
export { chamfer2d, fillet2d } from './ops/custom-corners'
export type { CornerSplice, FilletCorner, Point2d } from './ops/custom-corners'
export { offsetOutline2d } from './ops/offset'
export { pointInContour, segmentIntersection } from './ops/boolean'

// Re-export the core geometry base this package sits on, for convenience when
// callers build on `draw` output without importing core directly.
export type { Blueprint, Curve2dObj, BaseSketcher2d } from '@faicad/faijs/geometry2d'