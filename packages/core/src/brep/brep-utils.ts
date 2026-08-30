/**
 * BREP 通用工具函数
 */

import type { BrepHandle } from './engine/types'
import type { BrepEngineApi } from './engine/primitives'
import type { Vec3 } from '../mesh/types'

/**
 * 获取 solid 的包围盒。
 *
 * 浏览器 WASM 环境中，布尔运算（cut/fuse）产生的 compound shape
 * 可能使 getBoundingBox 抛出异常。此函数提供与 topologyExt.ts
 * 中 tryGetBoundingBox 一致的容错策略：
 * 1. 尝试 getBoundingBox(useTriangulation=false)
 * 2. 尝试 getBoundingBox(useTriangulation=true)
 * 3. 两者均失败 → console.error + throw（不再静默返回默认 bbox）
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
