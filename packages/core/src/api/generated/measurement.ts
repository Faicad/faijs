/**
 * generated/measurement.ts — 生成文件，勿手改。
 * 由 packages/core/scripts/gen-l3-surface.ts 依据 api/surface/arg-spec.ts 生成（E5/P14 分片）。
 * measurement 模块：11 个投影符号；另有 19 个 skip 登记。
 * A6（2026-10-06）口径指认：本文件是 brepjs 投影面的**增量**清单；脚本面全集的
 * 权威来源是 generated/script-face.ts + gen-symbol-table 产物
 * lang/symbol-table.generated.ts（cad 脚本面 95 op）。两个清单回答不同问题，
 * 互不为超集——禁止用本文件的名字反推脚本面能力。
 */
import { brepOf } from '../../shape'
import { getBrepApi } from '../../brep/handle-bridge'
import type { BrepHandle } from '../../brep/engine/types'
import type { Shape } from '../../mesh/types'

/**
 * measureVolumeProps — 查询（core selfhost，生成文件，勿手改；来源 api/surface/arg-spec.ts）。
 * (shape: Shape) -> { volume, centerOfMass }（core selfhost）
 * 桥接：getBrepApi().* 直连 occt 引擎（§5.5 第 2 条）——无 vendored 借入/调用。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns { volume: number; centerOfMass: { x: number; y: number; z: number } } — 纯数据结果（非 Shape）。
 */
export function measureVolumeProps(shape: Shape): { volume: number; centerOfMass: { x: number; y: number; z: number } } {
  const h0 = brepOf(shape as Shape) as BrepHandle
  return { volume: getBrepApi().getVolume(h0), centerOfMass: getBrepApi().getCenterOfMass(h0) }
}

/**
 * measureSurfaceProps — 查询（core selfhost，生成文件，勿手改；来源 api/surface/arg-spec.ts）。
 * (shape: Shape) -> { area }（core selfhost）
 * 桥接：getBrepApi().* 直连 occt 引擎（§5.5 第 2 条）——无 vendored 借入/调用。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns { area: number } — 纯数据结果（非 Shape）。
 */
export function measureSurfaceProps(shape: Shape): { area: number } {
  const h0 = brepOf(shape as Shape) as BrepHandle
  return { area: getBrepApi().getSurfaceArea(h0) }
}

/**
 * measureLinearProps — 查询（core selfhost，生成文件，勿手改；来源 api/surface/arg-spec.ts）。
 * (shape: Shape) -> { length }（core selfhost）
 * 桥接：getBrepApi().* 直连 occt 引擎（§5.5 第 2 条）——无 vendored 借入/调用。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns { length: number } — 纯数据结果（非 Shape）。
 */
export function measureLinearProps(shape: Shape): { length: number } {
  const h0 = brepOf(shape as Shape) as BrepHandle
  return { length: getBrepApi().getLength(h0) }
}

/**
 * measureVolume — 查询（core selfhost，生成文件，勿手改；来源 api/surface/arg-spec.ts）。
 * (shape: Shape) -> number（core selfhost）
 * 桥接：getBrepApi().* 直连 occt 引擎（§5.5 第 2 条）——无 vendored 借入/调用。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns number — 纯数据结果（非 Shape）。
 */
export function measureVolume(shape: Shape): number {
  const h0 = brepOf(shape as Shape) as BrepHandle
  return getBrepApi().getVolume(h0)
}

/**
 * measureArea — 查询（core selfhost，生成文件，勿手改；来源 api/surface/arg-spec.ts）。
 * (shape: Shape) -> number（core selfhost）
 * 桥接：getBrepApi().* 直连 occt 引擎（§5.5 第 2 条）——无 vendored 借入/调用。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns number — 纯数据结果（非 Shape）。
 */
export function measureArea(shape: Shape): number {
  const h0 = brepOf(shape as Shape) as BrepHandle
  return getBrepApi().getSurfaceArea(h0)
}

/**
 * measureLength — 查询（core selfhost，生成文件，勿手改；来源 api/surface/arg-spec.ts）。
 * (shape: Shape) -> number（core selfhost）
 * 桥接：getBrepApi().* 直连 occt 引擎（§5.5 第 2 条）——无 vendored 借入/调用。
 *
 * @param shape - 可形状参数（原样透传）
 * @returns number — 纯数据结果（非 Shape）。
 */
export function measureLength(shape: Shape): number {
  const h0 = brepOf(shape as Shape) as BrepHandle
  return getBrepApi().getLength(h0)
}

/**
 * inspectMassProps — 查询（core selfhost，生成文件，勿手改；来源 api/surface/arg-spec.ts）。
 * (shape: Shape) -> { volume, area, centerOfMass }（core selfhost）
 * 桥接：getBrepApi().* 直连 occt 引擎（§5.5 第 2 条）——无 vendored 借入/调用。
 *
 * @param shape - 可形状参数（目标实体（体积/质心/惯量/主轴））
 * @returns { volume: number; area: number; centerOfMass: { x: number; y: number; z: number } } — 纯数据结果（非 Shape）。
 */
export function inspectMassProps(shape: Shape): { volume: number; area: number; centerOfMass: { x: number; y: number; z: number } } {
  const h0 = brepOf(shape as Shape) as BrepHandle
  return { volume: getBrepApi().getVolume(h0), area: getBrepApi().getSurfaceArea(h0), centerOfMass: getBrepApi().getCenterOfMass(h0) }
}

export { area } from '../measurement/index.js'

export { length } from '../measurement/index.js'

export { volume } from '../measurement/index.js'

export { centerOfMass } from '../measurement/index.js'
