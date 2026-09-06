/**
 * generated/operations.ts — 生成文件，勿手改。
 * 由 packages/core/scripts/gen-l3-surface.ts 依据 api/surface/arg-spec.ts 生成（E5/P14 分片）。
 * operations 模块：77 个投影符号；另有 45 个 skip 登记。
 */
import { compatOp } from '../internal/compat-op'
import { projectBrepOp } from '../internal/compat-projection'
import { extrude as __vendored_extrude } from '../../vendored/brepjs/operations/api.js'
import { revolve as __vendored_revolve } from '../../vendored/brepjs/operations/api.js'
import { sweep as __vendored_sweep } from '../../vendored/brepjs/operations/extrudeFns.js'
import { complexExtrude as __vendored_complexExtrude } from '../../vendored/brepjs/operations/extrudeFns.js'
import { twistExtrude as __vendored_twistExtrude } from '../../vendored/brepjs/operations/extrudeFns.js'
import { linearPattern as __vendored_linearPattern } from '../../vendored/brepjs/operations/patternFns.js'
import { circularPattern as __vendored_circularPattern } from '../../vendored/brepjs/operations/patternFns.js'
import { gridPattern as __vendored_gridPattern } from '../../vendored/brepjs/operations/patternFns.js'
import { roof as __vendored_roof } from '../../vendored/brepjs/operations/roofFns.js'
import { drill as __vendored_drill } from '../../vendored/brepjs/operations/compoundOpsFns.js'
import { pocket as __vendored_pocket } from '../../vendored/brepjs/operations/compoundOpsFns.js'
import { boss as __vendored_boss } from '../../vendored/brepjs/operations/compoundOpsFns.js'
import { mirrorJoin as __vendored_mirrorJoin } from '../../vendored/brepjs/operations/compoundOpsFns.js'
import { rectangularPattern as __vendored_rectangularPattern } from '../../vendored/brepjs/operations/compoundOpsFns.js'
import { thread as __vendored_thread } from '../../vendored/brepjs/operations/threadFns.js'
import { convexHull as __vendored_convexHull } from '../../vendored/brepjs/operations/convexHullFns.js'

export type { AssemblyExporter } from '../../vendored/brepjs/operations/exporters.js'

export type { AssemblyNode } from '../../vendored/brepjs/operations/assemblyFns.js'

export type { AssemblyNodeOptions } from '../../vendored/brepjs/operations/assemblyFns.js'

export type { AssemblySolveResult } from '../../vendored/brepjs/operations/mateFns.js'

export type { CleanLoftOptions } from '../../vendored/brepjs/index.js'

export type { CleanSweepOptions } from '../../vendored/brepjs/index.js'

export type { CylindricalOptions } from '../../vendored/brepjs/operations/jointFns.js'

export type { DHOptions } from '../../vendored/brepjs/operations/dhFns.js'

export type { DHRow } from '../../vendored/brepjs/operations/dhFns.js'

export type { ExtrudeAllEntry } from '../../vendored/brepjs/operations/extrudeFns.js'

export type { ExtrusionProfile } from '../../vendored/brepjs/operations/extrudeFns.js'

export type { GuidedSweepOptions } from '../../vendored/brepjs/operations/guidedSweepFns.js'

export type { HistoryOperationRegistry } from '../../vendored/brepjs/index.js'

export type { IKOptions } from '../../vendored/brepjs/operations/ikFns.js'

export type { IKResult } from '../../vendored/brepjs/operations/ikFns.js'

export type { IKTarget } from '../../vendored/brepjs/operations/ikFns.js'

export type { InstancedMesh } from '../../vendored/brepjs/operations/instanceFns.js'

export type { InstancedShape } from '../../vendored/brepjs/operations/instanceFns.js'

export type { InstanceGridOptions } from '../../vendored/brepjs/operations/instanceFns.js'

export type { Joint } from '../../vendored/brepjs/operations/jointFns.js'

export type { JointAxis } from '../../vendored/brepjs/operations/jointFns.js'

export type { JointDOF } from '../../vendored/brepjs/operations/jointFns.js'

export type { JointOptions } from '../../vendored/brepjs/operations/jointFns.js'

export type { JointPose } from '../../vendored/brepjs/operations/jointFns.js'

export type { JointType } from '../../vendored/brepjs/operations/jointFns.js'

export type { LoftAllEntry } from '../../vendored/brepjs/operations/loftFns.js'

export type { MateConstraint } from '../../vendored/brepjs/operations/mateFns.js'

export type { MateEntity } from '../../vendored/brepjs/operations/mateFns.js'

export type { MaterializeOptions } from '../../vendored/brepjs/operations/instanceFns.js'

export type { ModelHistory } from '../../vendored/brepjs/operations/historyFns.js'

export type { MultiSweepOptions } from '../../vendored/brepjs/operations/multiSweepFns.js'

export type { OperationFn } from '../../vendored/brepjs/operations/historyFns.js'

export type { OperationStep } from '../../vendored/brepjs/operations/historyFns.js'

export type { PlanarOptions } from '../../vendored/brepjs/operations/jointFns.js'

export type { RevolveOptions } from '../../vendored/brepjs/operations/api.js'

export type { RoofOptions } from '../../vendored/brepjs/operations/roofFns.js'

export type { SerializedHistory } from '../../vendored/brepjs/operations/historyFns.js'

export type { ShapeOptions } from '../../vendored/brepjs/operations/exporterFns.js'

export type { SkeletonFace } from '../../vendored/brepjs/operations/straightSkeleton.js'

export type { SkeletonNode } from '../../vendored/brepjs/operations/straightSkeleton.js'

export type { SkPoint2D } from '../../vendored/brepjs/operations/straightSkeleton.js'

export type { SphericalOptions } from '../../vendored/brepjs/operations/jointFns.js'

export type { StraightSkeleton } from '../../vendored/brepjs/operations/straightSkeleton.js'

export type { SupportedUnit } from '../../vendored/brepjs/operations/exporterFns.js'

export type { SweepOptions } from '../../vendored/brepjs/operations/extrudeFns.js'

export type { SweepSectionConfig } from '../../vendored/brepjs/operations/multiSweepFns.js'

export type { ThreadOptions } from '../../vendored/brepjs/operations/threadFns.js'

export type { TrajectorySample } from '../../vendored/brepjs/operations/ikFns.js'

export type { UrdfDocument } from '../../vendored/brepjs/operations/urdfFns.js'

export type { UrdfExportOptions } from '../../vendored/brepjs/operations/urdfFns.js'

export { revoluteJoint } from '../../vendored/brepjs/operations/jointFns.js'

export { prismaticJoint } from '../../vendored/brepjs/operations/jointFns.js'

export { cylindricalJoint } from '../../vendored/brepjs/operations/jointFns.js'

export { planarJoint } from '../../vendored/brepjs/operations/jointFns.js'

export { sphericalJoint } from '../../vendored/brepjs/operations/jointFns.js'

export { setJointValue } from '../../vendored/brepjs/operations/jointFns.js'

export { setJointValues } from '../../vendored/brepjs/operations/jointFns.js'

export { jointTransform } from '../../vendored/brepjs/operations/jointFns.js'

export { jointsFromDH } from '../../vendored/brepjs/operations/dhFns.js'

export { computeStraightSkeleton } from '../../vendored/brepjs/operations/straightSkeleton.js'

export { isInstanced } from '../../vendored/brepjs/operations/instanceFns.js'

/**
 * extrude — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * extrude(face: Shape, height?: number|Vec3) → Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const extrude = compatOp(
  projectBrepOp('extrude', ["face","height"], 'A', __vendored_extrude),
  { name: 'extrude' },
)

/**
 * revolve — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * revolve(face: Shape, options?: RevolveOptions): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const revolve = compatOp(
  projectBrepOp('revolve', ["face","options"], 'A', __vendored_revolve),
  { name: 'revolve' },
)

/**
 * sweep — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * sweep(wire: Shape, spine: Shape, config?: SweepOptions, shellMode?: boolean): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const sweep = compatOp(
  projectBrepOp('sweep', ["wire","spine","config","shellMode"], 'A', __vendored_sweep),
  { name: 'sweep' },
)

/**
 * complexExtrude — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * complexExtrude(wire: Shape, center: Vec3, normal: Vec3, profile?: ExtrusionProfile): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const complexExtrude = compatOp(
  projectBrepOp('complexExtrude', ["wire","center","normal","profile"], 'A', __vendored_complexExtrude),
  { name: 'complexExtrude' },
)

/**
 * twistExtrude — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * twistExtrude(wire: Shape, angleDegrees: number, center: Vec3, normal: Vec3): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const twistExtrude = compatOp(
  projectBrepOp('twistExtrude', ["wire","angleDegrees","center","normal"], 'A', __vendored_twistExtrude),
  { name: 'twistExtrude' },
)

/**
 * linearPattern — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * linearPattern(shape: Shape, direction: Vec3, count: number, spacing: number): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const linearPattern = compatOp(
  projectBrepOp('linearPattern', ["shape","direction","count","spacing"], 'A', __vendored_linearPattern),
  { name: 'linearPattern' },
)

/**
 * circularPattern — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * circularPattern(shape: Shape, axis: Vec3, count: number, fullAngle?: number, center?: Vec3): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const circularPattern = compatOp(
  projectBrepOp('circularPattern', ["shape","axis","count","fullAngle","center"], 'A', __vendored_circularPattern),
  { name: 'circularPattern' },
)

/**
 * gridPattern — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * gridPattern(shape: Shape, directionX: Vec3, directionY: Vec3, countX: number, countY: number, spacingX: number, spacingY: number): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const gridPattern = compatOp(
  projectBrepOp('gridPattern', ["shape","directionX","directionY","countX","countY","spacingX","spacingY"], 'A', __vendored_gridPattern),
  { name: 'gridPattern' },
)

/**
 * roof — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * roof(wire: Shape, options?: RoofOptions): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const roof = compatOp(
  projectBrepOp('roof', ["wire","options"], 'A', __vendored_roof),
  { name: 'roof' },
)

/**
 * drill — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * drill(shape: Shape, options: DrillOptions): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const drill = compatOp(
  projectBrepOp('drill', ["shape","options"], 'A', __vendored_drill),
  { name: 'drill' },
)

/**
 * pocket — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * pocket(shape: Shape, options: PocketOptions): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const pocket = compatOp(
  projectBrepOp('pocket', ["shape","options"], 'A', __vendored_pocket),
  { name: 'pocket' },
)

/**
 * boss — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * boss(shape: Shape, options: BossOptions): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const boss = compatOp(
  projectBrepOp('boss', ["shape","options"], 'A', __vendored_boss),
  { name: 'boss' },
)

/**
 * mirrorJoin — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * mirrorJoin(shape: Shape, options?: MirrorJoinOptions): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const mirrorJoin = compatOp(
  projectBrepOp('mirrorJoin', ["shape","options"], 'A', __vendored_mirrorJoin),
  { name: 'mirrorJoin' },
)

/**
 * rectangularPattern — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * rectangularPattern(shape: Shape, options: RectangularPatternOptions): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const rectangularPattern = compatOp(
  projectBrepOp('rectangularPattern', ["shape","options"], 'A', __vendored_rectangularPattern),
  { name: 'rectangularPattern' },
)

/**
 * thread — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * thread(options: ThreadOptions): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const thread = compatOp(
  projectBrepOp('thread', ["options"], 'B1', __vendored_thread),
  { name: 'thread' },
)

/**
 * convexHull — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * convexHull(points: Vec3[]): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const convexHull = compatOp(
  projectBrepOp('convexHull', ["points"], 'A', __vendored_convexHull),
  { name: 'convexHull' },
)
