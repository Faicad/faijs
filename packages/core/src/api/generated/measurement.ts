/**
 * generated/measurement.ts — 生成文件，勿手改。
 * 由 packages/core/scripts/gen-l3-surface.ts 依据 api/surface/arg-spec.ts 生成（E5/P14 分片）。
 * measurement 模块：20 个投影符号；另有 1 个 skip 登记。
 */
import { borrowBrepjsShape, callBrepjs } from '../internal/l3-bridge'
import type { Shape } from '../../mesh/types'
import { measureVolumeProps as __vendored_measureVolumeProps } from '../../vendored/brepjs/measurement/measureFns.js'
import type { VolumeProps } from '../../vendored/brepjs/measurement/measureFns.js'
import { measureSurfaceProps as __vendored_measureSurfaceProps } from '../../vendored/brepjs/measurement/measureFns.js'
import type { SurfaceProps } from '../../vendored/brepjs/measurement/measureFns.js'
import { measureLinearProps as __vendored_measureLinearProps } from '../../vendored/brepjs/measurement/measureFns.js'
import type { LinearProps } from '../../vendored/brepjs/measurement/measureFns.js'
import { measureVolume as __vendored_measureVolume } from '../../vendored/brepjs/measurement/measureFns.js'
import { measureArea as __vendored_measureArea } from '../../vendored/brepjs/measurement/measureFns.js'
import { measureLength as __vendored_measureLength } from '../../vendored/brepjs/measurement/measureFns.js'
import { measureDistance as __vendored_measureDistance } from '../../vendored/brepjs/measurement/measureFns.js'
import { measureDistanceProps as __vendored_measureDistanceProps } from '../../vendored/brepjs/measurement/measureFns.js'
import type { DistanceProps } from '../../vendored/brepjs/measurement/measureFns.js'
import { measureCurvatureAt as __vendored_measureCurvatureAt } from '../../vendored/brepjs/measurement/measureFns.js'
import type { CurvatureResult } from '../../vendored/brepjs/measurement/measureFns.js'
import { measureCurvatureAtMid as __vendored_measureCurvatureAtMid } from '../../vendored/brepjs/measurement/measureFns.js'
import { checkInterference as __vendored_checkInterference } from '../../vendored/brepjs/measurement/interferenceFns.js'
import type { InterferenceResult } from '../../vendored/brepjs/measurement/interferenceFns.js'
import { checkAllInterferences as __vendored_checkAllInterferences } from '../../vendored/brepjs/measurement/interferenceFns.js'
import type { InterferencePair } from '../../vendored/brepjs/measurement/interferenceFns.js'

export type { CurvatureResult } from '../../vendored/brepjs/measurement/measureFns.js'

export type { DistanceProps } from '../../vendored/brepjs/measurement/measureFns.js'

export type { InterferencePair } from '../../vendored/brepjs/measurement/interferenceFns.js'

export type { InterferenceResult } from '../../vendored/brepjs/measurement/interferenceFns.js'

export type { LinearProps } from '../../vendored/brepjs/measurement/measureFns.js'

export type { PhysicalProps } from '../../vendored/brepjs/measurement/measureFns.js'

export type { SurfaceProps } from '../../vendored/brepjs/measurement/measureFns.js'

export type { VolumeProps } from '../../vendored/brepjs/measurement/measureFns.js'

/**
 * measureVolumeProps — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * (shape: Shape3D) -> Result<VolumeProps>
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（查询表达式承载）。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns VolumeProps — 纯数据结果（非 Shape）。
 */
export function measureVolumeProps(shape: Shape): VolumeProps {
  const __r = callBrepjs(__vendored_measureVolumeProps, [borrowBrepjsShape(shape as Shape)])
  if (!__r.ok) throw new Error('[faijs/generated] measureVolumeProps: query failed')
  return __r.value
}

/**
 * measureSurfaceProps — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * (shape: Face | Shape3D) -> Result<SurfaceProps>
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（查询表达式承载）。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns SurfaceProps — 纯数据结果（非 Shape）。
 */
export function measureSurfaceProps(shape: Shape): SurfaceProps {
  const __r = callBrepjs(__vendored_measureSurfaceProps, [borrowBrepjsShape(shape as Shape)])
  if (!__r.ok) throw new Error('[faijs/generated] measureSurfaceProps: query failed')
  return __r.value
}

/**
 * measureLinearProps — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * (shape: AnyShape) -> Result<LinearProps>
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（查询表达式承载）。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns LinearProps — 纯数据结果（非 Shape）。
 */
export function measureLinearProps(shape: Shape): LinearProps {
  const __r = callBrepjs(__vendored_measureLinearProps, [borrowBrepjsShape(shape as Shape)])
  if (!__r.ok) throw new Error('[faijs/generated] measureLinearProps: query failed')
  return __r.value
}

/**
 * measureVolume — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * (shape: Shape3D) -> Result<number>
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（查询表达式承载）。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns number — 纯数据结果（非 Shape）。
 */
export function measureVolume(shape: Shape): number {
  const __r = callBrepjs(__vendored_measureVolume, [borrowBrepjsShape(shape as Shape)])
  if (!__r.ok) throw new Error('[faijs/generated] measureVolume: query failed')
  return __r.value
}

/**
 * measureArea — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * (shape: Face | Shape3D) -> Result<number>
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（查询表达式承载）。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns number — 纯数据结果（非 Shape）。
 */
export function measureArea(shape: Shape): number {
  const __r = callBrepjs(__vendored_measureArea, [borrowBrepjsShape(shape as Shape)])
  if (!__r.ok) throw new Error('[faijs/generated] measureArea: query failed')
  return __r.value
}

/**
 * measureLength — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * (shape: AnyShape) -> Result<number>
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（查询表达式承载）。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns number — 纯数据结果（非 Shape）。
 */
export function measureLength(shape: Shape): number {
  const __r = callBrepjs(__vendored_measureLength, [borrowBrepjsShape(shape as Shape)])
  if (!__r.ok) throw new Error('[faijs/generated] measureLength: query failed')
  return __r.value
}

/**
 * measureDistance — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * (a: AnyShape, b: AnyShape) -> Result<number>
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（查询表达式承载）。
 *
 * @param a - 可形状参数（第一个被查询形状）
 * @param b - 可形状参数（第二个被查询形状）
 * @returns number — 纯数据结果（非 Shape）。
 */
export function measureDistance(a: Shape, b: Shape): number {
  const __r = callBrepjs(__vendored_measureDistance, [borrowBrepjsShape(a as Shape), borrowBrepjsShape(b as Shape)])
  if (!__r.ok) throw new Error('[faijs/generated] measureDistance: query failed')
  return __r.value
}

/**
 * measureDistanceProps — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * (a: AnyShape, b: AnyShape) -> Result<DistanceProps>
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（查询表达式承载）。
 *
 * @param a - 可形状参数（第一个被查询形状）
 * @param b - 可形状参数（第二个被查询形状）
 * @returns DistanceProps — 纯数据结果（非 Shape）。
 */
export function measureDistanceProps(a: Shape, b: Shape): DistanceProps {
  const __r = callBrepjs(__vendored_measureDistanceProps, [borrowBrepjsShape(a as Shape), borrowBrepjsShape(b as Shape)])
  if (!__r.ok) throw new Error('[faijs/generated] measureDistanceProps: query failed')
  return __r.value
}

/**
 * measureCurvatureAt — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * (face: OrientedFace, u: number, v: number) -> Result<CurvatureResult>
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（查询表达式承载）。
 *
 * @param face - 可形状参数（被查询的曲面/面）
 * @param u - 数值/选项参数（参数域 u）
 * @param v - 数值/选项参数（参数域 v）
 * @returns CurvatureResult — 纯数据结果（非 Shape）。
 */
export function measureCurvatureAt(face: Shape, u: number, v: number): CurvatureResult {
  const __r = callBrepjs(__vendored_measureCurvatureAt, [borrowBrepjsShape(face as Shape), u, v])
  if (!__r.ok) throw new Error('[faijs/generated] measureCurvatureAt: query failed')
  return __r.value
}

/**
 * measureCurvatureAtMid — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * (face: Face) -> Result<CurvatureResult>
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（查询表达式承载）。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns CurvatureResult — 纯数据结果（非 Shape）。
 */
export function measureCurvatureAtMid(shape: Shape): CurvatureResult {
  const __r = callBrepjs(__vendored_measureCurvatureAtMid, [borrowBrepjsShape(shape as Shape)])
  if (!__r.ok) throw new Error('[faijs/generated] measureCurvatureAtMid: query failed')
  return __r.value
}

/**
 * checkInterference — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * (a: AnyShape, b: AnyShape, tolerance?: number) -> Result<InterferenceResult>
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（查询表达式承载）。
 *
 * @param a - 可形状参数（第一个形状）
 * @param b - 可形状参数（第二个形状）
 * @param tolerance - 数值/选项参数（干涉距离阈值（缺省 1e-6））
 * @returns InterferenceResult — 纯数据结果（非 Shape）。
 */
export function checkInterference(a: Shape, b: Shape, tolerance?: number): InterferenceResult {
  const __r = callBrepjs(__vendored_checkInterference, [borrowBrepjsShape(a as Shape), borrowBrepjsShape(b as Shape), tolerance])
  if (!__r.ok) throw new Error('[faijs/generated] checkInterference: query failed')
  return __r.value
}

/**
 * checkAllInterferences — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。
 * (shapes: AnyShape[], tolerance?: number) -> InterferencePair[]
 * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（查询表达式承载）。
 *
 * @param shapes - Shape 数组（成对检测的形状数组）
 * @param tolerance - 数值/选项参数（干涉距离阈值（缺省 1e-6））
 * @returns InterferencePair[] — 纯数据结果（非 Shape）。
 */
export function checkAllInterferences(shapes: Shape[], tolerance?: number): InterferencePair[] {
  return callBrepjs(__vendored_checkAllInterferences, [(shapes as Shape[]).map((s) => borrowBrepjsShape(s)), tolerance])
}
