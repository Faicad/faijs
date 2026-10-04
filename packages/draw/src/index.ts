/**
 * @facade/faijs-draw — the 2D drawing DSL over core's pure `geometry2d` base.
 *
 * ⚠️ DEPRECATED — THIS PACKAGE WILL BE REMOVED.
 *
 * `cad.draw` has no remaining emitter: the FCStd Draft pipeline re-emits
 * drawings as `ProfileLoop` data and places them with `cad.sketchOnPlane`
 * (see `packages/faijs-freecad/src/draft-draw.ts` and `codegen.ts`). New code
 * should use `cad.sketchOnPlane` / `cad.profile` / `cad.sketch` instead of
 * introducing any new `cad.draw` call site. The package is kept only until its
 * last consumer is migrated and is `private` (no longer published).
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
export { offsetOutline2d, offsetPolygonLoops2d } from './ops/offset'
export { pointInContour, segmentIntersection } from './ops/boolean'
export { booleanUnion2d, booleanIntersect2d, booleanDifference2d } from './ops/boolean-union'
export { contourToSvgPath, svgPathToContours } from './ops/svg'
export { DRAW_OPS, createDrawNamespace, mergeDrawNamespace, createDrawCadNamespace, registerDrawSymbols, unregisterDrawSymbols } from './namespace'
export { polygonSignedArea, isSimplePolygon, segmentsProperlyCross, decomposeSelfIntersections, pruneSelfIntersections } from './ops/polygon2d'

// Re-export the core geometry base this package sits on, for convenience when
// callers build on `draw` output without importing core directly.
export type { Blueprint, Curve2dObj, BaseSketcher2d } from '@faicad/faijs/geometry2d'