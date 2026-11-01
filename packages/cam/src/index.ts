/**
 * @faicad/cam — CAM toolpath kernel for the 3d_editor faijs worker.
 *
 * Ported from BREP.io `src/cam/*` (pure TS, no three.js / scene-graph
 * dependency). Design decisions D1–D5 per
 * `3d_editor/docs/plans/2026-11-02-cam-web-port-design.md`:
 *  - D1: algorithm kernel lives here (`@faicad/cam`).
 *  - D4: machine coordinates are identity (+Z up, mm) — `toMachinePoint`.
 *
 * Script-facing surface: `cam.machine / cam.stock / cam.op.roughing /
 * cam.op.surfacing` (see `lib.ts`). Worker-facing: `resetCamBuild` /
 * `takeCamBuild` (collector) and `generateToolpathForDeclaration`.
 */

// fai-script declaration library
export { cam, machine, stock, op, roughing, surfacing } from './lib.js'
export {
  assertKnownKeys,
  normalizeCamMachineDecl,
  normalizeCamStockDecl,
  normalizeCamToolDecl,
  normalizeCamOperationDecl,
} from './decl.js'
export type {
  CamWorkBounds,
  CamMachineDecl,
  CamStockDecl,
  CamToolDecl,
  CamFaceRef,
  CamOperationDecl,
} from './decl.js'

// camBuild collector
export { resetCamBuild, takeCamBuild, declareMachine, declareStock, declareOperation } from './collect.js'
export type { PendingCamBuild } from './collect.js'

// toolpath data model
export {
  CAM_TOOLPATH_SCHEMA_VERSION,
  roundCamCoord,
  roundCamPoint,
  normalizeCamOrientation,
  makeFlatEndMillCutter,
  makeBallEndMillCutter,
  buildLinearToolpathPath,
  makeEmptyCamToolpathProgram,
  summarizeCamToolpathProgram,
  unionCamBounds,
} from './types.js'
export type {
  CamUnits,
  CamPoint3,
  CamBounds,
  CamSegmentKind,
  CamCutterKind,
  CamCutterDefinition,
  CamCutterOrientation,
  CamToolpathPoint,
  CamToolpathSegment,
  CamToolpathPath,
  CamToolpathSummary,
  CamToolpathProgram,
  BuildLinearToolpathPathOptions,
} from './types.js'

// machine / stock profiles
export {
  DEFAULT_CAM_MACHINE_PROFILE,
  normalizeCamControllerFlavor,
  normalizeCamMachineProfile,
  mergeCamMachineProfile,
  splitMachineMacroLines,
  DEFAULT_CAM_STOCK_PROFILE,
  normalizeCamStockMode,
  normalizeCamStockProfile,
  mergeCamStockProfile,
} from './profile.js'
export type { CamControllerFlavor, CamMachineProfile, CamStockMode, CamStockProfile } from './profile.js'

// shared geometry primitives
export {
  EPS,
  finiteNumber,
  positiveNumber,
  roundCoord,
  cross2,
  polygonArea,
  ensureCounterClockwise,
  simplifyLoop,
  pointInPolygon,
  loopInsideLoop,
  point2Key,
  toMachinePoint,
  triangleBounds,
  trianglesFromMesh,
  makeFaceTriangleFilter,
} from './geometry.js'
export type { AnyRecord, CamPoint2, Triangle, ShadowLoopRole, ShadowLoop } from './geometry.js'

// shadow / polygon machinery
export {
  CAM_OPERATION_TYPE_SHADOW_CUTTER,
  loopsFromEdges,
  projectedShadowLoopsFromTriangles,
  unionContoursWithClipper,
  buildShadowLoops,
  unionProjectedShadowLoops,
  mergeOuterOffsetLoops,
  offsetPolygon,
  buildDepthLevels,
  makeSteppedLoopPath,
  boundsFromLoopsAndZ,
  makeEmptyShadowResult,
} from './shadow.js'

// algorithms
export { CAM_OPERATION_TYPE_SURFACING, generateSurfacingToolpath } from './surfacing.js'
export type { SurfacingParams } from './surfacing.js'
export { CAM_OPERATION_TYPE_ROUGHING, generateRoughingToolpath, buildRoughingSlices, buildSliceShadowLoops } from './roughing.js'
export type { RoughingParams } from './roughing.js'

// g-code post-processing
export { generateGcodeForCamToolpathProgram, combineCamToolpathPrograms } from './gcode.js'

// playback primitives
export {
  CAM_TOOLPATH_SIMULATOR_GROUP_NAME,
  CAM_TOOLPATH_TOOL_HEAD_NAME,
  flattenCamToolpathProgram,
} from './simulator.js'
export type { SimSegment } from './simulator.js'

// stock mesh
export { makeStockMesh } from './stock.js'
export type { StockMesh } from './stock.js'

// declaration → algorithm entry (worker instruction core)
export { machineDeclToProfile, generateToolpathForDeclaration, resolveFaceTriangles } from './generate.js'
export type { CamGenerateTarget } from './generate.js'
