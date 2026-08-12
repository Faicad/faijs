/**
 * cad-core 变换 API
 *
 * 提取来源：
 * - engine/mesh-simplify/proxy-mesh-cache.ts (transformMeshData)
 * - engine-store.partTransforms
 *
 * 变换语义（烘焙执行引擎）：
 * - translate/rotate/scale 直接烘焙顶点（修改 positions）
 * - 执行器（replay-validator）调用这些函数将变换烘焙进几何
 * - 交互拖拽期间的预览仍由 partTransforms（渲染层瞬态）承担
 *   确认后由引擎重放语句完成烘焙（P2）
 */

import * as THREE from 'three'
import type { Shape, Vec3 } from './types'

/** 平移几何（烘焙顶点） */
export function translate(shape: Shape, offset: Vec3): Shape {
  const positions = new Float32Array(shape.positions)
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] += offset[0]
    positions[i + 1] += offset[1]
    positions[i + 2] += offset[2]
  }
  return { positions, indices: shape.indices }
}

/** 旋转几何（烘焙顶点，角度用度） */
export function rotate(shape: Shape, anglesDeg: Vec3, pivot?: Vec3): Shape {
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

/** 缩放几何（烘焙顶点） */
export function scale(shape: Shape, factor: number | Vec3): Shape {
  const f = typeof factor === 'number' ? [factor, factor, factor] : factor
  const matrix = new THREE.Matrix4().makeScale(f[0], f[1], f[2])
  return applyMatrix(shape, matrix)
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
 * 用任意 THREE.Matrix4 变换几何
 * 对应现有 transformMeshData 函数
 */
export function transformMatrix(shape: Shape, matrix: THREE.Matrix4): Shape {
  return applyMatrix(shape, matrix)
}
