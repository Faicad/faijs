/**
 * generated/core.ts — 生成文件，勿手改。
 * 由 packages/core/scripts/gen-l3-surface.ts 依据 api/surface/arg-spec.ts 生成（E5/P14 分片）。
 * core 模块：115 个投影符号；另有 53 个 skip 登记。
 */
import { borrowBrepjsShape, callBrepjs } from '../internal/l3-bridge'
import type { Shape } from '../../mesh/types'
import { getShapeKind as __vendored_getShapeKind } from '../../vendored/brepjs/core/shapeTypes.js'
import type { ShapeKind } from '../../vendored/brepjs/core/shapeTypes.js'

export type { Curve2DHandle } from '../../vendored/brepjs/core/curve2dHandle.js'

export type { DimensionError } from '../../vendored/brepjs/core/dimensionTypes.js'

export type { RequireDimension } from '../../vendored/brepjs/core/dimensionTypes.js'

export type { SameDimension } from '../../vendored/brepjs/core/dimensionTypes.js'

export type { Deletable } from '../../vendored/brepjs/core/disposal.js'

export type { DisposalStats } from '../../vendored/brepjs/core/disposal.js'

export type { KernelHandle } from '../../vendored/brepjs/core/disposal.js'

export type { ShapeHandle } from '../../vendored/brepjs/core/disposal.js'

export type { BrepError } from '../../vendored/brepjs/core/errors.js'

export type { BrepErrorKind } from '../../vendored/brepjs/core/errors.js'

export type { Plane } from '../../vendored/brepjs/core/planeTypes.js'

export type { PlaneInput } from '../../vendored/brepjs/core/planeTypes.js'

export type { PlaneName } from '../../vendored/brepjs/core/planeTypes.js'

export type { Err } from '../../vendored/brepjs/core/result.js'

export type { Ok } from '../../vendored/brepjs/core/result.js'

export type { Result } from '../../vendored/brepjs/core/result.js'

export type { ResultPipeline } from '../../vendored/brepjs/core/result.js'

export type { Unit } from '../../vendored/brepjs/core/result.js'

export type { AnyShape } from '../../vendored/brepjs/core/shapeTypes.js'

export type { ClosedWire } from '../../vendored/brepjs/core/shapeTypes.js'

export type { Compound } from '../../vendored/brepjs/core/shapeTypes.js'

export type { CompSolid } from '../../vendored/brepjs/core/shapeTypes.js'

export type { CurveLike } from '../../vendored/brepjs/core/shapeTypes.js'

export type { Dimension } from '../../vendored/brepjs/core/shapeTypes.js'

export type { Edge } from '../../vendored/brepjs/core/shapeTypes.js'

export type { Face } from '../../vendored/brepjs/core/shapeTypes.js'

export type { ManifoldShell } from '../../vendored/brepjs/core/shapeTypes.js'

export type { OrientedFace } from '../../vendored/brepjs/core/shapeTypes.js'

export type { PlanarFace } from '../../vendored/brepjs/core/shapeTypes.js'

export type { PlanarWire } from '../../vendored/brepjs/core/shapeTypes.js'

export type { Shape1D } from '../../vendored/brepjs/core/shapeTypes.js'

export type { Shape3D } from '../../vendored/brepjs/core/shapeTypes.js'

export type { ShapeKind } from '../../vendored/brepjs/core/shapeTypes.js'

export type { Shell } from '../../vendored/brepjs/core/shapeTypes.js'

export type { Solid } from '../../vendored/brepjs/core/shapeTypes.js'

export type { UnknownDimShape } from '../../vendored/brepjs/core/shapeTypes.js'

export type { ValidSolid } from '../../vendored/brepjs/core/shapeTypes.js'

export type { Vertex } from '../../vendored/brepjs/core/shapeTypes.js'

export type { Wire } from '../../vendored/brepjs/core/shapeTypes.js'

export type { CurveType } from '../../vendored/brepjs/core/typeDiscriminants.js'

export type { DirectionInput } from '../../vendored/brepjs/index.js'

export type { Matrix4x4 } from '../../vendored/brepjs/core/types.js'

export type { MatrixInput } from '../../vendored/brepjs/core/types.js'

export type { MatrixTransform } from '../../vendored/brepjs/core/types.js'

export type { PointInput } from '../../vendored/brepjs/core/types.js'

export type { Vec2 } from '../../vendored/brepjs/core/types.js'

export type { Vec3 } from '../../vendored/brepjs/core/types.js'

export { DEG2RAD } from '../../vendored/brepjs/core/constants.js'

export { RAD2DEG } from '../../vendored/brepjs/core/constants.js'

export { HASH_CODE_MAX } from '../../vendored/brepjs/core/constants.js'

export { BrepBugError } from '../../vendored/brepjs/core/errors.js'

export { BrepErrorCode } from '../../vendored/brepjs/core/errors.js'

export { bug } from '../../vendored/brepjs/core/errors.js'

export { computationError } from '../../vendored/brepjs/core/errors.js'

export { ioError } from '../../vendored/brepjs/core/errors.js'

export { kernelError } from '../../vendored/brepjs/core/errors.js'

export { moduleInitError } from '../../vendored/brepjs/core/errors.js'

export { queryError } from '../../vendored/brepjs/core/errors.js'

export { sketcherStateError } from '../../vendored/brepjs/core/errors.js'

export { typeCastError } from '../../vendored/brepjs/core/errors.js'

export { unsupportedError } from '../../vendored/brepjs/core/errors.js'

export { validationError } from '../../vendored/brepjs/core/errors.js'

export { createNamedPlane } from '../../vendored/brepjs/core/planeOps.js'

export { createPlane } from '../../vendored/brepjs/core/planeOps.js'

export { makePlane } from '../../vendored/brepjs/core/planeOps.js'

export { pivotPlane } from '../../vendored/brepjs/core/planeOps.js'

export { resolvePlane } from '../../vendored/brepjs/core/planeOps.js'

export { translatePlane } from '../../vendored/brepjs/core/planeOps.js'

export { ok } from '../../vendored/brepjs/core/result.js'

export { err } from '../../vendored/brepjs/core/result.js'

export { OK } from '../../vendored/brepjs/core/result.js'

export { isOk } from '../../vendored/brepjs/core/result.js'

export { isErr } from '../../vendored/brepjs/core/result.js'

export { map } from '../../vendored/brepjs/core/result.js'

export { mapErr } from '../../vendored/brepjs/core/result.js'

export { mapBoth } from '../../vendored/brepjs/core/result.js'

export { andThen } from '../../vendored/brepjs/core/result.js'

export { flatMap } from '../../vendored/brepjs/core/result.js'

export { or } from '../../vendored/brepjs/core/result.js'

export { orElse } from '../../vendored/brepjs/core/result.js'

export { all } from '../../vendored/brepjs/core/result.js'

export { collect } from '../../vendored/brepjs/core/result.js'

export { tap } from '../../vendored/brepjs/core/result.js'

export { tapErr } from '../../vendored/brepjs/core/result.js'

export { flatten } from '../../vendored/brepjs/core/result.js'

export { fromNullable } from '../../vendored/brepjs/core/result.js'

export { unwrap } from '../../vendored/brepjs/core/result.js'

export { unwrapOr } from '../../vendored/brepjs/core/result.js'

export { unwrapOrElse } from '../../vendored/brepjs/core/result.js'

export { unwrapErr } from '../../vendored/brepjs/core/result.js'

export { match } from '../../vendored/brepjs/core/result.js'

export { tryCatch } from '../../vendored/brepjs/core/result.js'

export { tryCatchAsync } from '../../vendored/brepjs/core/result.js'

export { pipeline } from '../../vendored/brepjs/core/result.js'

export { zipResults } from '../../vendored/brepjs/index.js'

export { resolveDirection } from '../../vendored/brepjs/core/types.js'

export { toVec2 } from '../../vendored/brepjs/core/types.js'

export { toVec3 } from '../../vendored/brepjs/core/types.js'

export { vecAdd } from '../../vendored/brepjs/core/vecOps.js'

export { vecAngle } from '../../vendored/brepjs/core/vecOps.js'

export { vecCross } from '../../vendored/brepjs/core/vecOps.js'

export { vecDistance } from '../../vendored/brepjs/core/vecOps.js'

export { vecDot } from '../../vendored/brepjs/core/vecOps.js'

export { vecEquals } from '../../vendored/brepjs/core/vecOps.js'

export { vecIsZero } from '../../vendored/brepjs/core/vecOps.js'

export { vecLength } from '../../vendored/brepjs/core/vecOps.js'

export { vecLengthSq } from '../../vendored/brepjs/core/vecOps.js'

export { vecNegate } from '../../vendored/brepjs/core/vecOps.js'

export { vecNormalize } from '../../vendored/brepjs/core/vecOps.js'

export { vecProjectToPlane } from '../../vendored/brepjs/core/vecOps.js'

export { vecRepr } from '../../vendored/brepjs/core/vecOps.js'

export { vecRotate } from '../../vendored/brepjs/core/vecOps.js'

export { vecScale } from '../../vendored/brepjs/core/vecOps.js'

export { vecSub } from '../../vendored/brepjs/core/vecOps.js'

/**
 * getShapeKind — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * (shape: AnyShape) -> ShapeKind
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（查询表达式承载）。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns ShapeKind — 纯数据结果（非 Shape）。
 */
export function getShapeKind(shape: Shape): ShapeKind {
  return callBrepjs(__vendored_getShapeKind, [borrowBrepjsShape(shape as Shape)])
}
