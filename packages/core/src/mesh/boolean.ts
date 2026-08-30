/**
 * mesh 布尔运算 API
 *
 * 提取来源：engine/boolean/csg.ts (computeBoolean)
 * 已是纯数据函数，直接包装。
 */

import { computeBoolean } from '../boolean/csg-backend'
import type { Shape } from './types'

/**
 * Boolean union of two or more shapes: the combined volume of every operand,
 * keeping only the outer surface.
 *
 * @param a - the first input shape.
 * @param b - the second input shape.
 * @param rest - additional shapes to include in the union.
 * @returns the merged solid shape.
 */
export async function union(a: Shape, b: Shape, ...rest: Shape[]): Promise<Shape> {
  const meshes = [a, b, ...rest]
  return computeBoolean(meshes, 'union')
}

/**
 * Boolean subtraction: cut shape `b` out of shape `a`.
 *
 * @param a - the base shape to cut from.
 * @param b - the shape to remove.
 * @returns the result of `a` minus `b`.
 */
export async function subtract(a: Shape, b: Shape): Promise<Shape> {
  return computeBoolean([a, b], 'subtract')
}

/**
 * Boolean intersection: the volume common to both shapes.
 *
 * @param a - the first input shape.
 * @param b - the second input shape.
 * @returns the region shared by `a` and `b`.
 */
export async function intersect(a: Shape, b: Shape): Promise<Shape> {
  return computeBoolean([a, b], 'intersect')
}
