/**
 * mesh 查询 API
 *
 * 提取来源：transform-store 的 compute*BoundingBox
 * 这些函数不产生几何，供 GeomRef 求值与面板显示使用。
 */

import * as THREE from 'three'
import type { Shape, Vec3, BoundingBox, FaceDescriptor } from './types'

/** 计算包围盒 */
export function boundingBox(shape: Shape): BoundingBox {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < shape.positions.length; i += 3) {
    const x = shape.positions[i]
    const y = shape.positions[i + 1]
    const z = shape.positions[i + 2]
    if (x < min[0]) min[0] = x
    if (y < min[1]) min[1] = y
    if (z < min[2]) min[2] = z
    if (x > max[0]) max[0] = x
    if (y > max[1]) max[1] = y
    if (z > max[2]) max[2] = z
  }
  return { min, max }
}

/** 计算包围盒中心 */
export function bboxCenter(shape: Shape): Vec3 {
  const bb = boundingBox(shape)
  return [
    (bb.min[0] + bb.max[0]) / 2,
    (bb.min[1] + bb.max[1]) / 2,
    (bb.min[2] + bb.max[2]) / 2,
  ]
}

/** 计算体积（基于三角网格的散度定理） */
export function volume(shape: Shape): number {
  let vol = 0
  const indices = shape.indices
  const positions = shape.positions
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3
    const b = indices[i + 1] * 3
    const c = indices[i + 2] * 3
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2]
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2]
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2]
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
  }
  return Math.abs(vol)
}

/**
 * 在给定点附近查找面
 *
 * 用于 GeomRef 的 faceCenter/faceNormal 求值：
 * 根据锚点（拾取时的点+法向）在几何上找到最近的面。
 */
export function faceAt(shape: Shape, anchor: { point: Vec3; normal?: Vec3 }): FaceDescriptor | null {
  const targetPoint = new THREE.Vector3(...anchor.point)
  const targetNormal = anchor.normal ? new THREE.Vector3(...anchor.normal) : null

  let bestDist = Infinity
  let bestFace: FaceDescriptor | null = null

  const indices = shape.indices
  const positions = shape.positions

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3
    const b = indices[i + 1] * 3
    const c = indices[i + 2] * 3

    const va = new THREE.Vector3(positions[a], positions[a + 1], positions[a + 2])
    const vb = new THREE.Vector3(positions[b], positions[b + 1], positions[b + 2])
    const vc = new THREE.Vector3(positions[c], positions[c + 1], positions[c + 2])

    // 面中心
    const center = new THREE.Vector3().addVectors(va, vb).add(vc).divideScalar(3)
    const dist = center.distanceTo(targetPoint)

    // 面法向
    const normal = new THREE.Vector3()
      .subVectors(vb, va)
      .cross(new THREE.Vector3().subVectors(vc, va))
      .normalize()

    // 如果有目标法向，加权距离（法向不匹配的面惩罚更大）
    let weightedDist = dist
    if (targetNormal) {
      const dot = Math.abs(normal.dot(targetNormal))
      weightedDist = dist / (dot + 0.01) // 法向越匹配，权重越小
    }

    if (weightedDist < bestDist) {
      bestDist = weightedDist
      const area = new THREE.Vector3()
        .subVectors(vb, va)
        .cross(new THREE.Vector3().subVectors(vc, va))
        .length() / 2
      bestFace = {
        center: [center.x, center.y, center.z],
        normal: [normal.x, normal.y, normal.z],
        area,
      }
    }
  }

  return bestFace
}
