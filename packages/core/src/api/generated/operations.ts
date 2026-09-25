/**
 * generated/operations.ts — 生成文件，勿手改。
 * 由 packages/core/scripts/gen-l3-surface.ts 依据 api/surface/arg-spec.ts 生成（E5/P14 分片）。
 * operations 模块：77 个投影符号；另有 45 个 skip 登记。
 */
import { compatOp } from '../internal/compat-op'
import { projectBrepOp } from '../internal/compat-projection'
import { extrude as __vendored_extrude } from '@faicad/faijs-brepjs/operations/api.js'
import { revolve as __vendored_revolve } from '@faicad/faijs-brepjs/operations/api.js'
import { sweep as __vendored_sweep } from '@faicad/faijs-brepjs/operations/extrudeFns.js'
import { complexExtrude as __vendored_complexExtrude } from '@faicad/faijs-brepjs/operations/extrudeFns.js'
import { twistExtrude as __vendored_twistExtrude } from '@faicad/faijs-brepjs/operations/extrudeFns.js'
import { linearPattern as __vendored_linearPattern } from '@faicad/faijs-brepjs/operations/patternFns.js'
import { circularPattern as __vendored_circularPattern } from '@faicad/faijs-brepjs/operations/patternFns.js'
import { gridPattern as __vendored_gridPattern } from '@faicad/faijs-brepjs/operations/patternFns.js'
import { roof as __vendored_roof } from '@faicad/faijs-brepjs/operations/roofFns.js'
import { drill as __vendored_drill } from '@faicad/faijs-brepjs/operations/compoundOpsFns.js'
import { pocket as __vendored_pocket } from '@faicad/faijs-brepjs/operations/compoundOpsFns.js'
import { boss as __vendored_boss } from '@faicad/faijs-brepjs/operations/compoundOpsFns.js'
import { mirrorJoin as __vendored_mirrorJoin } from '@faicad/faijs-brepjs/operations/compoundOpsFns.js'
import { rectangularPattern as __vendored_rectangularPattern } from '@faicad/faijs-brepjs/operations/compoundOpsFns.js'
import { thread as __vendored_thread } from '@faicad/faijs-brepjs/operations/threadFns.js'
import { convexHull as __vendored_convexHull } from '@faicad/faijs-brepjs/operations/convexHullFns.js'

export type { AssemblyExporter } from '@faicad/faijs-brepjs/operations/exporters.js'

export type { AssemblyNode } from '@faicad/faijs-brepjs/operations/assemblyFns.js'

export type { AssemblyNodeOptions } from '@faicad/faijs-brepjs/operations/assemblyFns.js'

export type { AssemblySolveResult } from '@faicad/faijs-brepjs/operations/mateFns.js'

export type { CleanLoftOptions } from '@faicad/faijs-brepjs/index.js'

export type { CleanSweepOptions } from '@faicad/faijs-brepjs/index.js'

export type { CylindricalOptions } from '@faicad/faijs-brepjs/operations/jointFns.js'

export type { DHOptions } from '@faicad/faijs-brepjs/operations/dhFns.js'

export type { DHRow } from '@faicad/faijs-brepjs/operations/dhFns.js'

export type { ExtrudeAllEntry } from '@faicad/faijs-brepjs/operations/extrudeFns.js'

export type { ExtrusionProfile } from '@faicad/faijs-brepjs/operations/extrudeFns.js'

export type { GuidedSweepOptions } from '@faicad/faijs-brepjs/operations/guidedSweepFns.js'

export type { HistoryOperationRegistry } from '@faicad/faijs-brepjs/index.js'

export type { IKOptions } from '@faicad/faijs-brepjs/operations/ikFns.js'

export type { IKResult } from '@faicad/faijs-brepjs/operations/ikFns.js'

export type { IKTarget } from '@faicad/faijs-brepjs/operations/ikFns.js'

export type { InstancedMesh } from '@faicad/faijs-brepjs/operations/instanceFns.js'

export type { InstancedShape } from '@faicad/faijs-brepjs/operations/instanceFns.js'

export type { InstanceGridOptions } from '@faicad/faijs-brepjs/operations/instanceFns.js'

export type { Joint } from '@faicad/faijs-brepjs/operations/jointFns.js'

export type { JointAxis } from '@faicad/faijs-brepjs/operations/jointFns.js'

export type { JointDOF } from '@faicad/faijs-brepjs/operations/jointFns.js'

export type { JointOptions } from '@faicad/faijs-brepjs/operations/jointFns.js'

export type { JointPose } from '@faicad/faijs-brepjs/operations/jointFns.js'

export type { JointType } from '@faicad/faijs-brepjs/operations/jointFns.js'

export type { LoftAllEntry } from '@faicad/faijs-brepjs/operations/loftFns.js'

export type { MateConstraint } from '@faicad/faijs-brepjs/operations/mateFns.js'

export type { MateEntity } from '@faicad/faijs-brepjs/operations/mateFns.js'

export type { MaterializeOptions } from '@faicad/faijs-brepjs/operations/instanceFns.js'

export type { ModelHistory } from '@faicad/faijs-brepjs/operations/historyFns.js'

export type { MultiSweepOptions } from '@faicad/faijs-brepjs/operations/multiSweepFns.js'

export type { OperationFn } from '@faicad/faijs-brepjs/operations/historyFns.js'

export type { OperationStep } from '@faicad/faijs-brepjs/operations/historyFns.js'

export type { PlanarOptions } from '@faicad/faijs-brepjs/operations/jointFns.js'

export type { RevolveOptions } from '@faicad/faijs-brepjs/operations/api.js'

export type { RoofOptions } from '@faicad/faijs-brepjs/operations/roofFns.js'

export type { SerializedHistory } from '@faicad/faijs-brepjs/operations/historyFns.js'

export type { ShapeOptions } from '@faicad/faijs-brepjs/operations/exporterFns.js'

export type { SkeletonFace } from '@faicad/faijs-brepjs/operations/straightSkeleton.js'

export type { SkeletonNode } from '@faicad/faijs-brepjs/operations/straightSkeleton.js'

export type { SkPoint2D } from '@faicad/faijs-brepjs/operations/straightSkeleton.js'

export type { SphericalOptions } from '@faicad/faijs-brepjs/operations/jointFns.js'

export type { StraightSkeleton } from '@faicad/faijs-brepjs/operations/straightSkeleton.js'

export type { SupportedUnit } from '@faicad/faijs-brepjs/operations/exporterFns.js'

export type { SweepOptions } from '@faicad/faijs-brepjs/operations/extrudeFns.js'

export type { SweepSectionConfig } from '@faicad/faijs-brepjs/operations/multiSweepFns.js'

export type { ThreadOptions } from '@faicad/faijs-brepjs/operations/threadFns.js'

export type { TrajectorySample } from '@faicad/faijs-brepjs/operations/ikFns.js'

export type { UrdfDocument } from '@faicad/faijs-brepjs/operations/urdfFns.js'

export type { UrdfExportOptions } from '@faicad/faijs-brepjs/operations/urdfFns.js'

export { revoluteJoint } from '@faicad/faijs-brepjs/operations/jointFns.js'

export { prismaticJoint } from '@faicad/faijs-brepjs/operations/jointFns.js'

export { cylindricalJoint } from '@faicad/faijs-brepjs/operations/jointFns.js'

export { planarJoint } from '@faicad/faijs-brepjs/operations/jointFns.js'

export { sphericalJoint } from '@faicad/faijs-brepjs/operations/jointFns.js'

export { setJointValue } from '@faicad/faijs-brepjs/operations/jointFns.js'

export { setJointValues } from '@faicad/faijs-brepjs/operations/jointFns.js'

export { jointTransform } from '@faicad/faijs-brepjs/operations/jointFns.js'

export { jointsFromDH } from '@faicad/faijs-brepjs/operations/dhFns.js'

export { computeStraightSkeleton } from '@faicad/faijs-brepjs/operations/straightSkeleton.js'

export { isInstanced } from '@faicad/faijs-brepjs/operations/instanceFns.js'

/**
 * extrude — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * extrude(face: Shape, height: number|Vec3) → Shape｜extrude(face: Shape, params: { length? | upTo, normal?, mode?, baseFeature?, offset? }) → Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const extrude = compatOp(
  projectBrepOp('extrude', ["face","height"], 'A', __vendored_extrude),
  { name: 'extrude', naming: {"kind":"construct","newFaces":{"via":"explicit","vocab":[{"kind":"semantic","name":"top"},{"kind":"semantic","name":"bottom"}]}}, engines: ["occt"] },
)

/**
 * revolve — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * revolve(face: Shape, options?: RevolveOptions): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const revolve = compatOp(
  projectBrepOp('revolve', ["face","options"], 'A', __vendored_revolve),
  { name: 'revolve', naming: {"kind":"construct","newFaces":{"via":"explicit","vocab":[{"kind":"semantic","name":"top"},{"kind":"semantic","name":"bottom"},{"kind":"wall","index":0}]}}, engines: ["occt"] },
)

/**
 * sweep — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * sweep(wire: Shape, spine: Shape, config?: SweepOptions, shellMode?: boolean): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const sweep = compatOp(
  projectBrepOp('sweep', ["wire","spine","config","shellMode"], 'A', __vendored_sweep),
  { name: 'sweep', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"] },
)

/**
 * complexExtrude — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * complexExtrude(wire: Shape, center: Vec3, normal: Vec3, profile?: ExtrusionProfile): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const complexExtrude = compatOp(
  projectBrepOp('complexExtrude', ["wire","center","normal","profile"], 'A', __vendored_complexExtrude),
  { name: 'complexExtrude', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"] },
)

/**
 * twistExtrude — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * twistExtrude(wire: Shape, angleDegrees: number, center: Vec3, normal: Vec3): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const twistExtrude = compatOp(
  projectBrepOp('twistExtrude', ["wire","angleDegrees","center","normal"], 'A', __vendored_twistExtrude),
  { name: 'twistExtrude', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"] },
)

/**
 * linearPattern — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * linearPattern(shape: Shape, direction: Vec3, count: number, spacing: number): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const linearPattern = compatOp(
  projectBrepOp('linearPattern', ["shape","direction","count","spacing"], 'A', __vendored_linearPattern),
  { name: 'linearPattern', naming: {"kind":"replicate","k":0}, engines: ["occt"] },
)

/**
 * circularPattern — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * circularPattern(shape: Shape, axis: Vec3, count: number, fullAngle?: number, center?: Vec3): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const circularPattern = compatOp(
  projectBrepOp('circularPattern', ["shape","axis","count","fullAngle","center"], 'A', __vendored_circularPattern),
  { name: 'circularPattern', naming: {"kind":"replicate","k":0}, engines: ["occt"] },
)

/**
 * gridPattern — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * gridPattern(shape: Shape, directionX: Vec3, directionY: Vec3, countX: number, countY: number, spacingX: number, spacingY: number): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const gridPattern = compatOp(
  projectBrepOp('gridPattern', ["shape","directionX","directionY","countX","countY","spacingX","spacingY"], 'A', __vendored_gridPattern),
  { name: 'gridPattern', naming: {"kind":"replicate","k":0}, engines: ["occt"] },
)

/**
 * roof — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * roof(wire: Shape, options?: RoofOptions): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const roof = compatOp(
  projectBrepOp('roof', ["wire","options"], 'A', __vendored_roof),
  { name: 'roof', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, capabilities: ["buildTriFace","dispose","fixShape","isValid","sew","sewAndSolidify"] },
)

/**
 * drill — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * drill(shape: Shape, options: DrillOptions): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const drill = compatOp(
  projectBrepOp('drill', ["shape","options"], 'A', __vendored_drill),
  { name: 'drill', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"] },
)

/**
 * pocket — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * pocket(shape: Shape, options: PocketOptions): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const pocket = compatOp(
  projectBrepOp('pocket', ["shape","options"], 'A', __vendored_pocket),
  { name: 'pocket', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"] },
)

/**
 * boss — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * boss(shape: Shape, options: BossOptions): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const boss = compatOp(
  projectBrepOp('boss', ["shape","options"], 'A', __vendored_boss),
  { name: 'boss', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"] },
)

/**
 * mirrorJoin — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * mirrorJoin(shape: Shape, options?: MirrorJoinOptions): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const mirrorJoin = compatOp(
  projectBrepOp('mirrorJoin', ["shape","options"], 'A', __vendored_mirrorJoin),
  { name: 'mirrorJoin', naming: {"kind":"replicate","k":2}, engines: ["occt"] },
)

/**
 * rectangularPattern — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * rectangularPattern(shape: Shape, options: RectangularPatternOptions): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const rectangularPattern = compatOp(
  projectBrepOp('rectangularPattern', ["shape","options"], 'A', __vendored_rectangularPattern),
  { name: 'rectangularPattern', naming: {"kind":"replicate","k":0}, engines: ["occt"] },
)

/**
 * thread — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * thread(options: ThreadOptions): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const thread = compatOp(
  projectBrepOp('thread', ["options"], 'B1', __vendored_thread),
  { name: 'thread', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"] },
)

/**
 * convexHull — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * convexHull(points: Vec3[]): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const convexHull = compatOp(
  projectBrepOp('convexHull', ["points"], 'A', __vendored_convexHull),
  { name: 'convexHull', naming: {"kind":"unmodeled","reason":"construct vocabulary pending Phase 3"}, engines: ["occt"] },
)
