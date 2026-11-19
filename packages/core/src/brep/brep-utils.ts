/**
 * BREP 通用工具函数
 */

import type { BrepHandle } from './engine/types'
import type { BrepEngineApi } from './engine/primitives'
import type { Vec3 } from '../mesh/types'

/**
 * Whether a BREP handle is a compound (a boolean may legally return one).
 *
 * Note: this is the **handle-level** test. `isCompound(shape)` from
 * `@faicad/faijs/sdk` is the structural wrapper test (a `CompoundShape` with
 * `children`), not a BREP handle test — the two are deliberately distinct.
 *
 * @param kernel - the active BREP engine.
 * @param shape - the handle to classify.
 * @returns true for `compound` / `compsolid`.
 */
export function isCompoundHandle(kernel: BrepEngineApi, shape: BrepHandle): boolean {
  const type = kernel.shapeType(shape)
  return type === 'compound' || type === 'compsolid'
}

/**
 * The solids a handle carries, one level deep.
 *
 * `cut` / `fuse` / `common` may legally return a compound wrapping several
 * solids (a through-cut splits a solid in two). Callers that need a single
 * solid must decide what to do with several — this helper only reports them.
 *
 * @param kernel - the active BREP engine.
 * @param shape - a solid / compound / compsolid / shell handle.
 * @returns the solid handles (a solid input yields itself).
 */
export function getSolids(kernel: BrepEngineApi, shape: BrepHandle): BrepHandle[] {
  const type = kernel.shapeType(shape)
  if (type === 'solid') return [shape]
  if (type === 'compound' || type === 'compsolid' || type === 'shell') {
    return kernel.getSubShapes(shape, 'solid')
  }
  return []
}

/**
 * 获取 solid 的包围盒。
 *
 * 浏览器 WASM 环境中，布尔运算（cut/fuse）产生的 compound shape
 * 可能使 getBoundingBox 抛出异常。此函数提供与 topologyExt.ts
 * 中 tryGetBoundingBox 一致的容错策略：
 * 1. 尝试 getBoundingBox(useTriangulation=false)
 * 2. 尝试 getBoundingBox(useTriangulation=true)
 * 3. 两者均失败 → console.error + throw（不再静默返回默认 bbox）
 *
 * @param kernel  the OCCT kernel instance.
 * @param solid   the solid whose bounding box to compute.
 * @returns the solid's bounding box as { min, max } corner vectors.
 */
export function getSolidBoundingBox(kernel: BrepEngineApi, solid: BrepHandle): { min: Vec3; max: Vec3 } {
  try {
    const bbox = kernel.getBoundingBox(solid, false)
    return {
      min: [bbox.xmin, bbox.ymin, bbox.zmin],
      max: [bbox.xmax, bbox.ymax, bbox.zmax],
    }
  } catch {
    // compound shape 可能需要三角化才能计算 bbox
  }
  try {
    const bbox = kernel.getBoundingBox(solid, true)
    return {
      min: [bbox.xmin, bbox.ymin, bbox.zmin],
      max: [bbox.xmax, bbox.ymax, bbox.zmax],
    }
  } catch (err) {
    // 两种方式都失败 → 上报并抛错（不再静默返回默认 bbox）
    console.error('[getSolidBoundingBox] both getBoundingBox attempts failed for solid:', err)
    throw new Error(`[getSolidBoundingBox] failed to compute bounding box for solid`, { cause: err })
  }
}
