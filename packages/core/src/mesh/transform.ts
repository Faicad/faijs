/**
 * mesh 变换 API
 *
 * 提取来源：
 * - engine/mesh-simplify/proxy-mesh-cache.ts (transformMeshData)
 * - engine-store.partTransforms
 *
 * 变换语义（烘焙执行引擎）：
 * - translate/rotate_euler/scale3d 直接烘焙顶点（修改 positions）
 * - 执行器（dispatcher / runtime.execute）调用这些函数将变换烘焙进几何
 * - 交互拖拽期间的预览仍由 partTransforms（渲染层瞬态）承担
 *   确认后由引擎重放语句完成烘焙（P2）
 */

import * as THREE from 'three'
import type { Shape, Vec3 } from './types'

/**
 * Translate a mesh shape by baking the offset into its vertices.
 * @param shape - the mesh shape to translate.
 * @param offset - translation vector in mm.
 * @returns a new shape moved by the given offset.
 */
export function translate(shape: Shape, offset: Vec3): Shape {
  const positions = new Float32Array(shape.positions)
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] += offset[0]
    positions[i + 1] += offset[1]
    positions[i + 2] += offset[2]
  }
  return { positions, indices: shape.indices }
}

/**
 * Rotate a mesh shape by baking the rotation into its vertices (angles in
 * degrees, optionally about a pivot).
 * @param shape - the mesh shape to rotate.
 * @param anglesDeg - XYZ Euler angles in degrees.
 * @param pivot - optional rotation pivot point in mm.
 * @returns a new shape with rotated vertices.
 */
export function rotate_euler(shape: Shape, anglesDeg: Vec3, pivot?: Vec3): Shape {
  const euler = new THREE.Euler(
    (anglesDeg[0] * Math.PI) / 180,
    (anglesDeg[1] * Math.PI) / 180,
    (anglesDeg[2] * Math.PI) / 180,
  )
  const matrix = new THREE.Matrix4().makeRotationFromEuler(euler)
  if (pivot) {
    matrix.premultiply(new THREE.Matrix4().makeTranslation(pivot[0], pivot[1], pivot[2]))
    matrix.multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]))
  }
  return applyMatrix(shape, matrix)
}

/**
 * Scale a mesh shape by baking the factor into its vertices.
 * @param shape - the mesh shape to scale.
 * @param factor - uniform scale factor or per-axis (x, y, z) factors.
 * @param center - optional fixed point of the scaling (P6 §4.6; default origin).
 * @returns a new shape with scaled vertices.
 */
export function scale3d(shape: Shape, factor: number | Vec3, center?: Vec3): Shape {
  const f: [number, number, number] =
    typeof factor === 'number' ? [factor, factor, factor] : [factor[0], factor[1], factor[2]]
  return applyMatrix(shape, scaleMatrix(f, center))
}

/**
 * Uniformly scale a mesh shape (brepjs `scale` 契约，P6 §4.6)。后台用
 * `scale3d` 的等比参数；`center` 为缩放不动的点，默认原点。
 * @param shape - the mesh shape to scale.
 * @param factor - uniform scale factor (> 0).
 * @param center - optional fixed point of the scaling (default origin).
 * @returns a new shape with uniformly scaled vertices.
 */
export function scale(shape: Shape, factor: number, center?: Vec3): Shape {
  return applyMatrix(shape, scaleMatrix([factor, factor, factor], center))
}

/** 缩放矩阵：围绕 `center`（缺省原点）构造 T(c)·S·T(−c)。 */
function scaleMatrix(f: [number, number, number], center?: Vec3): THREE.Matrix4 {
  const s = new THREE.Matrix4().makeScale(f[0], f[1], f[2])
  if (!center) return s
  return new THREE.Matrix4()
    .makeTranslation(center[0], center[1], center[2])
    .multiply(s)
    .multiply(new THREE.Matrix4().makeTranslation(-center[0], -center[1], -center[2]))
}

/** 用 THREE.Matrix4 变换几何 */
function applyMatrix(shape: Shape, matrix: THREE.Matrix4): Shape {
  const positions = new Float32Array(shape.positions)
  const v = new THREE.Vector3()
  for (let i = 0; i < positions.length; i += 3) {
    v.set(positions[i], positions[i + 1], positions[i + 2])
    v.applyMatrix4(matrix)
    positions[i] = v.x
    positions[i + 1] = v.y
    positions[i + 2] = v.z
  }
  return { positions, indices: shape.indices }
}

/**
 * Transform a mesh shape with an arbitrary THREE.Matrix4 (corresponds to the
 * existing transformMeshData function).
 * @param shape - the mesh shape to transform.
 * @param matrix - the 4x4 transform matrix to apply.
 * @returns a new shape with transformed vertices.
 */
export function transformMatrix(shape: Shape, matrix: THREE.Matrix4): Shape {
  return applyMatrix(shape, matrix)
}
