/**
 * @faicad/cq-compat — CadQuery API compatibility layer for faijs.
 *
 * Usage in .fai.js:
 *   import * as cq from '@faicad/cq-compat'
 *   let wp = cq.Workplane('XY')
 *   let wp1 = await cq.box(wp, 100, 80, 10)
 *   let wp2 = await cq.faces(wp1, '>Z')
 *   let wp3 = await cq.workplane(wp2)
 *   let result = await cq.hole(wp3, 5)
 *   let shape = cq.val(result)
 *
 * All methods are standalone functions taking Workplane as first argument
 * (transpiler converts method chains to this form).
 */

export {
  Workplane,
  add,
  box,
  rect,
  circle,
  polygon,
  extrude,
  cutBlind,
  hole,
  cboreHole,
  cskHole,
  threadedHole,
  faces,
  edges,
  vertices,
  workplane,
  center,
  pushPoints,
  translate,
  rotate,
  mirror,
  union,
  cut,
  intersect,
  fillet,
  shell,
  val,
  vals,
  transformed,
  setColor,
} from './workplane'
export type { Workplane as WorkplaneType, RGB } from './workplane'

export { faceRef, constraint, buildAssembly, Color } from './assembly'

export { compareStepFiles, printCompareReport } from './step-compare'
export type {
  CompareOptions, StepCompareResult, MetricResult, TopologyStats,
} from './step-compare'
