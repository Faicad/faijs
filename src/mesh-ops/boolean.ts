/**
 * cad-core 布尔运算 API
 *
 * 提取来源：engine/boolean/csg.ts (computeBoolean)
 * 已是纯数据函数，直接包装。
 */

import { computeBoolean } from '../boolean/csg-backend'
import type { Shape } from './types'

/** 布尔并集 */
export async function union(a: Shape, b: Shape, ...rest: Shape[]): Promise<Shape> {
  const meshes = [a, b, ...rest]
  return computeBoolean(meshes, 'union')
}

/** 布尔差集 (a - b) */
export async function subtract(a: Shape, b: Shape): Promise<Shape> {
  return computeBoolean([a, b], 'subtract')
}

/** 布尔交集 */
export async function intersect(a: Shape, b: Shape): Promise<Shape> {
  return computeBoolean([a, b], 'intersect')
}
