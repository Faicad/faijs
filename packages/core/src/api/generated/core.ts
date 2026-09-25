/**
 * generated/core.ts — 生成文件，勿手改。
 * 由 packages/core/scripts/gen-l3-surface.ts 依据 api/surface/arg-spec.ts 生成（E5/P14 分片）。
 * core 模块：115 个投影符号；另有 53 个 skip 登记。
 */
import { borrowBrepjsShape, callBrepjs } from '../internal/l3-bridge'
import type { Shape } from '../../mesh/types'
import { getShapeKind as __vendored_getShapeKind } from '@faicad/faijs-brepjs/core/shapeTypes.js'
import type { ShapeKind } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { Curve2DHandle } from '@faicad/faijs-brepjs/core/curve2dHandle.js'

export type { DimensionError } from '@faicad/faijs-brepjs/core/dimensionTypes.js'

export type { RequireDimension } from '@faicad/faijs-brepjs/core/dimensionTypes.js'

export type { SameDimension } from '@faicad/faijs-brepjs/core/dimensionTypes.js'

export type { Deletable } from '@faicad/faijs-brepjs/core/disposal.js'

export type { DisposalStats } from '@faicad/faijs-brepjs/core/disposal.js'

export type { KernelHandle } from '@faicad/faijs-brepjs/core/disposal.js'

export type { ShapeHandle } from '@faicad/faijs-brepjs/core/disposal.js'

export type { BrepError } from '@faicad/faijs-brepjs/core/errors.js'

export type { BrepErrorKind } from '@faicad/faijs-brepjs/core/errors.js'

export type { Plane } from '@faicad/faijs-brepjs/core/planeTypes.js'

export type { PlaneInput } from '@faicad/faijs-brepjs/core/planeTypes.js'

export type { PlaneName } from '@faicad/faijs-brepjs/core/planeTypes.js'

export type { Err } from '@faicad/faijs-brepjs/core/result.js'

export type { Ok } from '@faicad/faijs-brepjs/core/result.js'

export type { Result } from '@faicad/faijs-brepjs/core/result.js'

export type { ResultPipeline } from '@faicad/faijs-brepjs/core/result.js'

export type { Unit } from '@faicad/faijs-brepjs/core/result.js'

export type { AnyShape } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { ClosedWire } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { Compound } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { CompSolid } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { CurveLike } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { Dimension } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { Edge } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { Face } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { ManifoldShell } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { OrientedFace } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { PlanarFace } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { PlanarWire } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { Shape1D } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { Shape3D } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { ShapeKind } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { Shell } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { Solid } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { UnknownDimShape } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { ValidSolid } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { Vertex } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { Wire } from '@faicad/faijs-brepjs/core/shapeTypes.js'

export type { CurveType } from '@faicad/faijs-brepjs/core/typeDiscriminants.js'

export type { DirectionInput } from '@faicad/faijs-brepjs/index.js'

export type { Matrix4x4 } from '@faicad/faijs-brepjs/core/types.js'

export type { MatrixInput } from '@faicad/faijs-brepjs/core/types.js'

export type { MatrixTransform } from '@faicad/faijs-brepjs/core/types.js'

export type { PointInput } from '@faicad/faijs-brepjs/core/types.js'

export type { Vec2 } from '@faicad/faijs-brepjs/core/types.js'

export type { Vec3 } from '@faicad/faijs-brepjs/core/types.js'

export { DEG2RAD } from '@faicad/faijs-brepjs/core/constants.js'

export { RAD2DEG } from '@faicad/faijs-brepjs/core/constants.js'

export { HASH_CODE_MAX } from '@faicad/faijs-brepjs/core/constants.js'

export { BrepBugError } from '@faicad/faijs-brepjs/core/errors.js'

export { BrepErrorCode } from '@faicad/faijs-brepjs/core/errors.js'

export { bug } from '@faicad/faijs-brepjs/core/errors.js'

export { computationError } from '@faicad/faijs-brepjs/core/errors.js'

export { ioError } from '@faicad/faijs-brepjs/core/errors.js'

export { kernelError } from '@faicad/faijs-brepjs/core/errors.js'

export { moduleInitError } from '@faicad/faijs-brepjs/core/errors.js'

export { queryError } from '@faicad/faijs-brepjs/core/errors.js'

export { sketcherStateError } from '@faicad/faijs-brepjs/core/errors.js'

export { typeCastError } from '@faicad/faijs-brepjs/core/errors.js'

export { unsupportedError } from '@faicad/faijs-brepjs/core/errors.js'

export { validationError } from '@faicad/faijs-brepjs/core/errors.js'

export { createNamedPlane } from '@faicad/faijs-brepjs/core/planeOps.js'

export { createPlane } from '@faicad/faijs-brepjs/core/planeOps.js'

export { makePlane } from '@faicad/faijs-brepjs/core/planeOps.js'

export { pivotPlane } from '@faicad/faijs-brepjs/core/planeOps.js'

export { resolvePlane } from '@faicad/faijs-brepjs/core/planeOps.js'

export { translatePlane } from '@faicad/faijs-brepjs/core/planeOps.js'

export { ok } from '@faicad/faijs-brepjs/core/result.js'

export { err } from '@faicad/faijs-brepjs/core/result.js'

export { OK } from '@faicad/faijs-brepjs/core/result.js'

export { isOk } from '@faicad/faijs-brepjs/core/result.js'

export { isErr } from '@faicad/faijs-brepjs/core/result.js'

export { map } from '@faicad/faijs-brepjs/core/result.js'

export { mapErr } from '@faicad/faijs-brepjs/core/result.js'

export { mapBoth } from '@faicad/faijs-brepjs/core/result.js'

export { andThen } from '@faicad/faijs-brepjs/core/result.js'

export { flatMap } from '@faicad/faijs-brepjs/core/result.js'

export { or } from '@faicad/faijs-brepjs/core/result.js'

export { orElse } from '@faicad/faijs-brepjs/core/result.js'

export { all } from '@faicad/faijs-brepjs/core/result.js'

export { collect } from '@faicad/faijs-brepjs/core/result.js'

export { tap } from '@faicad/faijs-brepjs/core/result.js'

export { tapErr } from '@faicad/faijs-brepjs/core/result.js'

export { flatten } from '@faicad/faijs-brepjs/core/result.js'

export { fromNullable } from '@faicad/faijs-brepjs/core/result.js'

export { unwrap } from '@faicad/faijs-brepjs/core/result.js'

export { unwrapOr } from '@faicad/faijs-brepjs/core/result.js'

export { unwrapOrElse } from '@faicad/faijs-brepjs/core/result.js'

export { unwrapErr } from '@faicad/faijs-brepjs/core/result.js'

export { match } from '@faicad/faijs-brepjs/core/result.js'

export { tryCatch } from '@faicad/faijs-brepjs/core/result.js'

export { tryCatchAsync } from '@faicad/faijs-brepjs/core/result.js'

export { pipeline } from '@faicad/faijs-brepjs/core/result.js'

export { zipResults } from '@faicad/faijs-brepjs/index.js'

export { resolveDirection } from '@faicad/faijs-brepjs/core/types.js'

export { toVec2 } from '@faicad/faijs-brepjs/core/types.js'

export { toVec3 } from '@faicad/faijs-brepjs/core/types.js'

export { vecAdd } from '@faicad/faijs-brepjs/core/vecOps.js'

export { vecAngle } from '@faicad/faijs-brepjs/core/vecOps.js'

export { vecCross } from '@faicad/faijs-brepjs/core/vecOps.js'

export { vecDistance } from '@faicad/faijs-brepjs/core/vecOps.js'

export { vecDot } from '@faicad/faijs-brepjs/core/vecOps.js'

export { vecEquals } from '@faicad/faijs-brepjs/core/vecOps.js'

export { vecIsZero } from '@faicad/faijs-brepjs/core/vecOps.js'

export { vecLength } from '@faicad/faijs-brepjs/core/vecOps.js'

export { vecLengthSq } from '@faicad/faijs-brepjs/core/vecOps.js'

export { vecNegate } from '@faicad/faijs-brepjs/core/vecOps.js'

export { vecNormalize } from '@faicad/faijs-brepjs/core/vecOps.js'

export { vecProjectToPlane } from '@faicad/faijs-brepjs/core/vecOps.js'

export { vecRepr } from '@faicad/faijs-brepjs/core/vecOps.js'

export { vecRotate } from '@faicad/faijs-brepjs/core/vecOps.js'

export { vecScale } from '@faicad/faijs-brepjs/core/vecOps.js'

export { vecSub } from '@faicad/faijs-brepjs/core/vecOps.js'

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
