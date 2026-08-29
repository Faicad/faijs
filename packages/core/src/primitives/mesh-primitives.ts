import * as THREE from 'three'
import type { PrimitiveType } from './types'

export const DEFAULT_SIZE = 20
export const DEFAULT_SEGMENTS = 32

/** Rotation matrix: +90° around X — converts Y-up vertex data to Z-up. */
const ROT_Y_TO_Z = new THREE.Matrix4().makeRotationX(Math.PI / 2)

export function makePrimitiveGeo(
  type: PrimitiveType,
  size?: number,
  segments?: number,
): THREE.BufferGeometry {
  const s = size ?? DEFAULT_SIZE
  const segs = segments ?? DEFAULT_SEGMENTS

  let geo: THREE.BufferGeometry
  switch (type) {
    case 'cube':
    case 'box':
      geo = new THREE.BoxGeometry(s, s, s)
      geo.applyMatrix4(ROT_Y_TO_Z)
      break
    case 'sphere':
      geo = new THREE.SphereGeometry(s / 2, segs, segs)
      geo.applyMatrix4(ROT_Y_TO_Z)
      break
    case 'cylinder':
      geo = new THREE.CylinderGeometry(s / 2, s / 2, s, segs)
      geo.applyMatrix4(ROT_Y_TO_Z)
      break
    case 'cone':
      geo = new THREE.ConeGeometry(s / 2, s, segs)
      geo.applyMatrix4(ROT_Y_TO_Z)
      break
    case 'wedge': {
      // 楔形体：梯形棱柱，直接在 Z-up 中构建
      // 梯形在 YZ 平面（Y=宽度方向，Z=高度方向），拉升沿 X 轴
      const width = s                     // 底边长度（沿 Y）
      const height = s / 2                // 梯形高（沿 Z，默认 10mm）
      const angleDeg = 60                 // 底边与斜边的夹角
      const angleRad = (angleDeg * Math.PI) / 180
      const halfExtrude = 25              // 拉升总长 50mm（沿 X）
      const hw = width / 2

      // 上边半宽 = 底边半宽 - 高 / tan(角度)，钳制到 >= 0
      const halfTopWidth = Math.max(0, hw - height / Math.tan(angleRad))

      const positions = new Float32Array([
        // 前端面 (X = -halfExtrude)
        -halfExtrude, -hw, 0,                  // p0: bottomLeft
        -halfExtrude,  hw, 0,                  // p1: bottomRight
        -halfExtrude,  halfTopWidth, height,    // p2: topRight
        -halfExtrude, -halfTopWidth, height,    // p3: topLeft
        // 后端面 (X = +halfExtrude)
         halfExtrude, -hw, 0,                  // p4: bottomLeft
         halfExtrude,  hw, 0,                  // p5: bottomRight
         halfExtrude,  halfTopWidth, height,    // p6: topRight
         halfExtrude, -halfTopWidth, height,    // p7: topLeft
      ])

      const indices = new Uint32Array([
        // 前端面 (outward = -X, counterclockwise from outside)
        0, 2, 1,  0, 3, 2,
        // 后端面 (outward = +X, counterclockwise from outside)
        4, 5, 6,  4, 6, 7,
        // 底面 (outward = -Z)
        0, 5, 4,  0, 1, 5,
        // 顶面 (outward = +Z)
        3, 6, 2,  3, 7, 6,
        // 左侧面 (outward = -Y)
        0, 7, 3,  0, 4, 7,
        // 右侧面 (outward = +Y)
        1, 6, 5,  1, 2, 6,
      ])

      geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geo.setIndex(new THREE.BufferAttribute(indices, 1))
      // 楔形体直接在 Z-up 中构建，无需 ROT_Y_TO_Z
      break
    }
  }

  return geo
}

/**
 * Translate geometry to the given world coordinates.
 * The geometry should already be centred on the origin (makePrimitiveGeo /
 * makeScrew / createTextGeometry all produce centred geometry).
 */
export function applyPrimitiveOffset(
  geo: THREE.BufferGeometry,
  x: number,
  y: number,
): void {
  if (x === 0 && y === 0) return
  geo.translate(x, y, 0)
}

/**
 * 合并多个 BufferGeometry 为一个 indexed 几何体。
 * 自动处理 indexed 和 non-indexed 几何的混合输入。
 */
export function mergeBufferGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geometries.length === 1) return geometries[0].clone()

  const merged = new THREE.BufferGeometry()

  // Collect all position arrays
  const allPositions: Float32Array[] = []
  const allIndices: Uint32Array[] = []
  let vertexOffset = 0

  for (const geo of geometries) {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    if (!pos) continue

    allPositions.push(new Float32Array(pos.array))
    const idx = geo.index
    if (idx) {
      const shifted = new Uint32Array(idx.array.length)
      for (let i = 0; i < idx.count; i++) {
        shifted[i] = (idx.array as Uint32Array | Uint16Array)[i] + vertexOffset
      }
      allIndices.push(shifted)
    } else {
      // Non-indexed geometry: create sequential indices
      const count = pos.count
      const indices = new Uint32Array(count)
      for (let i = 0; i < count; i++) indices[i] = i + vertexOffset
      allIndices.push(indices)
    }
    vertexOffset += pos.count
  }

  // Concatenate positions
  const totalPosLen = allPositions.reduce((s, a) => s + a.length, 0)
  const mergedPos = new Float32Array(totalPosLen)
  let posOffset = 0
  for (const arr of allPositions) {
    mergedPos.set(arr, posOffset)
    posOffset += arr.length
  }
  merged.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3))

  // Concatenate indices
  const totalIdxLen = allIndices.reduce((s, a) => s + a.length, 0)
  const mergedIdx = new Uint32Array(totalIdxLen)
  let idxOffset = 0
  for (const arr of allIndices) {
    mergedIdx.set(arr, idxOffset)
    idxOffset += arr.length
  }
  merged.setIndex(new THREE.BufferAttribute(mergedIdx, 1))

  return merged
}
