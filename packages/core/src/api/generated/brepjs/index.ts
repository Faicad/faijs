/**
 * generated/brepjs/index.ts — auto-generated library face (P5).
 *
 * Design: docs/plans/2026-09-07-compat-surface-unified-projection.md §5.1 ③
 *
 * Symbol count: 1299
 *
 * Wrap strategies are recorded in projection-manifest.json.
 * Currently all symbols are re-exported as raw (P4 will add
 * wrapGuarded / wrapDual / custom adapter generation).
 */

export {
  adaptedCurveToPathElem,
} from '../../../vendored/brepjs/2d/lib/svgPath.js'

export {
  approximateAsBSpline,
  approximateAsSvgCompatibleCurve,
  BSplineToBezier,
} from '../../../vendored/brepjs/2d/lib/approximations.js'

export type {
  ApproximationOptions,
} from '../../../vendored/brepjs/2d/lib/approximations.js'

export {
  approximateForSVG,
} from '../../../vendored/brepjs/2d/blueprints/blueprintApproximations.js'

export {
  arc2d,
  arc2dTangent,
  bezier2d,
  boundsCurve2d,
  bspline2d,
  circle2d,
  copyCurve2d,
  distanceBetweenCurves2d,
  ellipse2d,
  ellipseArc2d,
  evaluateCurve2d,
  extractCurve2dFromEdge,
  intersectCurves2d,
  liftCurve2dToPlane,
  line2d,
  mirrorCurve2d,
  mirrorCurve2dAcrossAxis,
  offsetCurve2d,
  projectPointOnCurve2d,
  rotateCurve2d,
  scaleCurve2d,
  splitCurve2d,
  tangentCurve2d,
  translateCurve2d,
  trimCurve2d,
  typeCurve2d,
} from '../../../vendored/brepjs/2d/curve2dGeometryFns.js'

export type {
  BSpline2dOptions,
  Ellipse2dOptions,
} from '../../../vendored/brepjs/2d/curve2dGeometryFns.js'

export {
  asSVG,
  viewbox,
} from '../../../vendored/brepjs/2d/blueprints/svg.js'

export {
  BaseSketcher2d,
} from '../../../vendored/brepjs/2d/blueprints/baseSketcher2d.js'

export {
  default as Blueprint,
} from '../../../vendored/brepjs/2d/blueprints/blueprint.js'

export {
  default as Blueprints,
} from '../../../vendored/brepjs/2d/blueprints/blueprints.js'

export {
  blueprintsIntersectionSegments,
  isCommonSegmentMatch,
} from '../../../vendored/brepjs/2d/blueprints/intersectionSegments.js'

export {
  BlueprintSketcher,
} from '../../../vendored/brepjs/2d/blueprints/blueprintSketcher.js'

export {
  booleanOperation,
  splitPaths,
} from '../../../vendored/brepjs/2d/blueprints/segmentAssembly.js'

export type {
  BooleanOperationResult,
} from '../../../vendored/brepjs/2d/blueprints/segmentAssembly.js'

export {
  BoundingBox2d,
} from '../../../vendored/brepjs/2d/lib/boundingBox2d.js'

export {
  chamfer2D,
  fillet2D,
} from '../../../vendored/brepjs/2d/blueprints/blueprintCustomCorners.js'

export {
  chamferCurves,
  dogboneFilletCurves,
  filletCurves,
} from '../../../vendored/brepjs/2d/lib/customCorners.js'

export {
  default as CompoundBlueprint,
} from '../../../vendored/brepjs/2d/blueprints/compoundBlueprint.js'

export {
  convertSvgEllipseParams,
  makeEllipseArcFromSvgParams,
  normalizeEllipseRadii,
} from '../../../vendored/brepjs/2d/blueprints/ellipseUtils.js'

export type {
  NormalizedEllipseParams,
} from '../../../vendored/brepjs/2d/blueprints/ellipseUtils.js'

export {
  createBlueprint,
  createCompoundBlueprint,
  getBounds2D,
  getOrientation2D,
  isInside2D,
  mirror2D,
  rotate2D,
  scale2D,
  sketchOnFace2D,
  sketchOnPlane2D,
  stretch2D,
  toSVGPathD,
  translate2D,
} from '../../../vendored/brepjs/2d/blueprints/blueprintFns.js'

export {
  Curve2D,
  deserializeCurve2D,
} from '../../../vendored/brepjs/2d/lib/curve2D.js'

export {
  curve2dBoundingBox,
  curve2dDistanceFrom,
  curve2dFirstPoint,
  curve2dIsOnCurve,
  curve2dLastPoint,
  curve2dParameter,
  curve2dSplitAt,
  curve2dTangentAt,
  reverseCurve,
} from '../../../vendored/brepjs/2d/lib/curve2dFns.js'

export {
  curveMidPoint,
  endOfSegment,
  hashPoint,
  hashSegment,
  reverseSegment,
  reverseSegments,
  rotateToStartAt,
  rotateToStartAtSegment,
  samePoint,
  startOfSegment,
} from '../../../vendored/brepjs/2d/blueprints/booleanHelpers.js'

export type {
  IntersectionSegment,
  Segment,
} from '../../../vendored/brepjs/2d/blueprints/booleanHelpers.js'

export {
  curvesAsEdgesOnFace,
  curvesAsEdgesOnPlane,
  curvesAsEdgesOnSurface,
  curvesBoundingBox,
  edgeToCurve,
  mirrorTransform2d,
  rotateTransform2d,
  scaleTransform2d,
  stretchTransform2d,
  transformCurves,
  translationTransform2d,
} from '../../../vendored/brepjs/2d/curves.js'

export type {
  ScaleMode,
  Transformation2D,
} from '../../../vendored/brepjs/2d/curves.js'

export {
  cut2D,
  fuse2D,
  intersect2D,
} from '../../../vendored/brepjs/2d/blueprints/boolean2D.js'

export type {
  Shape2D,
} from '../../../vendored/brepjs/2d/blueprints/boolean2D.js'

export {
  cutBlueprints,
  fuseBlueprints,
  intersectBlueprints,
} from '../../../vendored/brepjs/2d/blueprints/booleanOperations.js'

export {
  defaultsSplineOptions,
} from '../../../vendored/brepjs/2d/blueprints/genericSketcher.js'

export type {
  GenericSketcher,
  SplineOptions,
  SplineTangent,
} from '../../../vendored/brepjs/2d/blueprints/genericSketcher.js'

export {
  organiseBlueprints,
} from '../../../vendored/brepjs/2d/blueprints/lib.js'

export type {
  DrawingInterface,
  SketchData,
} from '../../../vendored/brepjs/2d/blueprints/lib.js'

export {
  ellipseArcFlags,
} from '../../../vendored/brepjs/2d/lib/ellipseArcFlags.js'

export {
  intersectCurves,
  selfIntersections,
} from '../../../vendored/brepjs/2d/lib/intersections.js'

export {
  isMatrix2X2,
  isPoint2D,
} from '../../../vendored/brepjs/2d/lib/definitions.js'

export type {
  Matrix2X2,
} from '../../../vendored/brepjs/2d/lib/definitions.js'

export {
  make2dArcFromCenter,
  make2dBezierCurve,
  make2dCircle,
  make2dEllipse,
  make2dEllipseArc,
  make2dInerpolatedBSplineCurve,
  make2dSegmentCurve,
  make2dTangentArc,
  make2dThreePointArc,
} from '../../../vendored/brepjs/2d/lib/makeCurves.js'

export {
  make2dOffset,
} from '../../../vendored/brepjs/2d/lib/offset.js'

export {
  normalize2d,
} from '../../../vendored/brepjs/2d/lib/vectorOperations.js'

export {
  offsetBlueprint,
  rawOffsets,
} from '../../../vendored/brepjs/2d/blueprints/blueprintOffset.js'

export type {
  Offset2DConfig,
} from '../../../vendored/brepjs/2d/blueprints/blueprintOffset.js'

export {
  default as offset,
} from '../../../vendored/brepjs/2d/blueprints/blueprintOffset.js'

export {
  polysidesBlueprint,
  roundedRectangleBlueprint,
} from '../../../vendored/brepjs/2d/blueprints/cannedBlueprints.js'

export {
  removeDuplicatePoints,
  reprPnt,
} from '../../../vendored/brepjs/2d/lib/utils.js'

export {
  stitchCurves,
} from '../../../vendored/brepjs/2d/lib/stitching.js'

export {
  all,
  andThen,
  collect,
  err,
  flatMap,
  flatten,
  fromNullable,
  isErr,
  isOk,
  map,
  mapBoth,
  mapErr,
  match,
  ok,
  OK,
  or,
  orElse,
  pipeline,
  tap,
  tapErr,
  tryCatch,
  tryCatchAsync,
  unwrap,
  unwrapErr,
  unwrapOr,
  unwrapOrElse,
  zip,
} from '../../../vendored/brepjs/core/result.js'

export type {
  Err,
  Ok,
  Result,
  ResultPipeline,
  Unit,
} from '../../../vendored/brepjs/core/result.js'

export {
  borrowShapeWithKnownType,
  castResultShape,
  castResultShapeWithKnownType,
  castShape,
  castShape3D,
  castShapeWithKnownType,
  createCompound,
  createCompSolid,
  createEdge,
  createFace,
  createShell,
  createSolid,
  createVertex,
  createWire,
  disposeDowncastSource,
  disposeResultShape,
  disposeTransientSubShape,
  isCompound,
  isEdge,
  isFace,
  isShape1D,
  isShape3D,
  isShell,
  isSolid,
  isVertex,
  isWire,
} from '../../../vendored/brepjs/core/shapeTypes.js'

export type {
  AnyShape,
  Compound,
  CompSolid,
  CurveLike,
  Edge,
  Face,
  Shape1D,
  Shape3D,
  ShapeKind,
  Shell,
  Solid,
  UnknownDimShape,
  Vertex,
  Wire,
} from '../../../vendored/brepjs/core/shapeTypes.js'

export {
  as2D,
  as3D,
  is2D,
  is3D,
} from '../../../vendored/brepjs/core/dimensionTypes.js'

export type {
  Dimension,
  DimensionError,
  RequireDimension,
  SameDimension,
} from '../../../vendored/brepjs/core/dimensionTypes.js'

export {
  BrepErrorCode,
  computationError,
  ioError,
  kernelError,
  moduleInitError,
  queryError,
  safeIndex,
  sketcherStateError,
  typeCastError,
  unsupportedError,
  validationError,
} from '../../../vendored/brepjs/core/errors.js'

export type {
  BrepError,
  BrepErrorKind,
} from '../../../vendored/brepjs/core/errors.js'

export {
  closedWire,
  isClosedWire,
  isManifoldShell,
  isOrientedFace,
  isPlanarFace,
  isPlanarWire,
  isValidSolid,
  manifoldShell,
  orientedFace,
  planarFace,
  planarWire,
  validSolid,
} from '../../../vendored/brepjs/core/validityTypes.js'

export type {
  ClosedWire,
  ManifoldShell,
  OrientedFace,
  PlanarFace,
  PlanarWire,
  ValidSolid,
} from '../../../vendored/brepjs/core/validityTypes.js'

export {
  createBorrowedHandle,
  createHandle,
  createKernelHandle,
  DisposalScope,
  getDisposalStats,
  isLive,
  registerForCleanup,
  resetDisposalStats,
  unregisterFromCleanup,
  withArenaCheckpoint,
  withScope,
  withScopeResult,
  withScopeResultAsync,
} from '../../../vendored/brepjs/core/disposal.js'

export type {
  Deletable,
  DisposalStats,
  KernelHandle,
  ShapeHandle,
} from '../../../vendored/brepjs/core/disposal.js'

export {
  createCurve2DHandle,
} from '../../../vendored/brepjs/core/curve2dHandle.js'

export type {
  Curve2DHandle,
} from '../../../vendored/brepjs/core/curve2dHandle.js'

export {
  createNamedPlane,
  createPlane,
  makePlane,
  pivotPlane,
  planeToLocal,
  planeToWorld,
  resolvePlane,
  translatePlane,
} from '../../../vendored/brepjs/core/planeOps.js'

export {
  findCurveType,
  getShapeKind,
} from '../../../vendored/brepjs/core/typeDiscriminants.js'

export type {
  CurveType,
} from '../../../vendored/brepjs/core/typeDiscriminants.js'

export {
  DEG2RAD,
  HASH_CODE_MAX,
  RAD2DEG,
} from '../../../vendored/brepjs/core/constants.js'

export {
  resolveDirection,
  toVec2,
  toVec3,
} from '../../../vendored/brepjs/core/types.js'

export type {
  Direction,
  Matrix4x4,
  MatrixInput,
  MatrixTransform,
  PointInput,
  Vec2,
  Vec3,
} from '../../../vendored/brepjs/core/types.js'

export {
  fromKernelDir,
  fromKernelPnt,
  fromKernelVec,
  makeKernelAx1,
  makeKernelAx2,
  makeKernelAx3,
  toKernelDir,
  toKernelPnt,
  toKernelVec,
  withKernelDir,
  withKernelPnt,
  withKernelVec,
} from '../../../vendored/brepjs/core/kernelBoundary.js'

export {
  getCachedType,
  getOrQueryType,
  hasCachedType,
  setCachedType,
} from '../../../vendored/brepjs/core/shapeTypeCache.js'

export {
  getSuggestionForCode,
  translateKernelError,
} from '../../../vendored/brepjs/core/kernelErrorTranslation.js'

export {
  kernelCall,
  kernelCallRaw,
  kernelCallScoped,
} from '../../../vendored/brepjs/core/kernelCall.js'

export type {
  Plane,
  PlaneInput,
  PlaneName,
} from '../../../vendored/brepjs/core/planeTypes.js'

export {
  vecAdd,
  vecAngle,
  vecCross,
  vecDistance,
  vecDot,
  vecEquals,
  vecIsZero,
  vecLength,
  vecLengthSq,
  vecNegate,
  vecNormalize,
  vecProjectToPlane,
  vecRepr,
  vecRotate,
  vecScale,
  vecSub,
} from '../../../vendored/brepjs/core/vecOps.js'

export type {
  FnPlane,
  FnPlaneName,
} from '../../../vendored/brepjs/core.js'

export {
  adaptiveSampleCount,
  backlashHalf,
  cosineSpaceFlankSamples,
  DEFAULT_CLEARANCE,
  DEFAULT_PRESSURE_ANGLE_DEG,
  evenToothPhaseOffset,
  externalExternalContactRatio,
  externalInternalContactRatio,
  filletStressConcentrationFactor,
  gearGeometry,
  inv,
  involutePoint,
  lewisRootStress,
  lewisRootStressCorrected,
  lewisYFactor,
  planetPlacements,
  planetSelfRotationAngle,
  ringTeeth,
  solvePlanetRingWorkingPressureAngle,
  solveSunPlanetWorkingPressureAngle,
  solveWorkingPressureAngle,
  undercutDeficit,
  undercutMinimumShift,
  validatePlanetary,
  workingCenterDistance,
} from '../../../vendored/brepjs/gear/gearMath.js'

export type {
  GearDiagnostic,
  GearDiagnosticCode,
  GearDiagnosticSeverity,
  GearGeometry,
  PlanetPlacement,
  PlanetPlacementParams,
} from '../../../vendored/brepjs/gear/gearMath.js'

export {
  makeExternalGear,
  makeInternalGear,
  makePlanetaryGear,
} from '../../../vendored/brepjs/gear/gearFns.js'

export type {
  ExternalGearParams,
  GearResult,
  InternalGearParams,
  PlanetaryGearAssembly,
  PlanetaryGearParams,
} from '../../../vendored/brepjs/gear/gearFns.js'

export {
  makeExternalGearProfileWire,
  makeInternalGearProfileWire,
} from '../../../vendored/brepjs/gear/gearProfile.js'

export type {
  GearWireParams,
} from '../../../vendored/brepjs/gear/gearProfile.js'

export {
  booleans,
  chamferDistAngleShape,
  construction,
  deserializeShape,
  getHistoryShape,
  measurement,
  modifiers,
  patterns,
  primitives,
  query,
  transforms,
  zipResults,
} from '../../../vendored/brepjs/index.js'

export type {
  CleanLoftOptions,
  CleanSweepOptions,
  HistoryOperationRegistry,
} from '../../../vendored/brepjs/index.js'

export {
  addCurveToBBox,
  createBBox2d,
  curveBounds,
  curveTypeName,
  deserializeCurve2d,
  intersectCurves2dFn,
  makeArc2dTangent,
  makeArc2dThreePoints,
  makeBezier2d,
  makeCircle2d,
  makeEllipse2d,
  makeLine2d,
  mirrorAcrossAxis,
  mirrorAtPoint,
  serializeCurve2d,
} from '../../../vendored/brepjs/kernel/geometry2d.js'

export type {
  BBox2d,
  Bezier2d,
  BSpline2d,
  Circle2d,
  Curve2dObj,
  Ellipse2d,
  Line2d,
  TrimmedCurve2d,
} from '../../../vendored/brepjs/kernel/geometry2d.js'

export {
  addCurveToBBox2d,
  affinityCurve2d,
  affinityTransform2d,
  approximateCurve2dAsBSpline,
  buildCurves3d,
  buildEdgeOnSurface,
  createAffinityGTrsf2d,
  createAxis2d,
  createBoundingBox2d,
  createDirection2d,
  createIdentityGTrsf2d,
  createMirrorGTrsf2d,
  createPoint2d,
  createRotationGTrsf2d,
  createScaleGTrsf2d,
  createTranslationGTrsf2d,
  createVector2d,
  decomposeBSpline2dToBeziers,
  evaluateCurve2dD1,
  extractSurfaceFromFace,
  fixWireOnFace,
  getBBox2dBounds,
  getCurve2dBezierDegree,
  getCurve2dBezierPoles,
  getCurve2dBounds,
  getCurve2dCircleData,
  getCurve2dEllipseData,
  getCurve2dType,
  isBBox2dOut,
  isBBox2dOutPoint,
  makeBSpline2d,
  makeEllipseArc2d,
  mergeBBox2d,
  mirrorCurve2dAtPoint,
  multiplyGTrsf2d,
  reverseCurve2d,
  setGTrsf2dTranslationPart,
  transformCurve2dGeneral,
  wrapCurve2dHandle,
} from '../../../vendored/brepjs/kernel/occtWasm/kernel2dOps.js'

export {
  addHolesInFace,
  bsplineSurface,
  buildSolidFromFaces,
  buildTriFace,
  createAxis1,
  createAxis2,
  createAxis3,
  createDirection3d,
  createPoint3d,
  createVector3d,
  makeArcEdge,
  makeBezierEdge,
  makeCircleArc,
  makeCircleEdge,
  makeCompound,
  makeEdge,
  makeEllipseArc,
  makeEllipseEdge,
  makeFace,
  makeFaceOnSurface,
  makeHelixWire,
  makeLineEdge,
  makeNonPlanarFace,
  makeTangentArc,
  makeVertex,
  makeWire,
  makeWireFromMixed,
  removeHolesFromFace,
  sewAndSolidify,
  solidFromShell,
  triangulatedSurface,
} from '../../../vendored/brepjs/kernel/occtWasm/constructionOps.js'

export {
  adjacentFaces,
  copyShape,
  downcast,
  edgeToFaceMap,
  hashCode,
  isEqual,
  isNull,
  isSame,
  iterShapes,
  sew,
  shapeOrientation,
  shapeType,
  sharedEdges,
  subShapeCount,
  subShapeHashes,
} from '../../../vendored/brepjs/kernel/occtWasm/topologyOps.js'

export {
  applyComposedTransformWithHistory,
  chamferWithHistory,
  cutWithHistory,
  draftWithHistory,
  filletWithHistory,
  fuseWithHistory,
  generalTransformWithHistory,
  intersectWithHistory,
  mirrorWithHistory,
  offsetWithHistory,
  rotateWithHistory,
  scaleWithHistory,
  shellWithHistory,
  thickenWithHistory,
  translateWithHistory,
} from '../../../vendored/brepjs/kernel/occtWasm/evolutionOps.js'

export {
  approximatePoints,
  curveDegreeElevate,
  curveIsClosed,
  curveIsPeriodic,
  curveKnotInsert,
  curveKnotRemove,
  curveParameters,
  curvePeriod,
  curvePointAtParam,
  curveSplit,
  curveTangent,
  curveType,
  getBezierPenultimatePole,
  getNurbsCurveData,
  interpolatePoints,
} from '../../../vendored/brepjs/kernel/occtWasm/curveOps.js'

export {
  area,
  boundingBox,
  centerOfMass,
  createDistanceQuery,
  distance,
  length,
  linearCenterOfMass,
  measureBulk,
  surfaceCenterOfMass,
  surfaceCurvature,
  volume,
} from '../../../vendored/brepjs/kernel/occtWasm/measureOps.js'

export type {
  CurvatureResult,
} from '../../../vendored/brepjs/kernel/occtWasm/measureOps.js'

export {
  supportsKernel2D,
} from '../../../vendored/brepjs/kernel/kernel2dTypes.js'

export type {
  BBox2dHandle,
  Curve2dHandle,
  Kernel2DCapability,
} from '../../../vendored/brepjs/kernel/kernel2dTypes.js'

export {
  supportsConstraintSketch,
  supportsProjection,
} from '../../../vendored/brepjs/kernel/types.js'

export type {
  BooleanDiagnostics,
  BooleanIssue,
  BooleanOptions,
  BooleanOpType,
  CheckBooleanResult,
  ConstraintSketchCapability,
  DiagnosticOperationResult,
  DistanceResult,
  KernelEdgeMeshResult,
  KernelInstance,
  KernelMeshResult,
  KernelShape,
  KernelType,
  MeshOptions,
  NurbsCurveData,
  NurbsSurfaceData,
  OperationResult,
  ProjectionCapability,
  ShapeEvolution,
  ShapeOrientation,
  ShapeType,
  StepAssemblyPart,
  SurfaceType,
} from '../../../vendored/brepjs/kernel/types.js'

export {
  buildAsciiSTL,
  buildBinarySTL,
  DEFAULT_STL_ANGULAR_TOLERANCE,
  DEFAULT_STL_TOLERANCE,
} from '../../../vendored/brepjs/kernel/stlBuilder.js'

export {
  buildExtrusionLaw,
  draftPrism,
  extrude,
  loft,
  loftAdvanced,
  revolve,
  revolveVec,
  simplePipe,
  sweep,
  sweepPipeShell,
} from '../../../vendored/brepjs/kernel/occtWasm/sweepOps.js'

export {
  buildOcShim,
  wrapKernelExceptions,
} from '../../../vendored/brepjs/kernel/occtWasm/adapterShims.js'

export type {
  BulkMeasurement,
  KernelMeasureOps,
} from '../../../vendored/brepjs/kernel/interfaces/measureOps.js'

export {
  chamfer,
  chamferDistAngle,
  defeature,
  draft,
  fillet,
  filletVariable,
  offsetWire2D,
  reverseShape,
  shell,
  simplify,
  thicken,
} from '../../../vendored/brepjs/kernel/occtWasm/modifierOps.js'

export {
  checkBoolean,
  cut,
  cutAll,
  fuse,
  fuseAll,
  intersect,
  meshBoolean,
  resolveBooleanTool,
  section,
  split,
} from '../../../vendored/brepjs/kernel/occtWasm/booleanOps.js'

export type {
  ResolvedTool,
} from '../../../vendored/brepjs/kernel/occtWasm/booleanOps.js'

export {
  circularPattern,
  composeTransform,
  generalTransform,
  linearPattern,
  locate,
  mirror,
  positionOnCurve,
  rotate,
  scale,
  transform,
  transformBatch,
  translate,
} from '../../../vendored/brepjs/kernel/occtWasm/transformOps.js'

export {
  classifyPointOnFace,
  getSurfaceAxis,
  getSurfaceCylinderData,
  outerWire,
  pointOnSurface,
  projectEdges,
  projectPointOnFace,
  reverseSurfaceU,
  surfaceNormal,
  surfaceType,
  uvBounds,
  uvFromPoint,
  vertexPosition,
} from '../../../vendored/brepjs/kernel/occtWasm/surfaceOps.js'

export {
  createXCAFDocument,
  fromBREP,
  toBREP,
  writeXCAFToSTEP,
} from '../../../vendored/brepjs/kernel/occtWasm/ioOps.js'

export {
  currentQuality,
  qualityDeflection,
  setQualityState,
} from '../../../vendored/brepjs/kernel/quality.js'

export type {
  QualityDeflection,
  QualityLevel,
} from '../../../vendored/brepjs/kernel/quality.js'

export {
  currentQualityTier,
  freezeKernels,
  getActiveKernelId,
  getKernel,
  getKernel2D,
  getKernelCapabilities,
  registerKernel,
} from '../../../vendored/brepjs/kernel/index.js'

export {
  DEFAULT_CAPABILITIES,
  EXACT_BREP_CAPABILITIES,
} from '../../../vendored/brepjs/kernel/capabilities.js'

export type {
  KernelCapabilities,
  TessellationModel,
} from '../../../vendored/brepjs/kernel/capabilities.js'

export type {
  EmBBoxData,
  EmEdgeData,
  EmEvolutionData,
  EmMeshData,
  EmNurbsCurveData,
  EmProjectionData,
  EmVectorDouble,
  EmVectorInt,
  EmVectorString,
  EmVectorUint32,
  OcctKernelWasm,
  OcctWasmModule,
} from '../../../vendored/brepjs/kernel/occtWasm/occtWasmTypes.js'

export {
  fixFaceOrientations,
  fixShape,
  healFace,
  healSolid,
  healWire,
  isValid,
  mergeCoincidentVertices,
  removeDegenerateEdges,
} from '../../../vendored/brepjs/kernel/occtWasm/repairOps.js'

export {
  handle,
  isOcctWasmHandle,
  makeVecDouble,
  makeVecInt,
  makeVecU32,
  mapShapeType,
  multiplyMatrices4x4,
  noop,
  readVecInt,
  resolveUniformRadius,
  rotateZToDirection,
  wrapResult,
} from '../../../vendored/brepjs/kernel/occtWasm/helpers.js'

export {
  hasTriangulation,
  mesh,
  meshEdges,
  meshShape,
} from '../../../vendored/brepjs/kernel/occtWasm/meshOps.js'

export {
  hull,
  hullFromPoints,
} from '../../../vendored/brepjs/kernel/occtWasm/hullOps.js'

export {
  quickHull,
} from '../../../vendored/brepjs/kernel/hullGeometry.js'

export type {
  HullResult,
} from '../../../vendored/brepjs/kernel/hullGeometry.js'

export {
  isUnsupportedKernelOperationError,
  UnsupportedKernelOperationError,
} from '../../../vendored/brepjs/kernel/unsupported.js'

export type {
  KernelAdapter,
} from '../../../vendored/brepjs/kernel/interfaces/index.js'

export type {
  KernelBooleanOps,
} from '../../../vendored/brepjs/kernel/interfaces/booleanOps.js'

export type {
  KernelBuilderOps,
} from '../../../vendored/brepjs/kernel/interfaces/builderOps.js'

export type {
  KernelCore,
} from '../../../vendored/brepjs/kernel/interfaces/core.js'

export type {
  KernelCurveOps,
} from '../../../vendored/brepjs/kernel/interfaces/curveOps.js'

export type {
  KernelEvolutionOps,
} from '../../../vendored/brepjs/kernel/interfaces/evolutionOps.js'

export type {
  KernelIOOps,
} from '../../../vendored/brepjs/kernel/interfaces/ioOps.js'

export type {
  KernelMeshOps,
} from '../../../vendored/brepjs/kernel/interfaces/meshOps.js'

export type {
  KernelModifierOps,
} from '../../../vendored/brepjs/kernel/interfaces/modifierOps.js'

export type {
  KernelPrimitiveOps,
} from '../../../vendored/brepjs/kernel/interfaces/primitiveOps.js'

export type {
  KernelRepairOps,
} from '../../../vendored/brepjs/kernel/interfaces/repairOps.js'

export type {
  KernelSurfaceOps,
} from '../../../vendored/brepjs/kernel/interfaces/surfaceOps.js'

export type {
  KernelSweepOps,
} from '../../../vendored/brepjs/kernel/interfaces/sweepOps.js'

export type {
  KernelTopologyOps,
} from '../../../vendored/brepjs/kernel/interfaces/topologyOps.js'

export type {
  KernelTransformOps,
  TransformEntry,
} from '../../../vendored/brepjs/kernel/interfaces/transformOps.js'

export {
  makeBox,
  makeBoxFromCorners,
  makeCone,
  makeCylinder,
  makeEllipsoid,
  makeRectangle,
  makeSphere,
  makeTorus,
} from '../../../vendored/brepjs/kernel/occtWasm/primitiveOps.js'

export {
  OcctWasmAdapter,
} from '../../../vendored/brepjs/kernel/occtWasm/occtWasmAdapter.js'

export type {
  OcctKernelOwner,
} from '../../../vendored/brepjs/kernel/occtWasm/occtWasmAdapter.js'

export type {
  OpenTypeFont,
  OpenTypePathCommand,
} from '../../../vendored/brepjs/kernel/occt/wasmTypes/externals.js'

export {
  solveConstraints,
} from '../../../vendored/brepjs/kernel/solverAdapter.js'

export type {
  SolverConstraint,
  SolverEntity,
  SolverResult,
} from '../../../vendored/brepjs/kernel/solverAdapter.js'

export {
  checkAllInterferences,
  checkInterference,
} from '../../../vendored/brepjs/measurement/interferenceFns.js'

export type {
  InterferencePair,
  InterferenceResult,
} from '../../../vendored/brepjs/measurement/interferenceFns.js'

export {
  clearMeasurementCache,
  getCachedMeasurement,
  setCachedMeasurement,
} from '../../../vendored/brepjs/measurement/measureCache.js'

export type {
  MeasurementKey,
  MeasurementValueMap,
} from '../../../vendored/brepjs/measurement/measureCache.js'

export type {
  DistanceProps,
  LinearProps,
  PhysicalProps,
  SurfaceProps,
  VolumeProps,
} from '../../../vendored/brepjs/measurement/measureTypes.js'

export {
  measureArea,
  measureCurvatureAt,
  measureCurvatureAtMid,
  measureDistance,
  measureDistanceProps,
  measureLength,
  measureLinearProps,
  measureSurfaceProps,
  measureVolume,
  measureVolumeProps,
} from '../../../vendored/brepjs/measurement/measureFns.js'

export {
  addChild,
  collectShapes,
  countNodes,
  createAssemblyNode,
  findNode,
  removeChild,
  updateNode,
  walkAssembly,
} from '../../../vendored/brepjs/operations/assemblyFns.js'

export type {
  AssemblyNode,
  AssemblyNodeOptions,
} from '../../../vendored/brepjs/operations/assemblyFns.js'

export {
  addJoint,
  cylindricalJoint,
  forwardKinematics,
  jointTransform,
  mechanismDOF,
  planarJoint,
  prismaticJoint,
  revoluteJoint,
  setJointValue,
  setJointValues,
  sphericalJoint,
} from '../../../vendored/brepjs/operations/jointFns.js'

export type {
  CylindricalOptions,
  Joint,
  JointAxis,
  JointDOF,
  JointOptions,
  JointPose,
  JointType,
  PlanarOptions,
  SphericalOptions,
} from '../../../vendored/brepjs/operations/jointFns.js'

export {
  addMate,
  solveAssembly,
} from '../../../vendored/brepjs/operations/mateFns.js'

export type {
  AssemblySolveResult,
  MateConstraint,
  MateEntity,
} from '../../../vendored/brepjs/operations/mateFns.js'

export {
  addStep,
  createHistory,
  createRegistry,
  deserializeHistory,
  findStep,
  getShape,
  modifyStep,
  registerOperation,
  registerShape,
  replayFrom,
  replayHistory,
  serializeHistory,
  stepCount,
  stepsFrom,
  undoLast,
} from '../../../vendored/brepjs/operations/historyFns.js'

export type {
  ModelHistory,
  OperationFn,
  OperationRegistry,
  OperationStep,
  SerializedHistory,
} from '../../../vendored/brepjs/operations/historyFns.js'

export {
  createAssembly,
} from '../../../vendored/brepjs/operations/exporters.js'

export type {
  AssemblyExporter,
} from '../../../vendored/brepjs/operations/exporters.js'

export {
  boss,
  drill,
  mirrorJoin,
  pocket,
  rectangularPattern,
} from '../../../vendored/brepjs/operations/compoundOpsFns.js'

export {
  buildLawFromProfile,
} from '../../../vendored/brepjs/operations/extrudeUtils.js'

export type {
  ExtrusionProfile,
  SweepOptions,
} from '../../../vendored/brepjs/operations/extrudeUtils.js'

export {
  complexExtrude,
  guidedSweep,
  multiSectionSweep,
  supportExtrude,
  twistExtrude,
} from '../../../vendored/brepjs/operations/sweepFns.js'

export type {
  GuidedSweepOptions,
  MultiSweepOptions,
  SweepSectionConfig,
} from '../../../vendored/brepjs/operations/sweepFns.js'

export {
  computeStraightSkeleton,
} from '../../../vendored/brepjs/operations/straightSkeleton.js'

export type {
  SkeletonFace,
  SkeletonNode,
  SkPoint2D,
  StraightSkeleton,
} from '../../../vendored/brepjs/operations/straightSkeleton.js'

export {
  convexHull,
} from '../../../vendored/brepjs/operations/convexHullFns.js'

export {
  jointsFromDH,
} from '../../../vendored/brepjs/operations/dhFns.js'

export type {
  DHOptions,
  DHRow,
} from '../../../vendored/brepjs/operations/dhFns.js'

export {
  extrudeAll,
} from '../../../vendored/brepjs/operations/extrudeFns.js'

export type {
  ExtrudeAllEntry,
} from '../../../vendored/brepjs/operations/extrudeFns.js'

export {
  gridPattern,
} from '../../../vendored/brepjs/operations/patternFns.js'

export {
  inverseKinematics,
  jointTrajectory,
} from '../../../vendored/brepjs/operations/ikFns.js'

export type {
  IKOptions,
  IKResult,
  IKTarget,
  TrajectorySample,
} from '../../../vendored/brepjs/operations/ikFns.js'

export {
  instance,
  instanceCount,
  instancedMesh,
  instanceGrid,
  isInstanced,
  materialize,
} from '../../../vendored/brepjs/operations/instanceFns.js'

export type {
  InstancedMesh,
  InstancedShape,
  InstanceGridOptions,
  MaterializeOptions,
} from '../../../vendored/brepjs/operations/instanceFns.js'

export {
  loftAll,
} from '../../../vendored/brepjs/operations/loftFns.js'

export type {
  LoftAllEntry,
  LoftOptions,
} from '../../../vendored/brepjs/operations/loftFns.js'

export type {
  RevolveOptions,
} from '../../../vendored/brepjs/operations/api.js'

export {
  roof,
} from '../../../vendored/brepjs/operations/roofFns.js'

export type {
  RoofOptions,
} from '../../../vendored/brepjs/operations/roofFns.js'

export type {
  ShapeOptions,
} from '../../../vendored/brepjs/operations/exporterFns.js'

export type {
  SupportedUnit,
} from '../../../vendored/brepjs/operations/exporterUtils.js'

export {
  thread,
} from '../../../vendored/brepjs/operations/threadFns.js'

export type {
  ThreadOptions,
} from '../../../vendored/brepjs/operations/threadFns.js'

export type {
  UrdfDocument,
  UrdfExportOptions,
} from '../../../vendored/brepjs/operations/urdfFns.js'

export {
  cameraFromPlane,
  cameraLookAt,
  createCamera,
} from '../../../vendored/brepjs/projection/cameraFns.js'

export type {
  Camera,
} from '../../../vendored/brepjs/projection/cameraFns.js'

export {
  isProjectionPlane,
  PROJECTION_PLANES,
} from '../../../vendored/brepjs/projection/projectionPlanes.js'

export type {
  CubeFace,
  PlaneConfig,
  ProjectionPlane,
} from '../../../vendored/brepjs/projection/projectionPlanes.js'

export {
  makeProjectedEdges,
} from '../../../vendored/brepjs/projection/makeProjectedEdges.js'

export {
  cornerFinder,
} from '../../../vendored/brepjs/query/cornerFinder.js'

export type {
  BlueprintLike,
  Corner,
  CornerFilter,
  CornerFinderFn,
} from '../../../vendored/brepjs/query/cornerFinder.js'

export {
  createTypedFinder,
} from '../../../vendored/brepjs/query/finderCore.js'

export type {
  Predicate,
  ShapeFinder,
  TopoKind,
} from '../../../vendored/brepjs/query/finderCore.js'

export {
  resolveDir,
} from '../../../vendored/brepjs/query/directionUtils.js'

export type {
  DirectionInput,
} from '../../../vendored/brepjs/query/directionUtils.js'

export {
  distanceFromPointFilter,
} from '../../../vendored/brepjs/query/shapeDistanceFilter.js'

export {
  edgeFinder,
  faceFinder,
  wireFinder,
} from '../../../vendored/brepjs/query/shapeFinders.js'

export type {
  EdgeFinderFn,
  FaceFinderFn,
  WireFinderFn,
} from '../../../vendored/brepjs/query/shapeFinders.js'

export {
  getSingleFace,
} from '../../../vendored/brepjs/query/helpers.js'

export type {
  SingleFace,
} from '../../../vendored/brepjs/query/helpers.js'

export {
  vertexFinder,
} from '../../../vendored/brepjs/query/vertexFinder.js'

export type {
  VertexFinderFn,
} from '../../../vendored/brepjs/query/vertexFinder.js'

export {
  asSketch,
  compoundSketchExtrude,
  compoundSketchFace,
  compoundSketchLoft,
  compoundSketchRevolve,
  compoundSketchWires,
  sketchExtrude,
  sketchFace,
  sketchLoft,
  sketchRevolve,
  sketchSweep,
  sketchWires,
  wrapSketchData,
  wrapSketchDataArray,
} from '../../../vendored/brepjs/sketching/sketchFns.js'

export {
  default as CompoundSketch,
} from '../../../vendored/brepjs/sketching/compoundSketch.js'

export {
  deserializeDrawing,
  Drawing,
} from '../../../vendored/brepjs/sketching/drawing.js'

export {
  draw,
  DrawingPen,
} from '../../../vendored/brepjs/sketching/drawingPen.js'

export {
  drawCircle,
  drawEllipse,
  drawParametricFunction,
  drawPointsInterpolation,
  drawPolysides,
  drawRectangle,
  drawRoundedRectangle,
  drawSingleCircle,
  drawSingleEllipse,
  drawText,
} from '../../../vendored/brepjs/sketching/drawingFactories.js'

export {
  drawFaceOutline,
  drawProjection,
} from '../../../vendored/brepjs/sketching/draw3d.js'

export {
  drawingChamfer,
  drawingCut,
  drawingFillet,
  drawingFuse,
  drawingIntersect,
  drawingToSketchOnPlane,
  mirrorDrawing,
  rotateDrawing,
  scaleDrawing,
  translateDrawing,
} from '../../../vendored/brepjs/sketching/drawFns.js'

export {
  default as FaceSketcher,
} from '../../../vendored/brepjs/sketching/faceSketcher.js'

export {
  makeBaseBox,
} from '../../../vendored/brepjs/sketching/shortcuts.js'

export {
  polysideInnerRadius,
  sketchCircle,
  sketchEllipse,
  sketchFaceOffset,
  sketchHelix,
  sketchParametricFunction,
  sketchPolysides,
  sketchRectangle,
  sketchRoundedRectangle,
} from '../../../vendored/brepjs/sketching/cannedSketches.js'

export type {
  SketchInterface,
} from '../../../vendored/brepjs/sketching/sketch.js'

export {
  default as Sketch,
} from '../../../vendored/brepjs/sketching/sketch.js'

export {
  default as Sketcher,
} from '../../../vendored/brepjs/sketching/sketcher.js'

export {
  default as Sketches,
} from '../../../vendored/brepjs/sketching/sketches.js'

export {
  fontMetrics,
  textMetrics,
} from '../../../vendored/brepjs/text/textMetrics.js'

export type {
  FontMetricsResult,
  TextMetricsResult,
} from '../../../vendored/brepjs/text/textMetrics.js'

export {
  getFont,
  loadFont,
} from '../../../vendored/brepjs/text/fontRegistry.js'

export {
  sketchText,
} from '../../../vendored/brepjs/text/sketchText.js'

export {
  textBlueprints,
} from '../../../vendored/brepjs/text/textBlueprints.js'

export {
  addHoles,
  bezier,
  box,
  bsplineApprox,
  circle,
  compound,
  cone,
  cylinder,
  ellipse,
  ellipseArc,
  ellipsoid,
  face,
  filledFace,
  helix,
  line,
  offsetFace,
  polygon,
  sewShells,
  solid,
  sphere,
  subFace,
  tangentArc,
  threePointArc,
  torus,
  vertex,
  wire,
  wireLoop,
} from '../../../vendored/brepjs/topology/primitiveFns.js'

export type {
  BoxOptions,
  CircleOptions,
  ConeOptions,
  CylinderOptions,
  EllipseArcOptions,
  EllipseOptions,
  EllipsoidOptions,
  HelixOptions,
  SphereOptions,
  TorusOptions,
} from '../../../vendored/brepjs/topology/primitiveFns.js'

export {
  adjacentFaceHashes,
  edgesOfFace,
  facesOfEdge,
  facesOfVertex,
  verticesOfEdge,
  verticesOfFace,
  wiresOfFace,
} from '../../../vendored/brepjs/topology/adjacencyFns.js'

export {
  applyGlue,
} from '../../../vendored/brepjs/topology/shapeBooleans.js'

export {
  applyMatrix,
  clone,
  describe,
  heal,
  isEmpty,
  sectionToFace,
  slice,
  transformCopy,
} from '../../../vendored/brepjs/topology/api.js'

export type {
  MirrorOptions,
  RotateOptions,
  ScaleOptions,
} from '../../../vendored/brepjs/topology/api.js'

export {
  approximateCurve,
  curveAxis,
  curveEndPoint,
  curveLength,
  curvePointAt,
  curveStartPoint,
  curveTangentAt,
  flipOrientation,
  getCurveType,
  getOrientation,
  interpolateCurve,
} from '../../../vendored/brepjs/topology/curveFns.js'

export type {
  ApproximateCurveOptions,
  InterpolateCurveOptions,
} from '../../../vendored/brepjs/topology/curveFns.js'

export {
  assembleWire,
  makeBezierCurve,
  makeBSplineApproximation,
  makeBSplineInterpolation,
  makeCircle,
  makeEllipse,
  makeHelix,
  makeLine,
  makeThreePointArc,
} from '../../../vendored/brepjs/topology/curveBuilders.js'

export type {
  BSplineApproximationOptions,
  BSplineInterpolationOptions,
} from '../../../vendored/brepjs/topology/curveBuilders.js'

export {
  assignRoles,
  captureHint,
  createRef,
  resolveRef,
  updateRoles,
} from '../../../vendored/brepjs/topology/shapeRef/shapeRefFns.js'

export {
  asTopo,
  cast,
  isCompSolid,
  iterTopo,
} from '../../../vendored/brepjs/topology/cast.js'

export type {
  GenericTopo,
  TopoEntity,
} from '../../../vendored/brepjs/topology/cast.js'

export {
  autoHeal,
  fixSelfIntersection,
} from '../../../vendored/brepjs/topology/healingFns.js'

export type {
  AutoHealOptions,
  HealingReport,
  HealingStepDiagnostic,
} from '../../../vendored/brepjs/topology/healingFns.js'

export {
  cutAllBisect,
  cutAllBisectWith,
  fuseAllBisect,
  fuseAllBisectWith,
} from '../../../vendored/brepjs/topology/booleanBatchFns.js'

export type {
  BatchBisectResult,
  BatchBisectTelemetry,
  BisectKernelOps,
} from '../../../vendored/brepjs/topology/booleanBatchFns.js'

export {
  booleanPipeline,
} from '../../../vendored/brepjs/topology/booleanFns.js'

export type {
  BooleanPipelineStep,
  PipelineOp,
} from '../../../vendored/brepjs/topology/booleanFns.js'

export {
  resolve,
  resolve3D,
} from '../../../vendored/brepjs/topology/apiTypes.js'

export type {
  BossOptions,
  ChamferDistance,
  DraftAngle,
  DraftOptions,
  DrawingLike,
  DrillOptions,
  FilletRadius,
  FinderFn,
  MirrorJoinOptions,
  PocketOptions,
  RectangularPatternOptions,
  Shapeable,
  WrappedMarker,
} from '../../../vendored/brepjs/topology/apiTypes.js'

export {
  getBounds,
  getCachedIsValid,
  getCachedShapeKind,
  getCachedSurfaceType,
  getCacheEntry,
  getCompSolids,
  getEdges,
  getFaces,
  getOrCreateCache,
  getShells,
  getSolids,
  getVertices,
  getWires,
  invalidateShapeCache,
  iterCompSolids,
  iterEdges,
  iterFaces,
  iterShells,
  iterSolids,
  iterVertices,
  iterWires,
} from '../../../vendored/brepjs/topology/topologyQueryFns.js'

export type {
  Bounds3D,
  ShapeDescription,
  TopoCacheEntry,
} from '../../../vendored/brepjs/topology/topologyQueryFns.js'

export {
  BrepWrapperError,
  shape,
} from '../../../vendored/brepjs/topology/wrapperFns.js'

export type {
  Wrapped,
  Wrapped3D,
  WrappedCurve,
  WrappedFace,
} from '../../../vendored/brepjs/topology/wrapperFns.js'

export type {
  BrokenDerivedFaceRef,
  BrokenEdgeRef,
  BrokenRef,
  BrokenVertexRef,
  DerivedFaceHint,
  DerivedFaceRef,
  EdgeHint,
  EdgeRef,
  GeometricHint,
  ResolvedDerivedFaceRef,
  ResolvedEdgeRef,
  ResolvedRef,
  ResolvedVertexRef,
  RoleTable,
  ShapeRef,
  VertexHint,
  VertexRef,
} from '../../../vendored/brepjs/topology/shapeRef/shapeRefTypes.js'

export {
  isDerivedFaceRef,
  isEdgeRef,
  isFaceRef,
  isLineageRef,
  isVertexRef,
  resolveLineageRef,
  resolveRefIn,
  resolveRefParams,
} from '../../../vendored/brepjs/topology/shapeRef/refResolveFns.js'

export type {
  BrokenReason,
  LineageRef,
  LineageResolution,
  ResolvedEntity,
} from '../../../vendored/brepjs/topology/shapeRef/refResolveFns.js'

export {
  toBufferGeometryData,
  toGroupedBufferGeometryData,
  toLineGeometryData,
  toLODGeometryData,
  toLODGeometryLevels,
} from '../../../vendored/brepjs/topology/threeHelpers.js'

export type {
  BufferGeometryData,
  BufferGeometryGroup,
  GroupedBufferGeometryData,
  LineGeometryData,
  LODGeometryData,
  LODGeometryLevel,
} from '../../../vendored/brepjs/topology/threeHelpers.js'

export {
  buildEdgeMeshCacheKey,
  buildMeshCacheKey,
  clearMeshCache,
  createMeshCache,
  getEdgeMeshForShape,
  getMeshForShape,
  setEdgeMeshForShape,
  setMeshForShape,
} from '../../../vendored/brepjs/topology/meshCache.js'

export type {
  MeshCacheContext,
} from '../../../vendored/brepjs/topology/meshCache.js'

export {
  isChamferRadius,
  isFilletRadius,
  isNumber,
} from '../../../vendored/brepjs/topology/shapeModifiers.js'

export type {
  ChamferRadius,
  RadiusOptions,
} from '../../../vendored/brepjs/topology/shapeModifiers.js'

export {
  chamferWithEvolution,
  cutWithEvolution,
  filletWithEvolution,
  fuseWithEvolution,
  intersectWithEvolution,
  shellWithEvolution,
} from '../../../vendored/brepjs/topology/evolutionFns.js'

export type {
  EvolutionResult,
} from '../../../vendored/brepjs/topology/evolutionFns.js'

export {
  collectInputFaceHashes,
  hasAnyMetadata,
  propagateAllMetadata,
  propagateMetadataByHash,
  propagateMetadataThroughRelocation,
} from '../../../vendored/brepjs/topology/metadata/metadataPropagation.js'

export {
  colorFaces,
  colorShape,
  getFaceColor,
  getShapeColor,
  hasColorMetadata,
  parseColor,
  propagateColorsFromEvolution,
} from '../../../vendored/brepjs/topology/metadata/colorFns.js'

export type {
  Color,
  ColorInput,
} from '../../../vendored/brepjs/topology/metadata/colorFns.js'

export {
  composeTransforms,
  resize,
} from '../../../vendored/brepjs/topology/transformFns.js'

export type {
  ComposedTransform,
  TransformOp,
} from '../../../vendored/brepjs/topology/transformFns.js'

export {
  createDerivedFaceRef,
  resolveDerivedFaceRef,
} from '../../../vendored/brepjs/topology/shapeRef/derivedFaceRefFns.js'

export {
  createEdgeRef,
  resolveEdgeRef,
} from '../../../vendored/brepjs/topology/shapeRef/edgeRefFns.js'

export {
  createVertexRef,
  resolveVertexRef,
} from '../../../vendored/brepjs/topology/shapeRef/vertexRefFns.js'

export {
  defaultScorer,
} from '../../../vendored/brepjs/topology/shapeRef/scoring.js'

export type {
  FaceScorer,
} from '../../../vendored/brepjs/topology/shapeRef/scoring.js'

export {
  meshLODs,
  meshLODsProgressive,
  meshMultiLOD,
  scaleDefaultTolerance,
} from '../../../vendored/brepjs/topology/meshFns.js'

export type {
  EdgeMesh,
  LODMesh,
  MeshLevelFn,
  MeshLODsOptions,
  MeshLODsProgressiveOptions,
  MultiLODMesh,
  ShapeMesh,
} from '../../../vendored/brepjs/topology/meshFns.js'

export {
  faceAxis,
  faceCenter,
  faceGeomType,
  faceOrientation,
  flipFaceOrientation,
  getSurfaceType,
  innerWires,
  normalAt,
  uvCoordinates,
} from '../../../vendored/brepjs/topology/faceFns.js'

export type {
  PointProjectionResult,
  UVBounds,
} from '../../../vendored/brepjs/topology/faceFns.js'

export {
  facesForRole,
  roleOfFace,
  vertexCentroid,
} from '../../../vendored/brepjs/topology/shapeRef/roleLookup.js'

export {
  fill,
  makeNewFaceWithinFace,
  makePolygon,
} from '../../../vendored/brepjs/topology/surfaceBuilders.js'

export {
  findFacesByTag,
  getFaceTags,
  getTagMetadata,
  hasFaceTags,
  propagateFaceTagsFromEvolution,
  setTagMetadata,
  tagFaces,
} from '../../../vendored/brepjs/topology/metadata/faceTagFns.js'

export {
  getFaceOrigins,
  propagateOriginsByHash,
  propagateOriginsFromEvolution,
  setShapeOrigin,
} from '../../../vendored/brepjs/topology/metadata/originTrackingFns.js'

export {
  getHashCode,
  isEqualShape,
  isSameShape,
} from '../../../vendored/brepjs/topology/shapeFns.js'

export {
  getNurbsSurfaceData,
} from '../../../vendored/brepjs/topology/nurbsFns.js'

export type {
  HullOptions,
} from '../../../vendored/brepjs/topology/hullFns.js'

export {
  makeOffset,
  makeSolid,
} from '../../../vendored/brepjs/topology/solidBuilders.js'

export {
  minkowski,
} from '../../../vendored/brepjs/topology/minkowskiFns.js'

export type {
  MinkowskiOptions,
} from '../../../vendored/brepjs/topology/minkowskiFns.js'

export {
  polyhedron,
} from '../../../vendored/brepjs/topology/polyhedronFns.js'

export type {
  PolyhedronOptions,
} from '../../../vendored/brepjs/topology/polyhedronFns.js'

export {
  surfaceFromGrid,
  surfaceFromImage,
} from '../../../vendored/brepjs/topology/surfaceFns.js'

export type {
  SurfaceFromGridOptions,
  SurfaceFromImageOptions,
} from '../../../vendored/brepjs/topology/surfaceFns.js'

export {
  variableFillet,
} from '../../../vendored/brepjs/topology/modifierFns.js'

export type {
  VariableFilletRadius,
} from '../../../vendored/brepjs/topology/modifierFns.js'

export {
  weldShapes,
  weldShellsAndFaces,
} from '../../../vendored/brepjs/topology/shapeUtils.js'

export {
  add2d,
  angle2d,
  cartesianToPolar,
  crossProduct2d,
  distance2d,
  dotProduct2d,
  polarAngle2d,
  polarToCartesian,
  PRECISION_INTERSECTION,
  PRECISION_OFFSET,
  PRECISION_POINT,
  rotate2d,
  scalarMultiply2d,
  squareDistance2d,
  subtract2d,
} from '../../../vendored/brepjs/utils/vec2d.js'

export type {
  Point2D,
} from '../../../vendored/brepjs/utils/vec2d.js'

export {
  BrepBugError,
  bug,
} from '../../../vendored/brepjs/utils/bug.js'

export {
  firstOrThrow,
  getAtOrThrow,
  lastOrThrow,
} from '../../../vendored/brepjs/utils/arrayAccess.js'

export {
  round2,
  round5,
} from '../../../vendored/brepjs/utils/precisionRound.js'

export {
  default as precisionRound,
} from '../../../vendored/brepjs/utils/precisionRound.js'

export {
  quatFromAxisAngle,
  quatFromTo,
  quatMultiply,
  quatRotate,
} from '../../../vendored/brepjs/utils/quaternion.js'

export type {
  Quat,
} from '../../../vendored/brepjs/utils/quaternion.js'

export {
  default as range,
} from '../../../vendored/brepjs/utils/range.js'

export {
  uniqueIOFilename,
} from '../../../vendored/brepjs/utils/ioFilename.js'

export {
  uuidv,
} from '../../../vendored/brepjs/utils/uuid.js'

export {
  vec3At,
  wasmIndex,
} from '../../../vendored/brepjs/utils/vec3.js'
