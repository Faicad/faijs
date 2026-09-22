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
} from '@faicad/cq-compat'
export type { Sketch, SketchMode, SketchOpts } from '@faicad/cq-compat'
