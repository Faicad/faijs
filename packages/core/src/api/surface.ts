/**
 * api surface — B 样条曲面（控制点阵 → 面），平台 op engines:['occt']
 *
 * @platform occt — 实现走 occt-wasm 原生 `bsplineSurface`（BRepBuilderAPI 网格
 * 控制点建面；L1 契约无对应成员）⇒ 平台 op：defineOp 声明 `engines: ['occt']`（D11）。
 * 非 occt 引擎（brepkit）执行前报 BrepUnsupportedError（D11-4）；brep_mock 受 D11-3
 * 豁免不拦截。
 *
 * 用途：点阵（高度采样网格）→ 精确 B 样条面，是 heightmap 链路的落点。产物是
 * **面**（非实体），沿用 api/profile.ts 的 `fromBrep(solidToShape(...), { solid })`
 * 形态。
 *
 * 与既有 op 的边界：与 `cad.sweep` 的 `surface` 支撑面选项不同——那是扫掠的一个
 * 选项，本 op 是独立的曲面构造能力。
 */

import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import { solidToShape } from '../brep/brep-ops'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrep } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { getOcctKernel } from '../occt-kernel/occtKernel'

/** `cad.surface` 参数。 */
export interface SurfaceOptions {
  /** 控制点阵（`rows * cols` 个 `[x, y, z]`，按行优先展开）。 */
  points: readonly (readonly [number, number, number])[]
  /** 控制点行数（整数 >= 2）。 */
  rows: number
  /** 控制点列数（整数 >= 2）。 */
  cols: number
}

/** BREP 路径：用 occt 原生 bsplineSurface 建面，收养句柄。 */
function surfaceBrep(opts: SurfaceOptions): Shape {
  const { points, rows, cols } = opts ?? ({} as SurfaceOptions)
  if (!Array.isArray(points) || points.length === 0) {
    throw new Error('E_SURFACE_NO_POINTS: surface requires a non-empty control-point grid')
  }
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 2 || cols < 2) {
    throw new Error('E_SURFACE_BAD_SHAPE: surface.rows / surface.cols must be integers >= 2')
  }
  if (points.length !== rows * cols) {
    throw new Error(
      `E_SURFACE_POINT_COUNT: expected rows*cols = ${rows * cols} control points, got ${points.length}`,
    )
  }
  for (const p of points) {
    if (!Array.isArray(p) || p.length !== 3 || !p.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      throw new Error('E_SURFACE_BAD_POINT: each control point must be a finite [x, y, z] triple')
    }
  }
  const kernel = getBrepApi()
  const occt = getOcctKernel()
  const handle = occt.bsplineSurface(
    points.map(([x, y, z]) => ({ x, y, z })),
    rows,
    cols,
  ) as unknown as BrepHandle
  return fromBrep(solidToShape(kernel, handle), { solid: handle }) as Shape
}

/**
 * 由控制点阵构造 B 样条曲面。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name surface
 * @note 平台 op：仅 occt 引擎（原生 bsplineSurface）。非 occt 引擎执行前报错；brep_mock 不拦截。
 * @returns Shape 曲面（面产物，可作 thicken/sweep 的输入）。
 * @param points - 控制点阵（`rows * cols` 个 `[x, y, z]`，按行优先展开）。type:Vec3[] required:true
 * @param rows - 控制点行数（整数 >= 2）。type:number required:true
 * @param cols - 控制点列数（整数 >= 2）。type:number required:true
 * @example
 * const s = cad.surface({ points: [[-5,-5,0],[5,-5,0],[-5,5,0],[5,5,0]], rows: 2, cols: 2 })
 */
export const surface = defineOp({
  name: 'surface',
  brep(opts: SurfaceOptions) {
    return surfaceBrep(opts)
  },
  engines: ['occt'],
  naming: { kind: 'unmodeled', reason: 'bspline-surface face vocabulary not defined' } as Provenance,
})
