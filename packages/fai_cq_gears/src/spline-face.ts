/**
 * spline-face — CadQuery `Face.makeSplineApprox` 的 faijs 等价物（三方案）
 *
 * ## 背景（2026-09-08 实测）
 *
 * cq 的实现（`C:\git\CADQ\cadquery\cadquery\occ_impl\shapes.py:3618`）：
 * ```
 * GeomAPI_PointsToBSplineSurface(TColgp_HArray2OfPnt, DegMin=3, DegMax=8, Tol3D=1e-2)
 *   → BRepBuilderAPI_MakeFace(surface, Precision::Confusion())
 * ```
 * faijs **没有** `Face.makeSplineApprox`；`occt-wasm` 是预编译 wasm，不能加内核方法。
 * 因此只能组合现有绑定，本文件把候选方案固化成可切换、可实测的实现：
 *
 * | 策略 | 做法 | 与 cq 的语义差 |
 * |---|---|---|
 * | `grid-approx` | `kernel.bsplineSurface(flat, rows, cols)`（内部同样是 `GeomAPI_PointsToBSplineSurface`） | 用 OCCT **默认** DegMin/DegMax/Tol3D，cq 显式传 3/8/1e-2 |
 * | `row-approx-loft` | 逐行 `approximatePoints(row, tol)` → `loft(wires, false, false)` | 曲线级 tol 与 cq 同名同义；曲面是蒙皮而非一次性拟合 |
 * | `row-interp-loft` | 逐行 `interpolatePoints(row)` → `loft` | 过所有采样点（插值而非逼近） |
 *
 * 选哪个由 `spline-face.test.ts` 的**实测偏差**决定（面积 + 采样点距离），不靠推理。
 */

import type { BrepHandle } from '@faicad/faijs-core'
import type { RawOcctKernel } from './kernel'
import type { Vec3 } from './math'
import type { ToothGrid } from './profile'

/** 齿面 B-spline 建面策略（与文件头表格一一对应）。 */
export type SplineFaceStrategy = 'grid-approx' | 'row-approx-loft' | 'row-interp-loft'

/** 全部可选策略（测试按此顺序遍历出偏差表）。 */
export const SPLINE_FACE_STRATEGIES: readonly SplineFaceStrategy[] = [
  'grid-approx',
  'row-approx-loft',
  'row-interp-loft',
]

/**
 * P0 实测选定的默认策略（2026-09-08）。
 *
 * 依据 `spline-face.test.ts` 的实测表：S2 的面积相对偏差 5.6e-7 / 采样点最大距离
 * 2.6e-6 mm，比 S1、S3 好约 3 个数量级。详见
 * `docs/analysis/2026-09-08-fai-cq-gears-spike.md`。
 */
export const DEFAULT_SPLINE_FACE_STRATEGY: SplineFaceStrategy = 'row-approx-loft'

/** 建面选项（容差与次数，语义对齐 cq `makeSplineApprox` 的入参）。 */
export interface SplineFaceOptions {
  /** 逼近容差（mm）。cq 的 `spline_approx_tol`，默认 1e-2。 */
  tolerance?: number
  /** 曲面最小次数（cq: 3）——仅 `grid-approx`/`row-approx-loft` 语义相关。 */
  minDeg?: number
  /** 曲面最大次数（cq: 8）。 */
  maxDeg?: number
}

/**
 * 用给定策略把一个 row×col 点阵建成面。
 *
 * @throws 内核抛错时原样上抛（不吞错误——这是红线）
 *
 * @param kernel 原始 OCCT 内核
 * @param grid row×col 点阵
 * @param strategy 建面策略
 * @param options 容差/次数选项
 * @returns 单个面句柄（Face）
 */
export function buildSplineFace(
  kernel: RawOcctKernel,
  grid: ToothGrid,
  strategy: SplineFaceStrategy,
  options: SplineFaceOptions = {},
): BrepHandle {
  const tol = options.tolerance ?? 1e-2
  switch (strategy) {
    case 'grid-approx':
      return buildGridApprox(kernel, grid)
    case 'row-approx-loft':
      return buildRowLoft(kernel, grid, (row) => kernel.approximatePoints(row, tol))
    case 'row-interp-loft':
      return buildRowLoft(kernel, grid, (row) => kernel.interpolatePoints(row, false))
  }
}

/** S1：整块点阵一次性拟合成 B-spline 曲面。 */
function buildGridApprox(kernel: RawOcctKernel, grid: ToothGrid): BrepHandle {
  const flat: Vec3[] = []
  for (const row of grid.points) for (const p of row) flat.push(p)
  return kernel.bsplineSurface(flat, grid.rows, grid.cols)
}

/** S2/S3：逐行建曲线 → `loft` 蒙皮。 */
function buildRowLoft(
  kernel: RawOcctKernel,
  grid: ToothGrid,
  makeCurve: (row: Vec3[]) => BrepHandle,
): BrepHandle {
  const wires = grid.points.map((row) => kernel.makeWire([makeCurve(row)]))
  // `loft(wires, isSolid=false, ruled=false)` 返回的是 **shell**（实测 2026-09-08），
  // 而 cq 的齿面是 TopoDS_Face；下游 sew / projectPointOnFace 都要求 Face，故取出唯一面。
  return soleFace(kernel, kernel.loft(wires, false, false))
}

/**
 * 把「单面 shell」规约为 Face；本来就是 Face 则原样返回。
 *
 * @throws 面数不为 1 时抛错（不静默取第一个——那是掩盖问题的做法）
 *
 * @param kernel 原始 OCCT 内核
 * @param shape 任意 shape（Face / 单面 shell / …）
 * @returns 唯一的那个 Face
 */
export function soleFace(kernel: RawOcctKernel, shape: BrepHandle): BrepHandle {
  if (kernel.isFace(shape)) return shape
  const faces = kernel.getSubShapes(shape, 'face')
  if (faces.length !== 1) {
    throw new Error(
      `soleFace: expected a single face, got ${faces.length} (shapeType=${String(kernel.getShapeType(shape))})`,
    )
  }
  return faces[0]
}

/** 点到面的最近距离（`projectPointOnFace`）。
 *
 * @param kernel 原始 OCCT 内核
 * @param face 目标面
 * @param p 查询点
 * @returns 欧氏距离（mm）
 */
export function distanceToFace(kernel: RawOcctKernel, face: BrepHandle, p: Vec3): number {
  const q = kernel.projectPointOnFace(face, p)
  return Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z)
}

/** 距离统计（最大值 / RMS / 样本数）。 */
export interface DeviationStats {
  max: number
  rms: number
  n: number
}

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
  kernel: RawOcctKernel,
  face: BrepHandle,
  samplePoints: Vec3[],
): DeviationStats {
  let max = 0
  let sumSq = 0
  for (const p of samplePoints) {
    const d = distanceToFace(kernel, face, p)
    if (d > max) max = d
    sumSq += d * d
  }
  return { max, rms: Math.sqrt(sumSq / samplePoints.length), n: samplePoints.length }
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
  kernel: RawOcctKernel,
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
