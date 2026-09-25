/**
 * generated/topology.ts — 生成文件，勿手改。
 * 由 packages/core/scripts/gen-l3-surface.ts 依据 api/surface/arg-spec.ts 生成（E5/P14 分片）。
 * topology 模块：128 个投影符号；另有 174 个 skip 登记。
 */
import { compatOp } from '../internal/compat-op'
import { projectBrepOp } from '../internal/compat-projection'
import { borrowBrepjsShape, callBrepjs } from '../internal/l3-bridge'
import type { Shape } from '../../mesh/types'
import { torus as __vendored_torus } from '@faicad/faijs-brepjs/topology/primitiveFns.js'
import { fuse as __vendored_fuse } from '@faicad/faijs-brepjs/topology/booleanFns.js'
import { getBounds as __vendored_getBounds } from '@faicad/faijs-brepjs/topology/shapeFns.js'
import type { Bounds3D } from '@faicad/faijs-brepjs/topology/shapeFns.js'
import { ellipsoid as __vendored_ellipsoid } from '@faicad/faijs-brepjs/topology/primitiveFns.js'
import { rotate as __vendored_rotate } from '@faicad/faijs-brepjs/topology/api.js'
import { mirror as __vendored_mirror } from '@faicad/faijs-brepjs/topology/api.js'
import { clone as __vendored_clone } from '@faicad/faijs-brepjs/topology/api.js'
import { applyMatrix as __vendored_applyMatrix } from '@faicad/faijs-brepjs/topology/api.js'
import { locate as __vendored_locate } from '@faicad/faijs-brepjs/topology/api.js'
import { section as __vendored_section } from '@faicad/faijs-brepjs/topology/api.js'
import { split as __vendored_split } from '@faicad/faijs-brepjs/topology/api.js'
import { shell as __vendored_shell } from '@faicad/faijs-brepjs/topology/api.js'
import { offset as __vendored_offset } from '@faicad/faijs-brepjs/topology/api.js'
import { heal as __vendored_heal } from '@faicad/faijs-brepjs/topology/api.js'
import { simplify as __vendored_simplify } from '@faicad/faijs-brepjs/topology/api.js'
import { isValid as __vendored_isValid } from '@faicad/faijs-brepjs/topology/api.js'
import { isEmpty as __vendored_isEmpty } from '@faicad/faijs-brepjs/topology/api.js'
import { isEqualShape as __vendored_isEqualShape } from '@faicad/faijs-brepjs/topology/shapeFns.js'
import { isSameShape as __vendored_isSameShape } from '@faicad/faijs-brepjs/topology/shapeFns.js'
import { autoHeal as __vendored_autoHeal } from '@faicad/faijs-brepjs/topology/healingFns.js'
import { fixShape as __vendored_fixShape } from '@faicad/faijs-brepjs/topology/healingFns.js'
import { healSolid as __vendored_healSolid } from '@faicad/faijs-brepjs/topology/healingFns.js'
import { fixSelfIntersection as __vendored_fixSelfIntersection } from '@faicad/faijs-brepjs/topology/healingFns.js'

export type { Bounds3D } from '@faicad/faijs-brepjs/topology/shapeFns.js'

/**
 * torus — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * (majorRadius: number, minorRadius: number, options?: TorusOptions)
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const torus = compatOp(
  projectBrepOp('torus', ["majorRadius","minorRadius","options"], 'A', __vendored_torus),
  { name: 'torus', naming: {"kind":"unmodeled","reason":"construct vocabulary pending Phase 3"}, capabilities: ["dispose","makeTorus"] },
)

/**
 * fuse — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * (a: Shape3D, b: Shape3D, options?: BooleanOptions) -> Result<Shape3D>
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const fuse = compatOp(
  projectBrepOp('fuse', ["a","b","options"], 'A', __vendored_fuse),
  { name: 'fuse', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"] },
)

/**
 * getBounds — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * (shape: AnyShape) -> Bounds3D
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（查询表达式承载）。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns Bounds3D — 纯数据结果（非 Shape）。
 */
export function getBounds(shape: Shape): Bounds3D {

  return callBrepjs(__vendored_getBounds, [borrowBrepjsShape(shape as Shape)])
}

export type { ComposedTransform } from '@faicad/faijs-brepjs/topology/api.js'

export type { MirrorOptions } from '@faicad/faijs-brepjs/topology/api.js'

export type { RotateOptions } from '@faicad/faijs-brepjs/topology/api.js'

export type { ScaleOptions } from '@faicad/faijs-brepjs/topology/api.js'

export type { TransformOp } from '@faicad/faijs-brepjs/topology/api.js'

export type { BossOptions } from '@faicad/faijs-brepjs/topology/apiTypes.js'

export type { ChamferDistance } from '@faicad/faijs-brepjs/topology/apiTypes.js'

export type { DraftAngle } from '@faicad/faijs-brepjs/topology/apiTypes.js'

export type { DraftOptions } from '@faicad/faijs-brepjs/topology/apiTypes.js'

export type { DrawingLike } from '@faicad/faijs-brepjs/topology/apiTypes.js'

export type { DrillOptions } from '@faicad/faijs-brepjs/topology/apiTypes.js'

export type { FilletRadius } from '@faicad/faijs-brepjs/topology/apiTypes.js'

export type { FinderFn } from '@faicad/faijs-brepjs/topology/apiTypes.js'

export type { MirrorJoinOptions } from '@faicad/faijs-brepjs/topology/apiTypes.js'

export type { PocketOptions } from '@faicad/faijs-brepjs/topology/apiTypes.js'

export type { RectangularPatternOptions } from '@faicad/faijs-brepjs/topology/apiTypes.js'

export type { Shapeable } from '@faicad/faijs-brepjs/topology/apiTypes.js'

export type { WrappedMarker } from '@faicad/faijs-brepjs/topology/apiTypes.js'

export type { BatchBisectResult } from '@faicad/faijs-brepjs/topology/booleanBatchFns.js'

export type { BatchBisectTelemetry } from '@faicad/faijs-brepjs/topology/booleanBatchFns.js'

export type { BooleanOptions } from '@faicad/faijs-brepjs/topology/booleanFns.js'

export type { BooleanPipelineStep } from '@faicad/faijs-brepjs/topology/booleanFns.js'

export type { PipelineOp } from '@faicad/faijs-brepjs/topology/booleanFns.js'

export type { ApproximateCurveOptions } from '@faicad/faijs-brepjs/topology/curveFns.js'

export type { InterpolateCurveOptions } from '@faicad/faijs-brepjs/topology/curveFns.js'

export type { EvolutionResult } from '@faicad/faijs-brepjs/topology/evolutionFns.js'

export type { PointProjectionResult } from '@faicad/faijs-brepjs/topology/faceFns.js'

export type { UVBounds } from '@faicad/faijs-brepjs/topology/faceFns.js'

export type { AutoHealOptions } from '@faicad/faijs-brepjs/topology/healingFns.js'

export type { HealingReport } from '@faicad/faijs-brepjs/topology/healingFns.js'

export type { HealingStepDiagnostic } from '@faicad/faijs-brepjs/topology/healingFns.js'

export type { HullOptions } from '@faicad/faijs-brepjs/topology/hullFns.js'

export type { ChamferRadius } from '@faicad/faijs-brepjs/topology/index.js'

export type { GenericTopo } from '@faicad/faijs-brepjs/topology/index.js'

export type { RadiusOptions } from '@faicad/faijs-brepjs/topology/index.js'

export type { TopoEntity } from '@faicad/faijs-brepjs/topology/index.js'

export type { MeshCacheContext } from '@faicad/faijs-brepjs/topology/meshCache.js'

export type { EdgeMesh } from '@faicad/faijs-brepjs/topology/meshFns.js'

export type { LODMesh } from '@faicad/faijs-brepjs/topology/meshFns.js'

export type { MeshLevelFn } from '@faicad/faijs-brepjs/topology/meshFns.js'

export type { MeshLODsOptions } from '@faicad/faijs-brepjs/topology/meshFns.js'

export type { MeshLODsProgressiveOptions } from '@faicad/faijs-brepjs/topology/meshFns.js'

export type { MeshOptions } from '@faicad/faijs-brepjs/topology/meshFns.js'

export type { MultiLODMesh } from '@faicad/faijs-brepjs/topology/meshFns.js'

export type { ShapeMesh } from '@faicad/faijs-brepjs/topology/meshFns.js'

export type { Color } from '@faicad/faijs-brepjs/topology/metadata/colorFns.js'

export type { ColorInput } from '@faicad/faijs-brepjs/topology/metadata/colorFns.js'

export type { MinkowskiOptions } from '@faicad/faijs-brepjs/topology/minkowskiFns.js'

export type { VariableFilletRadius } from '@faicad/faijs-brepjs/topology/modifierFns.js'

export type { PolyhedronOptions } from '@faicad/faijs-brepjs/topology/polyhedronFns.js'

export type { BoxOptions } from '@faicad/faijs-brepjs/topology/primitiveFns.js'

export type { CircleOptions } from '@faicad/faijs-brepjs/topology/primitiveFns.js'

export type { ConeOptions } from '@faicad/faijs-brepjs/topology/primitiveFns.js'

export type { CylinderOptions } from '@faicad/faijs-brepjs/topology/primitiveFns.js'

export type { EllipseArcOptions } from '@faicad/faijs-brepjs/topology/primitiveFns.js'

export type { EllipseOptions } from '@faicad/faijs-brepjs/topology/primitiveFns.js'

export type { EllipsoidOptions } from '@faicad/faijs-brepjs/topology/primitiveFns.js'

export type { HelixOptions } from '@faicad/faijs-brepjs/topology/primitiveFns.js'

export type { SphereOptions } from '@faicad/faijs-brepjs/topology/primitiveFns.js'

export type { TorusOptions } from '@faicad/faijs-brepjs/topology/primitiveFns.js'

export type { ShapeDescription } from '@faicad/faijs-brepjs/topology/shapeFns.js'

export type { BrokenDerivedFaceRef } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { BrokenEdgeRef } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { BrokenReason } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { BrokenRef } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { BrokenVertexRef } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { DerivedFaceHint } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { DerivedFaceRef } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { EdgeHint } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { EdgeRef } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { FaceScorer } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { GeometricHint } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { LineageRef } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { LineageResolution } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { ResolvedDerivedFaceRef } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { ResolvedEdgeRef } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { ResolvedEntity } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { ResolvedRef } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { ResolvedVertexRef } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { RoleTable } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { ShapeRef } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { VertexHint } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { VertexRef } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export type { SurfaceFromGridOptions } from '@faicad/faijs-brepjs/topology/surfaceFns.js'

export type { SurfaceFromImageOptions } from '@faicad/faijs-brepjs/topology/surfaceFns.js'

export type { BufferGeometryData } from '@faicad/faijs-brepjs/topology/threeHelpers.js'

export type { BufferGeometryGroup } from '@faicad/faijs-brepjs/topology/threeHelpers.js'

export type { GroupedBufferGeometryData } from '@faicad/faijs-brepjs/topology/threeHelpers.js'

export type { LineGeometryData } from '@faicad/faijs-brepjs/topology/threeHelpers.js'

export type { LODGeometryData } from '@faicad/faijs-brepjs/topology/threeHelpers.js'

export type { LODGeometryLevel } from '@faicad/faijs-brepjs/topology/threeHelpers.js'

export type { Wrapped } from '@faicad/faijs-brepjs/topology/wrapperFns.js'

export type { Wrapped3D } from '@faicad/faijs-brepjs/topology/wrapperFns.js'

export type { WrappedCurve } from '@faicad/faijs-brepjs/topology/wrapperFns.js'

export type { WrappedFace } from '@faicad/faijs-brepjs/topology/wrapperFns.js'

/**
 * ellipsoid — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * ellipsoid(rx: number, ry: number, rz: number, options?: EllipsoidOptions): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const ellipsoid = compatOp(
  projectBrepOp('ellipsoid', ["rx","ry","rz","options"], 'A', __vendored_ellipsoid),
  { name: 'ellipsoid', naming: {"kind":"unmodeled","reason":"construct vocabulary pending Phase 3"}, engines: ["occt"] },
)

/**
 * rotate — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * rotate(shape: Shape, angle: number, options?: { at?, axis? }): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const rotate = compatOp(
  projectBrepOp('rotate', ["shape","angle","options"], 'A', __vendored_rotate),
  { name: 'rotate', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"] },
)

/**
 * mirror — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * mirror(shape: Shape, options?: MirrorOptions): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const mirror = compatOp(
  projectBrepOp('mirror', ["shape","options"], 'A', __vendored_mirror),
  { name: 'mirror', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"] },
)

/**
 * clone — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * clone(shape: Shape): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const clone = compatOp(
  projectBrepOp('clone', ["shape"], 'A', __vendored_clone),
  { name: 'clone', naming: {"kind":"identity"}, engines: ["occt"] },
)

/**
 * applyMatrix — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * applyMatrix(shape: Shape, matrix: unknown): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const applyMatrix = compatOp(
  projectBrepOp('applyMatrix', ["shape","matrix"], 'A', __vendored_applyMatrix),
  { name: 'applyMatrix', naming: {"kind":"identity"}, engines: ["occt"] },
)

/**
 * locate — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * locate(shape: Shape, placement: unknown): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const locate = compatOp(
  projectBrepOp('locate', ["shape","placement"], 'A', __vendored_locate),
  { name: 'locate', naming: {"kind":"identity"}, capabilities: ["composeTransform","dispose","hashCode","locate"] },
)

export { composeTransforms } from '@faicad/faijs-brepjs/topology/api.js'

/**
 * section — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * section(shape: Shape, plane: PlaneInput): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const section = compatOp(
  projectBrepOp('section', ["shape","plane"], 'A', __vendored_section),
  { name: 'section', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"] },
)

/**
 * split — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * split(shape: Shape, tools: Shape[]): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const split = compatOp(
  projectBrepOp('split', ["shape","tools"], 'A', __vendored_split),
  { name: 'split', naming: {"kind":"subdivide"}, engines: ["occt"] },
)

/**
 * shell — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * shell(shape: Shape, faces?: Shape[], thickness: number): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const shell = compatOp(
  projectBrepOp('shell', ["shape","faces","thickness"], 'A', __vendored_shell),
  { name: 'shell', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"] },
)

/**
 * offset — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * offset(shape: Shape, distance: number): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const offset = compatOp(
  projectBrepOp('offset', ["shape","distance"], 'A', __vendored_offset),
  { name: 'offset', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"] },
)

/**
 * heal — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * heal(shape: Shape): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const heal = compatOp(
  projectBrepOp('heal', ["shape"], 'A', __vendored_heal),
  { name: 'heal', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"] },
)

/**
 * simplify — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * simplify(shape: Shape): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const simplify = compatOp(
  projectBrepOp('simplify', ["shape"], 'A', __vendored_simplify),
  { name: 'simplify', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"] },
)

/**
 * isValid — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * isValid(shape: Shape): boolean
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（查询表达式承载）。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns boolean — 纯数据结果（非 Shape）。
 */
export function isValid(shape: Shape): boolean {

  return callBrepjs(__vendored_isValid, [borrowBrepjsShape(shape as Shape)])
}

/**
 * isEmpty — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * isEmpty(shape: Shape): boolean
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（查询表达式承载）。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns boolean — 纯数据结果（非 Shape）。
 */
export function isEmpty(shape: Shape): boolean {

  return callBrepjs(__vendored_isEmpty, [borrowBrepjsShape(shape as Shape)])
}

/**
 * isEqualShape — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * isEqualShape(a: Shape, b: Shape): boolean
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（查询表达式承载）。
 *
 * @param a - 可形状参数（第一个被比较形状）
 * @param b - 可形状参数（第二个被比较形状）
 * @returns boolean — 纯数据结果（非 Shape）。
 */
export function isEqualShape(a: Shape, b: Shape): boolean {

  return callBrepjs(__vendored_isEqualShape, [borrowBrepjsShape(a as Shape), borrowBrepjsShape(b as Shape)])
}

/**
 * isSameShape — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * isSameShape(a: Shape, b: Shape): boolean
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（查询表达式承载）。
 *
 * @param a - 可形状参数（第一个被比较形状）
 * @param b - 可形状参数（第二个被比较形状）
 * @returns boolean — 纯数据结果（非 Shape）。
 */
export function isSameShape(a: Shape, b: Shape): boolean {

  return callBrepjs(__vendored_isSameShape, [borrowBrepjsShape(a as Shape), borrowBrepjsShape(b as Shape)])
}

/**
 * autoHeal — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * autoHeal(shape: Shape, options?: AutoHealOptions): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const autoHeal = compatOp(
  projectBrepOp('autoHeal', ["shape","options"], 'A', __vendored_autoHeal),
  { name: 'autoHeal', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"] },
)

/**
 * fixShape — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * fixShape(shape: Shape): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const fixShape = compatOp(
  projectBrepOp('fixShape', ["shape"], 'A', __vendored_fixShape),
  { name: 'fixShape', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, capabilities: ["fixShape"] },
)

/**
 * healSolid — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * healSolid(solid: Shape): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const healSolid = compatOp(
  projectBrepOp('healSolid', ["solid"], 'A', __vendored_healSolid),
  { name: 'healSolid', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"] },
)

/**
 * fixSelfIntersection — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * fixSelfIntersection(shape: Shape): Shape
 * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。
 */
export const fixSelfIntersection = compatOp(
  projectBrepOp('fixSelfIntersection', ["shape"], 'A', __vendored_fixSelfIntersection),
  { name: 'fixSelfIntersection', naming: {"kind":"kernel","newFaces":{"via":"byAdjacency"}}, engines: ["occt"] },
)

export { isNumber } from '@faicad/faijs-brepjs/topology/index.js'

export { isChamferRadius } from '@faicad/faijs-brepjs/topology/index.js'

export { isFilletRadius } from '@faicad/faijs-brepjs/topology/index.js'

export { isLineageRef } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export { isFaceRef } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export { isEdgeRef } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export { isVertexRef } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'

export { isDerivedFaceRef } from '@faicad/faijs-brepjs/topology/shapeRef/index.js'
