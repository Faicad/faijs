/**
 * geo-convert — 纯数据转换函数（从 csg.ts 提取）
 *
 * THREE.BufferGeometry ↔ ManifoldMeshData 转换。
 * 不依赖 Worker / postMessage，可在 Node 和浏览器环境通用。
 */

import * as THREE from 'three'
import { deriveNormals } from './deriveNormals'

// ── 类型（与 csg.ts 保持一致）──

export type BooleanOperation = 'union' | 'subtract' | 'intersect'

export interface ManifoldMeshData {
  positions: Float32Array
  indices: Uint32Array
}

export interface DovetailGrooveParams {
  depth: number
  depthTolerance: number
  width: number
  widthTolerance: number
  flapsAngle: number
}

export interface DowelSplitParams {
  diameter: number
  diameterTolerance: number
  height: number
  heightTolerance: number
}

export interface StraightTenonSplitParams {
  sideLength: number
  sideLengthTolerance: number
  height: number
  heightTolerance: number
}

// ── 焊接重复顶点 ──

function weldPositions(
  positions: Float32Array,
  indices: Uint32Array | Uint16Array,
  count: number,
): ManifoldMeshData {
  const mapX = new Map<number, Map<number, Map<number, number>>>()
  const weldedPosArr: number[] = []
  const weldedIdxArr: number[] = []

  for (let i = 0; i < count; i++) {
    const vi = indices[i]
    const x = positions[vi * 3]
    const y = positions[vi * 3 + 1]
    const z = positions[vi * 3 + 2]
    const qx = Math.round(x * 1e6)
    const qy = Math.round(y * 1e6)
    const qz = Math.round(z * 1e6)

    let mapY = mapX.get(qx)
    if (mapY === undefined) {
      mapY = new Map<number, Map<number, number>>()
      mapX.set(qx, mapY)
    }
    let mapZ = mapY.get(qy)
    if (mapZ === undefined) {
      mapZ = new Map<number, number>()
      mapY.set(qy, mapZ)
    }
    let ni = mapZ.get(qz)
    if (ni === undefined) {
      ni = weldedPosArr.length / 3
      mapZ.set(qz, ni)
      weldedPosArr.push(x, y, z)
    }
    weldedIdxArr.push(ni)
  }

  return {
    positions: new Float32Array(weldedPosArr),
    indices: new Uint32Array(weldedIdxArr),
  }
}

// ── THREE.BufferGeometry → ManifoldMeshData ──

export function geoToManifoldMesh(geo: THREE.BufferGeometry): ManifoldMeshData {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const arr = (pos as unknown as { array: ArrayLike<number> }).array
  const positions = new Float32Array(arr as Float32Array)

  let triCount: number
  let indices: Uint32Array | Uint16Array
  if (geo.index) {
    const idx = geo.index
    triCount = idx.count
    const idxArr = (idx as unknown as { array: Uint32Array | Uint16Array }).array
    indices = idxArr instanceof Uint32Array
      ? new Uint32Array(idxArr.buffer, idxArr.byteOffset, idx.count)
      : new Uint16Array(idxArr.buffer, idxArr.byteOffset, idx.count)
  } else {
    triCount = pos.count
    const arr = new Uint32Array(triCount)
    for (let i = 0; i < triCount; i++) arr[i] = i
    indices = arr
  }

  return weldPositions(positions, indices, triCount)
}

// ── ManifoldMeshData → THREE.BufferGeometry ──

export function manifoldMeshToGeo(
  data: ManifoldMeshData,
  options?: { computeNormals?: boolean },
): THREE.BufferGeometry {
  let geo = new THREE.BufferGeometry()
  if (data.positions.length === 0 || data.indices.length === 0) {
    return geo
  }
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1))
  if (options?.computeNormals !== false) {
    geo = deriveNormals(geo)
  }
  geo.computeBoundingBox()
  return geo
}
