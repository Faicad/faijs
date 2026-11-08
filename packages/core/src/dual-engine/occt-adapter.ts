/**
 * dual-engine/occt-adapter — OCCT 双引擎适配器
 * @platform occt
 *
 * 实现 `DualEngineApi`：共享方法**复用 L1 occt 适配器**（`getBrepEngine('occt').primitives`，
 * 已含全部 OCCT 侧正确的句柄封送 / 单位换算），双引擎独有方法（loftSurface / ruledSurface /
 * offset）直连 `OcctKernel` 原生方法。
 *
 * 角度单位沿用 L1 / OCCT 内核约定：`rotate` 弧度、`revolveVec` / `draft` / `chamferDistAngle`
 * 度——适配器内部按内核方言消化，调用方无需感知（方案 §2.1 / §9 量纲纪律）。
 */

import type { BrepHandle } from '../brep/engine/types'
import { getBrepEngine } from '../brep/engine/registry'
import { getOcctKernel } from '../occt-kernel/occtKernel'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import type { DualEngineApi } from './api'

/** 句柄：L1 `BrepHandle`（不透明 number）→ OCCT `ShapeHandle`。 */
function toShape(x: BrepHandle): ShapeHandle {
  return x as unknown as ShapeHandle
}
/** 句柄组转换。 */
function toShapes(xs: BrepHandle[]): ShapeHandle[] {
  return xs.map(toShape)
}
/** 句柄：OCCT `ShapeHandle` → L1 `BrepHandle`。 */
function fromShape(x: ShapeHandle): BrepHandle {
  return x as unknown as BrepHandle
}

/**
 * 构造 OCCT 双引擎 API 实例。
 *
 * @returns 实现 `DualEngineApi` 的 OCCT 适配器。
 * @throws 当 'occt' 引擎未注册（宿主未装配 occt 适配器）时，由 `getBrepEngine` 抛错。
 */
export async function createOcctDualEngineApi(): Promise<DualEngineApi> {
  // 共享方法：直接复用 L1 occt 适配器（已含 OCCT 侧全部封送 / 单位换算）。
  const l1 = (await getBrepEngine('occt')).primitives
  // 双引擎独有方法：直连原始 OcctKernel。getOcctKernel() 在 L1 适配器解析时已初始化完成。
  const kernel: OcctKernel = getOcctKernel()

  return {
    ...l1,
    loftSurface: (wires: BrepHandle[], ruled?: boolean): BrepHandle =>
      fromShape(kernel.loft(toShapes(wires), false, ruled ?? false)),
    ruledSurface: (wires: BrepHandle[]): BrepHandle =>
      fromShape(kernel.loft(toShapes(wires), false, true)),
    offset: (solid: BrepHandle, distance: number, tolerance: number): BrepHandle =>
      fromShape(kernel.offset(toShape(solid), distance, tolerance)),
  }
}
