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
