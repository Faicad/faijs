/**
 * generated/topology.ts — 生成文件，勿手改。
 * 由 packages/core/scripts/gen-l3-surface.ts 依据 api/surface/arg-spec.ts 生成（E5/P14 分片）。
 * topology 模块：131 个投影符号；另有 171 个 skip 登记。
 */
import { defineOp } from '../../sdk'
import { borrowBrepjsShape, adoptBrepjsProduct, callBrepjs } from '../internal/l3-bridge'
import type { Shape } from '../../mesh/types'
import { torus as __vendored_torus } from '../../vendored/brepjs/topology/primitiveFns.js'
import { fuse as __vendored_fuse } from '../../vendored/brepjs/topology/booleanFns.js'
import { getBounds as __vendored_getBounds } from '../../vendored/brepjs/topology/shapeFns.js'
import type { Bounds3D } from '../../vendored/brepjs/topology/shapeFns.js'
import { ellipsoid as __vendored_ellipsoid } from '../../vendored/brepjs/topology/primitiveFns.js'
import { rotate as __vendored_rotate } from '../../vendored/brepjs/topology/api.js'
import { mirror as __vendored_mirror } from '../../vendored/brepjs/topology/api.js'
import { clone as __vendored_clone } from '../../vendored/brepjs/topology/api.js'
import { applyMatrix as __vendored_applyMatrix } from '../../vendored/brepjs/topology/api.js'
import { transformCopy as __vendored_transformCopy } from '../../vendored/brepjs/topology/api.js'
import { locate as __vendored_locate } from '../../vendored/brepjs/topology/api.js'
import { cut as __vendored_cut } from '../../vendored/brepjs/topology/api.js'
import { section as __vendored_section } from '../../vendored/brepjs/topology/api.js'
import { split as __vendored_split } from '../../vendored/brepjs/topology/api.js'
import { fillet as __vendored_fillet } from '../../vendored/brepjs/topology/api.js'
import { shell as __vendored_shell } from '../../vendored/brepjs/topology/api.js'
import { offset as __vendored_offset } from '../../vendored/brepjs/topology/api.js'
import { heal as __vendored_heal } from '../../vendored/brepjs/topology/api.js'
import { simplify as __vendored_simplify } from '../../vendored/brepjs/topology/api.js'
import { isValid as __vendored_isValid } from '../../vendored/brepjs/topology/api.js'
import { isEmpty as __vendored_isEmpty } from '../../vendored/brepjs/topology/api.js'
import { isEqualShape as __vendored_isEqualShape } from '../../vendored/brepjs/topology/shapeFns.js'
import { isSameShape as __vendored_isSameShape } from '../../vendored/brepjs/topology/shapeFns.js'
import { autoHeal as __vendored_autoHeal } from '../../vendored/brepjs/topology/healingFns.js'
import { fixShape as __vendored_fixShape } from '../../vendored/brepjs/topology/healingFns.js'
import { healSolid as __vendored_healSolid } from '../../vendored/brepjs/topology/healingFns.js'
import { fixSelfIntersection as __vendored_fixSelfIntersection } from '../../vendored/brepjs/topology/healingFns.js'

export type { Bounds3D } from '../../vendored/brepjs/topology/shapeFns.js'

/**
 * torus — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * (majorRadius: number, minorRadius: number, options?: TorusOptions)
 * 桥接：几何输入借入 brepjs handle → 调 vendored → 产物 adopt（E5 模板）。
 */
export const torus = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args
    const __r = callBrepjs(__vendored_torus, __args)
    return adoptBrepjsProduct(__r)
  },
  consumes: "none"
})

/**
 * fuse — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * (a: Shape3D, b: Shape3D, options?: BooleanOptions) -> Result<Shape3D>
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const fuse = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0,1].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_fuse, __args)
    if (!__r.ok) throw new Error('[faijs/generated] fuse: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * getBounds — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * (shape: AnyShape) -> Bounds3D
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（consumes 语义由查询表达式承载）。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns Bounds3D — 纯数据结果（非 Shape）。
 */
export function getBounds(shape: Shape): Bounds3D {
  return callBrepjs(__vendored_getBounds, [borrowBrepjsShape(shape as Shape)])
}

export type { ComposedTransform } from '../../vendored/brepjs/topology/api.js'

export type { MirrorOptions } from '../../vendored/brepjs/topology/api.js'

export type { RotateOptions } from '../../vendored/brepjs/topology/api.js'

export type { ScaleOptions } from '../../vendored/brepjs/topology/api.js'

export type { TransformOp } from '../../vendored/brepjs/topology/api.js'

export type { BossOptions } from '../../vendored/brepjs/topology/apiTypes.js'

export type { ChamferDistance } from '../../vendored/brepjs/topology/apiTypes.js'

export type { DraftAngle } from '../../vendored/brepjs/topology/apiTypes.js'

export type { DraftOptions } from '../../vendored/brepjs/topology/apiTypes.js'

export type { DrawingLike } from '../../vendored/brepjs/topology/apiTypes.js'

export type { DrillOptions } from '../../vendored/brepjs/topology/apiTypes.js'

export type { FilletRadius } from '../../vendored/brepjs/topology/apiTypes.js'

export type { FinderFn } from '../../vendored/brepjs/topology/apiTypes.js'

export type { MirrorJoinOptions } from '../../vendored/brepjs/topology/apiTypes.js'

export type { PocketOptions } from '../../vendored/brepjs/topology/apiTypes.js'

export type { RectangularPatternOptions } from '../../vendored/brepjs/topology/apiTypes.js'

export type { Shapeable } from '../../vendored/brepjs/topology/apiTypes.js'

export type { WrappedMarker } from '../../vendored/brepjs/topology/apiTypes.js'

export type { BatchBisectResult } from '../../vendored/brepjs/topology/booleanBatchFns.js'

export type { BatchBisectTelemetry } from '../../vendored/brepjs/topology/booleanBatchFns.js'

export type { BooleanOptions } from '../../vendored/brepjs/topology/booleanFns.js'

export type { BooleanPipelineStep } from '../../vendored/brepjs/topology/booleanFns.js'

export type { PipelineOp } from '../../vendored/brepjs/topology/booleanFns.js'

export type { ApproximateCurveOptions } from '../../vendored/brepjs/topology/curveFns.js'

export type { InterpolateCurveOptions } from '../../vendored/brepjs/topology/curveFns.js'

export type { EvolutionResult } from '../../vendored/brepjs/topology/evolutionFns.js'

export type { PointProjectionResult } from '../../vendored/brepjs/topology/faceFns.js'

export type { UVBounds } from '../../vendored/brepjs/topology/faceFns.js'

export type { AutoHealOptions } from '../../vendored/brepjs/topology/healingFns.js'

export type { HealingReport } from '../../vendored/brepjs/topology/healingFns.js'

export type { HealingStepDiagnostic } from '../../vendored/brepjs/topology/healingFns.js'

export type { HullOptions } from '../../vendored/brepjs/topology/hullFns.js'

export type { ChamferRadius } from '../../vendored/brepjs/topology/index.js'

export type { GenericTopo } from '../../vendored/brepjs/topology/index.js'

export type { RadiusOptions } from '../../vendored/brepjs/topology/index.js'

export type { TopoEntity } from '../../vendored/brepjs/topology/index.js'

export type { MeshCacheContext } from '../../vendored/brepjs/topology/meshCache.js'

export type { EdgeMesh } from '../../vendored/brepjs/topology/meshFns.js'

export type { LODMesh } from '../../vendored/brepjs/topology/meshFns.js'

export type { MeshLevelFn } from '../../vendored/brepjs/topology/meshFns.js'

export type { MeshLODsOptions } from '../../vendored/brepjs/topology/meshFns.js'

export type { MeshLODsProgressiveOptions } from '../../vendored/brepjs/topology/meshFns.js'

export type { MeshOptions } from '../../vendored/brepjs/topology/meshFns.js'

export type { MultiLODMesh } from '../../vendored/brepjs/topology/meshFns.js'

export type { ShapeMesh } from '../../vendored/brepjs/topology/meshFns.js'

export type { Color } from '../../vendored/brepjs/topology/metadata/colorFns.js'

export type { ColorInput } from '../../vendored/brepjs/topology/metadata/colorFns.js'

export type { MinkowskiOptions } from '../../vendored/brepjs/topology/minkowskiFns.js'

export type { VariableFilletRadius } from '../../vendored/brepjs/topology/modifierFns.js'

export type { PolyhedronOptions } from '../../vendored/brepjs/topology/polyhedronFns.js'

export type { BoxOptions } from '../../vendored/brepjs/topology/primitiveFns.js'

export type { CircleOptions } from '../../vendored/brepjs/topology/primitiveFns.js'

export type { ConeOptions } from '../../vendored/brepjs/topology/primitiveFns.js'

export type { CylinderOptions } from '../../vendored/brepjs/topology/primitiveFns.js'

export type { EllipseArcOptions } from '../../vendored/brepjs/topology/primitiveFns.js'

export type { EllipseOptions } from '../../vendored/brepjs/topology/primitiveFns.js'

export type { EllipsoidOptions } from '../../vendored/brepjs/topology/primitiveFns.js'

export type { HelixOptions } from '../../vendored/brepjs/topology/primitiveFns.js'

export type { SphereOptions } from '../../vendored/brepjs/topology/primitiveFns.js'

export type { TorusOptions } from '../../vendored/brepjs/topology/primitiveFns.js'

export type { ShapeDescription } from '../../vendored/brepjs/topology/shapeFns.js'

export type { BrokenDerivedFaceRef } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { BrokenEdgeRef } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { BrokenReason } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { BrokenRef } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { BrokenVertexRef } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { DerivedFaceHint } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { DerivedFaceRef } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { EdgeHint } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { EdgeRef } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { FaceScorer } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { GeometricHint } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { LineageRef } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { LineageResolution } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { ResolvedDerivedFaceRef } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { ResolvedEdgeRef } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { ResolvedEntity } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { ResolvedRef } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { ResolvedVertexRef } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { RoleTable } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { ShapeRef } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { VertexHint } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { VertexRef } from '../../vendored/brepjs/topology/shapeRef/index.js'

export type { SurfaceFromGridOptions } from '../../vendored/brepjs/topology/surfaceFns.js'

export type { SurfaceFromImageOptions } from '../../vendored/brepjs/topology/surfaceFns.js'

export type { BufferGeometryData } from '../../vendored/brepjs/topology/threeHelpers.js'

export type { BufferGeometryGroup } from '../../vendored/brepjs/topology/threeHelpers.js'

export type { GroupedBufferGeometryData } from '../../vendored/brepjs/topology/threeHelpers.js'

export type { LineGeometryData } from '../../vendored/brepjs/topology/threeHelpers.js'

export type { LODGeometryData } from '../../vendored/brepjs/topology/threeHelpers.js'

export type { LODGeometryLevel } from '../../vendored/brepjs/topology/threeHelpers.js'

export type { Wrapped } from '../../vendored/brepjs/topology/wrapperFns.js'

export type { Wrapped3D } from '../../vendored/brepjs/topology/wrapperFns.js'

export type { WrappedCurve } from '../../vendored/brepjs/topology/wrapperFns.js'

export type { WrappedFace } from '../../vendored/brepjs/topology/wrapperFns.js'

/**
 * ellipsoid — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * ellipsoid(rx: number, ry: number, rz: number, options?: EllipsoidOptions): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → 产物 adopt（E5 模板）。
 */
export const ellipsoid = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args
    const __r = callBrepjs(__vendored_ellipsoid, __args)
    return adoptBrepjsProduct(__r)
  },
  consumes: "none"
})

/**
 * rotate — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * rotate(shape: Shape, angle: number, options?: { at?, axis? }): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → 产物 adopt（E5 模板）。
 */
export const rotate = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_rotate, __args)
    return adoptBrepjsProduct(__r)
  },
  consumes: "all"
})

/**
 * mirror — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * mirror(shape: Shape, options?: MirrorOptions): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → 产物 adopt（E5 模板）。
 */
export const mirror = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_mirror, __args)
    return adoptBrepjsProduct(__r)
  },
  consumes: "all"
})

/**
 * clone — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * clone(shape: Shape): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const clone = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_clone, __args)
    if (!__r.ok) throw new Error('[faijs/generated] clone: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * applyMatrix — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * applyMatrix(shape: Shape, matrix: unknown): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const applyMatrix = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_applyMatrix, __args)
    if (!__r.ok) throw new Error('[faijs/generated] applyMatrix: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * transformCopy — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * transformCopy(shape: Shape, composed: ComposedTransform): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → 产物 adopt（E5 模板）。
 */
export const transformCopy = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_transformCopy, __args)
    return adoptBrepjsProduct(__r)
  },
  consumes: "all"
})

/**
 * locate — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * locate(shape: Shape, placement: unknown): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → 产物 adopt（E5 模板）。
 */
export const locate = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_locate, __args)
    return adoptBrepjsProduct(__r)
  },
  consumes: "all"
})

export { composeTransforms } from '../../vendored/brepjs/topology/api.js'

/**
 * cut — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * cut(base: Shape, tool: Shape, options?: BooleanOptions): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const cut = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0,1].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_cut, __args)
    if (!__r.ok) throw new Error('[faijs/generated] cut: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * section — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * section(shape: Shape, plane: PlaneInput): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const section = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_section, __args)
    if (!__r.ok) throw new Error('[faijs/generated] section: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * split — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * split(shape: Shape, tools: Shape[]): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const split = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_split, __args)
    if (!__r.ok) throw new Error('[faijs/generated] split: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * fillet — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * fillet(shape: Shape, edges?, radius | [r1,r2]): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const fillet = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_fillet, __args)
    if (!__r.ok) throw new Error('[faijs/generated] fillet: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * shell — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * shell(shape: Shape, faces?: Shape[], thickness: number): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const shell = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_shell, __args)
    if (!__r.ok) throw new Error('[faijs/generated] shell: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * offset — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * offset(shape: Shape, distance: number): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const offset = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_offset, __args)
    if (!__r.ok) throw new Error('[faijs/generated] offset: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * heal — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * heal(shape: Shape): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const heal = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_heal, __args)
    if (!__r.ok) throw new Error('[faijs/generated] heal: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * simplify — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * simplify(shape: Shape): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const simplify = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_simplify, __args)
    if (!__r.ok) throw new Error('[faijs/generated] simplify: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * isValid — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * isValid(shape: Shape): boolean
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（consumes 语义由查询表达式承载）。
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
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（consumes 语义由查询表达式承载）。
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
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（consumes 语义由查询表达式承载）。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns boolean — 纯数据结果（非 Shape）。
 */
export function isEqualShape(shape: Shape): boolean {
  return callBrepjs(__vendored_isEqualShape, [borrowBrepjsShape(shape as Shape)])
}

/**
 * isSameShape — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * isSameShape(a: Shape, b: Shape): boolean
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（consumes 语义由查询表达式承载）。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns boolean — 纯数据结果（非 Shape）。
 */
export function isSameShape(shape: Shape): boolean {
  return callBrepjs(__vendored_isSameShape, [borrowBrepjsShape(shape as Shape)])
}

/**
 * autoHeal — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * autoHeal(shape: Shape, options?: AutoHealOptions): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const autoHeal = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_autoHeal, __args)
    if (!__r.ok) throw new Error('[faijs/generated] autoHeal: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * fixShape — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * fixShape(shape: Shape): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const fixShape = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_fixShape, __args)
    if (!__r.ok) throw new Error('[faijs/generated] fixShape: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * healSolid — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * healSolid(solid: Shape): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const healSolid = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_healSolid, __args)
    if (!__r.ok) throw new Error('[faijs/generated] healSolid: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

/**
 * fixSelfIntersection — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * fixSelfIntersection(shape: Shape): Shape
 * 桥接：几何输入借入 brepjs handle → 调 vendored → Result 翻转 → adopt（E5 模板）。
 */
export const fixSelfIntersection = defineOp({
  brep: (...args: unknown[]) => {
    const __args = args.map((__a, __i) => ([0].includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))
    const __r = callBrepjs(__vendored_fixSelfIntersection, __args)
    if (!__r.ok) throw new Error('[faijs/generated] fixSelfIntersection: ' + (__r.error?.message ?? 'vendored op failed'))
    return adoptBrepjsProduct(__r.value)
  },
  consumes: "all"
})

export { isNumber } from '../../vendored/brepjs/topology/index.js'

export { isChamferRadius } from '../../vendored/brepjs/topology/index.js'

export { isFilletRadius } from '../../vendored/brepjs/topology/index.js'

export { isLineageRef } from '../../vendored/brepjs/topology/shapeRef/index.js'

export { isFaceRef } from '../../vendored/brepjs/topology/shapeRef/index.js'

export { isEdgeRef } from '../../vendored/brepjs/topology/shapeRef/index.js'

export { isVertexRef } from '../../vendored/brepjs/topology/shapeRef/index.js'

export { isDerivedFaceRef } from '../../vendored/brepjs/topology/shapeRef/index.js'
