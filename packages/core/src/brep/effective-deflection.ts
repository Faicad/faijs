/**
 * effective-deflection — 三角化偏差计算（引擎中立）
 *
 * 从 `occt-kernel/occtKernel.ts` 提出来：函数体只用 `getBoundingBox` 一个方法，
 * 是纯粹的 `{ getBoundingBox }` 泛型，与 OCCT 无关。留在 occt-kernel/ 会导致
 * **引擎中立的拓扑构建器**（`brep/brep-topology.ts`）反向依赖平台内核模块，
 * 使 `@platform occt` 标注失真（方案 2026-10-01 §3.7）。
 *
 * `occt-kernel/occtKernel.ts` 仍 re-export 本模块的符号，既有导入面零迁移。
 */

import type { BrepBoundingBox } from './engine/types'
import type { TessellationDensity } from '../runtime-state'
import { DEFAULT_LINEAR_DEFLECTION } from '../tolerance'
import { mm } from '../units'

/** Options controlling mesh deflection during tessellation. */
export interface MeshDeflectionOptions {
  linearDeflection?: number
  angularDeflection?: number
  /** If true, linearDeflection is multiplied by the bounding-box diagonal
   *  (matches OCCT's BRepMesh_IncrementalMesh relative=true behaviour). */
  relative?: boolean
}

/**
 * Compute the effective linear deflection, applying relative scaling
 * exactly as OCCT does internally: `linDefl * bboxDiagonal` when relative=true.
 *
 * @param kernel - any engine exposing `getBoundingBox` (L1 契约面即可)
 * @param shape - the shape whose bounding box drives relative scaling
 * @param options - the requested deflection options
 * @returns the effective linear and angular deflection values
 */
export function computeEffectiveDeflection<S>(
  kernel: { getBoundingBox(shape: S, useTriangulation?: boolean): BrepBoundingBox },
  shape: S,
  options: MeshDeflectionOptions = {},
): { linearDeflection: number; angularDeflection: number } {
  const ld = options.linearDeflection ?? DEFAULT_LINEAR_DEFLECTION.as(mm)
  const ad = options.angularDeflection ?? 0.5
  const relative = options.relative ?? false
  if (!relative) return { linearDeflection: ld, angularDeflection: ad }

  // OCCT: BRepBndLib::AddOptimal → bbox diagonal → deflection *= diagonal
  // 浏览器 WASM 中 compound shape 可能使 getBoundingBox 抛异常，需要容错
  let bb: BrepBoundingBox
  try {
    bb = kernel.getBoundingBox(shape, false)
  } catch {
    try {
      bb = kernel.getBoundingBox(shape, true)
    } catch {
      // 无法获取 bbox → 返回非相对模式的默认值
      return { linearDeflection: ld, angularDeflection: ad }
    }
  }
  const dx = bb.xmax - bb.xmin
  const dy = bb.ymax - bb.ymin
  const dz = bb.zmax - bb.zmin
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz)
  return { linearDeflection: ld * diag, angularDeflection: ad }
}

// ── L0 粗密度档（bbox-relative，方案 2026-10-28 LOD §3/§4.1）────────────────
//
// 用途：执行期先出粗网格（LOD L0），空闲后再精化到 L1。
//
// **本档只管 linear**。angular（曲率段数下限）继续走既有的 `angularDeflection`
// 旋钮——因为基本体的缺省段数是 `2π/getTessellation().angularDeflection` 算出来的
// （api/primitives.ts）：若本档连 angular 一起盖掉，球仍会按全局缺省 2π/64 出
// **64 段**，LOD 的"粗"就只落在一半旋钮上。两条旋钮各管一件事：
//   - `angularDeflection`（宿主配 2π/16）→ 段数下限，同时决定基本体缺省段数；
//   - `linearMode:'bbox-relative'`（本组常量）→ linear 按零件大小自适应。

/** 对角线 50mm → linear 1mm（几十毫米级零件的"清晰度 1mm"口径）。 */
export const COARSE_BBOX_RATIO = 1 / 50
/** linear 下限：小零件不再被按比例切到 0.01mm 级。 */
export const COARSE_FLOOR_MM = 0.5
/** linear 上限：1 米级零件按 20mm 取，而不是 1mm。 */
export const COARSE_CAP_MM = 20

/**
 * 落到 `kernel.meshShape` 上的**具体密度**（绝对 mm + 弧度）。
 *
 * bbox-relative 的产物同样是绝对毫米值——解析完就与模式无关了，故本类型不带
 * `linearMode` 字段（避免"已解析的值 + 未解析的模式"混在一个对象里）。
 */
export interface ResolvedTessellation {
  linearDeflection: number
  angularDeflection: number
}

/**
 * solid 包围盒对角线（mm）；取不到（内核拒绝 / 空形状 / 非有限值）→ null。
 *
 * 与本文件既有的 relative 分支同一动作：solid 句柄走分析式包围盒（`useTriangulation`
 * 为 false 的 loose box），不生成三角网格，比 `meshShape` 低 2~3 个数量级。
 */
function bboxDiagonalOrNull<S>(
  kernel: { getBoundingBox(shape: S, useTriangulation?: boolean): BrepBoundingBox },
  solid: S,
): number | null {
  let bb: BrepBoundingBox
  try {
    bb = kernel.getBoundingBox(solid, false)
  } catch {
    return null
  }
  const dx = bb.xmax - bb.xmin
  const dy = bb.ymax - bb.ymin
  const dz = bb.zmax - bb.zmin
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz)
  return Number.isFinite(diag) ? diag : null
}

/**
 * 按 solid 包围盒对角线算 L0 的 **linear**（引擎中立：只依赖 `getBoundingBox`，
 * 与本文件 `computeEffectiveDeflection` 同一契约面）。
 *
 * 取不到包围盒 → 用 **cap 最粗档**（20mm）：这是"尺寸未知时按最大零件处理"的
 * 已知上限，不是失败后的兜底（形状退化/空形状拿不到盒子是静态可判的常态之一）。
 *
 * @param kernel - 任何暴露 `getBoundingBox` 的引擎（L1 契约面即可）。
 * @param solid - 待三角化的 solid 句柄。
 * @returns L0 的 linearDeflection（落在 [COARSE_FLOOR_MM, COARSE_CAP_MM] 内，绝对 mm）。
 */
export function coarseLinearDeflectionFor<S>(
  kernel: { getBoundingBox(shape: S, useTriangulation?: boolean): BrepBoundingBox },
  solid: S,
): number {
  const diag = bboxDiagonalOrNull(kernel, solid)
  // 未知尺寸按 +∞ 参与钳制 → 落到 cap（最粗档）。
  const scale = diag ?? Number.POSITIVE_INFINITY
  return Math.min(Math.max(scale * COARSE_BBOX_RATIO, COARSE_FLOOR_MM), COARSE_CAP_MM)
}

/**
 * 解析「这次 `meshShape` 真正要用的密度」。
 *
 * 模式的作用域**只有 linear**：`'absolute'` 原样用 `fallback` 的两个值（现状行为）；
 * `'bbox-relative'` 只把 linear 换成 {@link coarseLinearDeflectionFor} 的結果，
 * angular 仍由既有旋钮给（它还决定基本体的缺省段数，见本段文件头注释）。
 *
 * @param kernel - L1 契约面内核。
 * @param solid - 待三角化的 solid 句柄。
 * @param fallback - 宿主档（per-call 覆盖后合并了全局，字段齐全）。
 * @returns 具体密度对（绝对 mm + 弧度）。
 */
export function resolveTessellationFor<S>(
  kernel: { getBoundingBox(shape: S, useTriangulation?: boolean): BrepBoundingBox },
  solid: S,
  fallback: Required<TessellationDensity>,
): ResolvedTessellation {
  const angularDeflection = fallback.angularDeflection
  if (fallback.linearMode !== 'bbox-relative') {
    return { linearDeflection: fallback.linearDeflection, angularDeflection }
  }
  return { linearDeflection: coarseLinearDeflectionFor(kernel, solid), angularDeflection }
}
