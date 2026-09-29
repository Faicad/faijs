/**
 * @faicad/cq-compat-sketch — CadQuery Sketch.py-compatible 2D sketch container
 * for faijs.
 *
 * CadQuery grammar surface (unprefixed names; the cq-compat main package
 * exposes the same functions with a `sketch` prefix):
 *   import { sketch, rect, circle, polygon, faces, wires, extrude } from
 *     '@faicad/cq-compat-sketch'
 *
 *   let s = sketch()
 *   s = rect(s, 2, 2)
 *   s = rect(s, 1, 1, { mode: 's' })
 *   let solid = extrude(s, 2)
 *
 * Phase 2 (max-cadquery plan) non-planegcs surface: geometry declarations +
 * modes a/s/i/c/r + selectors + the sketch→extrude outlet. The constraint
 * segment (`constrain`/`solve`) is intentionally out of scope pending the
 * planegcs LGPL-2.0-or-later legal verdict.
 */

export {
  sketchCreate,
  sketchCreate as sketch,
  sketchRect as rect,
  sketchCircle as circle,
  sketchEllipse as ellipse,
  sketchPolygon as polygon,
  sketchRegularPolygon as regularPolygon,
  sketchSlot as slot,
  sketchTrapezoid as trapezoid,
  sketchOffset as offset,
  sketchFaces as faces,
  sketchWires as wires,
  sketchEdges as edges,
  sketchVertices as vertices,
  sketchReset as reset,
  sketchVal as val,
  sketchVals as vals,
  sketchTag as tag,
  sketchSelect as select,
  sketchArea as area,
  sketchFaceCount as faceCount,
  sketchExtrude as extrude,
  sketchDispose as dispose,
  sketchPush as push,
  sketchEdge as edge,
  sketchFace as face,
  sketchSegment as segment,
  sketchArc as arc,
  sketchSpline as spline,
  sketchBezier as bezier,
  sketchClose as close,
  sketchAssemble as assemble,
  sketchAdd as add,
  sketchSubtract as subtract,
  sketchRarray as rarray,
  sketchParray as parray,
  sketchDistribute as distribute,
  sketchMoved as moved,
  sketchLocated as located,
  sketchCopy as copy,
  sketchDelete as delete,
  sketchReplace as replace,
  sketchFillet as fillet,
  sketchChamfer as chamfer,
  sketchClean as clean,
  sketchHull as hull,
  sketchHullFromPoints as hullFromPoints,
  sketchConstrain as constrain,
  sketchSolve as solve,
  sketchFinalize as finalize,
} from '@faicad/cq-compat'
export type {
  Sketch,
  SketchMode,
  SketchOpts,
  SketchEdgeOpts,
  SketchEdge,
  SketchConstraint,
  SketchConstrainSpec,
  SketchSolveStatus,
  SketchGeom,
  Pt2,
  Loc2,
} from '@faicad/cq-compat'
