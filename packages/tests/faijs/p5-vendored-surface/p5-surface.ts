/**
 * P5 测试专用 facade：brepjs 自己的测试（operations/2d/sketching/io/gear 批次）所需的公共 API 面。
 *
 * 来源：docs/plans/2026-09-01-layered-api-architecture.md §P5（L2 全量、用 brepjs 自己的测试跑通）。
 *
 * 本 facade 重导出至 vendored 树（`@faicad/faijs-core/vendored/brepjs/…`）。
 * 纯数学批（gearMath、straightSkeleton、2d/lib、convexHull）不出 kernel 也可跑；
 * kernel-bound 批（operations 建模、sketching 草图到实体、gearFns 实体）需 `useKernelBeforeAll`。
 */

// ── gear 纯算法 ──
export {
  inv,
  involutePoint,
  cosineSpaceFlankSamples,
  adaptiveSampleCount,
  gearGeometry,
  solveWorkingPressureAngle,
  solveSunPlanetWorkingPressureAngle,
  solvePlanetRingWorkingPressureAngle,
  workingCenterDistance,
  validatePlanetary,
  planetPlacements,
  externalExternalContactRatio,
  externalInternalContactRatio,
  undercutMinimumShift,
  undercutDeficit,
  lewisYFactor,
  lewisRootStress,
  lewisRootStressCorrected,
  filletStressConcentrationFactor,
  backlashHalf,
  ringTeeth,
  evenToothPhaseOffset,
  planetSelfRotationAngle,
  DEFAULT_PRESSURE_ANGLE_DEG,
  DEFAULT_CLEARANCE,
  type GearGeometry,
  type GearDiagnostic,
  type GearDiagnosticCode,
  type GearDiagnosticSeverity,
  type PlanetPlacement,
  type PlanetPlacementParams,
} from '@faicad/faijs-core/vendored/brepjs/gear/gearMath.js'

// ── gear 实体化（kernel-bound）──
export {
  makeExternalGear,
  makeInternalGear,
  makePlanetaryGear,
  type ExternalGearParams,
  type InternalGearParams,
  type PlanetaryGearParams,
  type GearResult,
  type PlanetaryGearAssembly,
} from '@faicad/faijs-core/vendored/brepjs/gear/gearFns.js'

// ── operations ──
export {
  computeStraightSkeleton,
  type StraightSkeleton,
  type SkPoint2D,
} from '@faicad/faijs-core/vendored/brepjs/operations/straightSkeleton.js'
export { convexHull } from '@faicad/faijs-core/vendored/brepjs/operations/convexHullFns.js'
export { loft } from '@faicad/faijs-core/vendored/brepjs/operations/loftFns.js'
export { extrude, revolve } from '@faicad/faijs-core/vendored/brepjs/operations/api.js'
export { sweep } from '@faicad/faijs-core/vendored/brepjs/operations/sweepFns.js'
export {
  linearPattern,
  circularPattern,
  gridPattern,
} from '@faicad/faijs-core/vendored/brepjs/operations/patternFns.js'

// ── 2d/lib + 2d/blueprints ──
export { isPoint2D, isMatrix2X2 } from '@faicad/faijs-core/vendored/brepjs/2d/lib/definitions.js'
export {
  polysidesBlueprint,
  roundedRectangleBlueprint,
} from '@faicad/faijs-core/vendored/brepjs/2d/blueprints/cannedBlueprints.js'
export { make2dOffset } from '@faicad/faijs-core/vendored/brepjs/2d/lib/offset.js'
export {
  fuse2D,
  cut2D,
  intersect2D,
} from '@faicad/faijs-core/vendored/brepjs/2d/blueprints/boolean2D.js'
export {
  fuseBlueprints,
  cutBlueprints,
  intersectBlueprints,
} from '@faicad/faijs-core/vendored/brepjs/2d/blueprints/booleanOperations.js'
export { organiseBlueprints } from '@faicad/faijs-core/vendored/brepjs/2d/blueprints/lib.js'
export {
  fuseAll,
  fuse,
  cut,
  intersect,
  meshEdges,
} from '@faicad/faijs-core/vendored/brepjs/topology/api.js'

// ── core Result / shape guards（index 级）──
export { isOk, isErr, unwrap, unwrapErr } from '@faicad/faijs-core/vendored/brepjs/core/result.js'
export { isSolid, isShape3D, isCompound, castShape } from '@faicad/faijs-core/vendored/brepjs/core/shapeTypes.js'

// ── topology 原语/变换/查询（kernel-bound 测试共用）──
export { box, cylinder, sphere, wire, helix, line } from '@faicad/faijs-core/vendored/brepjs/topology/primitiveFns.js'
export { translate, isValid, mirror, rotate, scale } from '@faicad/faijs-core/vendored/brepjs/topology/api.js'
export { getFaces, getEdges } from '@faicad/faijs-core/vendored/brepjs/topology/topologyQueryFns.js'

// ── measurement ──
export { measureVolume, measureArea } from '@faicad/faijs-core/vendored/brepjs/measurement/measureFns.js'

// ── core planeOps / topology mesh + export ──
export { resolvePlane } from '@faicad/faijs-core/vendored/brepjs/core/planeOps.js'
export { mesh } from '@faicad/faijs-core/vendored/brepjs/topology/api.js'
export {
  exportSTEP,
  exportSTL,
  exportIGES,
} from '@faicad/faijs-core/vendored/brepjs/topology/meshFns.js'
export { getBounds } from '@faicad/faijs-core/vendored/brepjs/topology/topologyQueryFns.js'

// ── sketching：canned sketches + draw fns + compound —─
export { sketchCircle, sketchRectangle } from '@faicad/faijs-core/vendored/brepjs/sketching/cannedSketches.js'
export { draw } from '@faicad/faijs-core/vendored/brepjs/sketching/drawingPen.js'
export {
  drawRoundedRectangle,
  drawRectangle,
  drawCircle,
  drawPolysides,
  drawSingleCircle,
  drawSingleEllipse,
  drawEllipse,
  drawPointsInterpolation,
  drawParametricFunction,
} from '@faicad/faijs-core/vendored/brepjs/sketching/drawingFactories.js'
export { default as CompoundSketch } from '@faicad/faijs-core/vendored/brepjs/sketching/compoundSketch.js'
export { deserializeDrawing } from '@faicad/faijs-core/vendored/brepjs/sketching/drawing.js'
export { makeBaseBox } from '@faicad/faijs-core/vendored/brepjs/sketching/shortcuts.js'
export { drawFaceOutline, drawProjection } from '@faicad/faijs-core/vendored/brepjs/sketching/draw3d.js'

// ── io：SVG import + disposal stats ──
export { importSVG, importSVGPathD } from '@faicad/faijs-core/vendored/brepjs/io/svgImportFns.js'
export { getDisposalStats } from '@faicad/faijs-core/vendored/brepjs/core/disposal.js'

// ── operations：assembly / dh / joint / instance / urdf（kernel-bound）──
export {
  createAssemblyNode,
  addChild,
} from '@faicad/faijs-core/vendored/brepjs/operations/assemblyFns.js'
export { jointsFromDH } from '@faicad/faijs-core/vendored/brepjs/operations/dhFns.js'
export { revoluteJoint, prismaticJoint, cylindricalJoint, sphericalJoint, planarJoint, addJoint, forwardKinematics, mechanismDOF, jointTransform, setJointValue, setJointValues } from '@faicad/faijs-core/vendored/brepjs/operations/jointFns.js'
export { instance, instanceGrid, instanceCount, instancedMesh, isInstanced, materialize } from '@faicad/faijs-core/vendored/brepjs/operations/instanceFns.js'
export { importURDF, exportURDF } from '@faicad/faijs-core/vendored/brepjs/operations/urdfFns.js'

// ── topology 原语（helix/line 等预设）──

// ── kernel registry（getKernel 读面）──
export { getKernel } from '@faicad/faijs-core/vendored/brepjs/kernel/index.js'