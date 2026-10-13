/**
 * @faicad/faijs/extra — editor extension ops for faijs.
 *
 * Carries the ops and preview helpers that serve the editor application but
 * are now part of the cad namespace (fully assembled inside
 * `createApiNamespace()`):
 *
 * - A group (editor ops): `fai_drill` / `fai_extrude` / `fai_split`,
 *   `group` / `assembly`, `copy`, `load`.
 * - B group (svg / 3D text): `text`, `svgExtrude` plus the preview helpers
 *   `svgToExtrudedGeometry` / `parseSvgShapes` / `extrudeShapes` /
 *   `createTextGeometry` / `getOpentypeFont` / `opentypePathToGeometry` /
 *   `createMixedTextGeometry`.
 *
 * Hosts no longer need to merge/register these ops — `createRuntime(ports)`
 * provides the full cad namespace. The `editor-ops` sub-entry remains for
 * lightweight bundle closures.
 */
export {
  ALL_EDITOR_OPS, CREATOR_OPS, EDITOR_OPS, isEditorOp,
  type CreatorOpName, type EditorOpName,
} from './op-names'

// ── A 组：编辑器 op 定义 ──
export { fai_drill, assertDrillParams } from './ops/fai_drill'
export { fai_extrude, assertExtrudeParams } from './ops/fai_extrude'
export { fai_split } from './ops/fai_split'
export { group, assembly } from './ops/compound'
export type { GroupParams, AssemblyParams, AssemblyBehavior } from './ops/compound'
export { copy } from './ops/copy'
export { load } from './ops/load'
export type {
  AssemblyConstraint, FaceMateConstraint, FaceMateFace,
  EntityRef, FaceRef, EdgeRef, AssemblyVec3,
  MateConstraint, AlignConstraint, CoincidentConstraint, ConcentricConstraint,
  DistanceConstraint, AngleConstraint, ParallelConstraint, PerpendicularConstraint,
  FixedConstraint, StructuralConstraint,
} from '../api/assembly/types'
export type { AssemblySolveResult } from '../api/assembly/solve'

// ── B 组：svg / 3D 文字 op ──
export { text, assertTextParams } from './ops/text'
export { svgExtrude, assertSvgExtrudeParams } from './ops/svg-extrude'

// ── B 组：预览辅助函数（宿主交互预览用，不提交几何）──
export {
  svgToExtrudedGeometry, parseSvgShapes, extrudeShapes,
  type SvgExtrudeOptions,
} from './extras/svg-extrude'
export {
  createTextGeometry, getOpentypeFont, opentypePathToGeometry,
} from './extras/text-geometry'
export { createMixedTextGeometry } from './extras/text-cjk'
export { createEngraveDecorationProvider } from './mesh/engrave-decoration'

// ── mesh implementations (editor script face / previews; exported per module, no aggregate) ──
export {
  split as meshSplit, splitWithParams, dovetailSplit, dowelSplit, tenonSplit,
  computeBasisFromNormal,
} from './mesh/fai_split'
export { drill } from './mesh/fai_drill'
export { extrude as meshExtrude } from './mesh/fai_extrude'
export { text as meshText, svgExtrude as meshSvgExtrude } from './mesh/primitives'
export type {
  Shape, Vec3, BoundingBox, FaceDescriptor,
  TextParams, SvgExtrudeParams,
  DrillParams, ExtrudeParams,
  SplitPlane, SplitResult, DovetailSplitParams, DowelSplitParams, TenonSplitParams,
} from '../mesh/types'
