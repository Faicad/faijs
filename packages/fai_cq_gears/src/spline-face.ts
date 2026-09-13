/**
 * spline-face — thin adapter over cq-compat's gear spline-face primitives.
 *
 * The three B-spline face strategies (probed in the v1 spike, 2026-09-08) moved
 * INTO cq-compat per the port plan (§4/§5): raw kernel knowledge lives there,
 * fai_cq_gears only consumes. This file preserves the v1 import names for
 * existing call sites and keeps the measurement helpers (they are test/report
 * tooling, not geometry ops — they stay in this package but consume the
 * cq-compat kernel type).
 *
 * | strategy | how | semantic delta vs cq |
 * |---|---|---|
 * | `grid-approx` | `kernel.bsplineSurface(flat, rows, cols)` | OCCT default DegMin/DegMax/Tol3D; cq passes 3/8/1e-2 explicitly |
 * | `row-approx-loft` | per-row `approximatePoints(row, tol)` → `loft(wires, false, false)` | curve-level tol same name/meaning; surface is skinned, not fitted at once |
 * | `row-interp-loft` | per-row `interpolatePoints(row)` → `loft` | passes through every sample point (interpolation) |
 */

import type { BrepHandle } from '@faicad/faijs-core'
import {
  buildGearSplineFace,
  gearDistanceToFace,
  gearFaceDeviation,
  soleGearFace as soleFace,
  DEFAULT_GEAR_SPLINE_FACE_STRATEGY,
  GEAR_SPLINE_FACE_STRATEGIES,
  type GearDeviationStats,
  type GearKernel,
  type GearSplineFaceOptions,
  type GearSplineFaceStrategy,
} from '@faicad/cq-compat'
import type { Vec3 } from './math'
import type { ToothGrid } from './profile'

export { soleFace }

export type SplineFaceStrategy = GearSplineFaceStrategy
export type SplineFaceOptions = GearSplineFaceOptions
export type DeviationStats = GearDeviationStats

/**
 * P0 实测选定的默认策略（2026-09-08）。
 *
 * 依据 `spline-face.test.ts` 的实测表：S2 的面积相对偏差 5.6e-7 / 采样点最大距离
 * 2.6e-6 mm，比 S1、S3 好约 3 个数量级。详见
 * `docs/analysis/2026-09-08-fai-cq-gears-spike.md`。
 */
export const DEFAULT_SPLINE_FACE_STRATEGY = DEFAULT_GEAR_SPLINE_FACE_STRATEGY

/** 全部可选策略（测试按此顺序遍历出偏差表）。 */
export const SPLINE_FACE_STRATEGIES = GEAR_SPLINE_FACE_STRATEGIES

/**
 * 用给定策略把一个 row×col 点阵建成面。
 *
 * @throws 内核抛错时原样上抛（不吞错误——这是红线）
 *
 * @param kernel 原始 OCCT 内核（经 cq-compat 的 `GearKernel`）
 * @param grid row×col 点阵
 * @param strategy 建面策略
 * @param options 容差/次数选项
 * @returns 单个面句柄（Face）
 */
export function buildSplineFace(
  kernel: GearKernel,
  grid: ToothGrid,
  strategy: SplineFaceStrategy,
  options: SplineFaceOptions = {},
): BrepHandle {
  return buildGearSplineFace(kernel, grid, strategy, options)
}

/** 点到面的最近距离（`projectPointOnFace`）。
 *
 * @param kernel 原始 OCCT 内核
 * @param face 目标面
 * @param p 查询点
 * @returns 欧氏距离（mm）
 */
export function distanceToFace(kernel: GearKernel, face: BrepHandle, p: Vec3): number {
  return gearDistanceToFace(kernel, face, p)
}

/** 距离统计（最大值 / RMS / 样本数）。 */

/**
 * 参考采样点到本面的距离统计。
 *
 * 参数化无关：采样点取自 cq 侧的 (u,v) 网格，两侧曲面参数化不同也能比。
 *
 * @param kernel 原始 OCCT 内核
 * @param face 本侧面
 * @param samplePoints 参考采样点（3D）
 * @returns 最大距离 / RMS / 样本数
 */
export function faceDeviation(
  kernel: GearKernel,
  face: BrepHandle,
  samplePoints: Vec3[],
): DeviationStats {
  return gearFaceDeviation(kernel, face, samplePoints)
}

/** 单个齿面的实测结果（面积 + 偏差 + 拓扑计数），供测试与报告使用。 */
export interface SplineFaceMeasurement {
  segment: string
  strategy: SplineFaceStrategy
  rows: number
  cols: number
  area: number
  isFace: boolean
  isValid: boolean
  deviation: DeviationStats
  /** Python 侧的参考面积（来自 manifest） */
  refArea: number
  /** 面积相对偏差 |Δ|/ref */
  areaRelDiff: number
}

/**
 * 建面并测量（参考面积与采样点由 Python 侧 manifest 提供）。
 *
 * @param kernel 原始 OCCT 内核
 * @param grid row×col 点阵
 * @param strategy 建面策略
 * @param ref 参考面积与采样点
 * @param options 容差/次数选项
 * @returns 实测结果（面积、偏差、拓扑计数）
 */
export function measureSplineFace(
  kernel: GearKernel,
  grid: ToothGrid,
  strategy: SplineFaceStrategy,
  ref: { area: number; sample_points: number[][] },
  options: SplineFaceOptions = {},
): SplineFaceMeasurement {
  const face = buildSplineFace(kernel, grid, strategy, options)
  const area = kernel.getSurfaceArea(face)
  const deviation = faceDeviation(
    kernel,
    face,
    ref.sample_points.map((p) => ({ x: p[0], y: p[1], z: p[2] })),
  )
  return {
    segment: grid.segment,
    strategy,
    rows: grid.rows,
    cols: grid.cols,
    area,
    isFace: kernel.isFace(face),
    isValid: kernel.isValid(face),
    deviation,
    refArea: ref.area,
    areaRelDiff: Math.abs(area - ref.area) / ref.area,
  }
}
