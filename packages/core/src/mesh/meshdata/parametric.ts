/**
 * meshdata/parametric — three.js r162 参数化几何的最小复刻（box / cylinder /
 * cone / sphere），去掉 normal / uv，只产出 position + index。
 *
 * Ported from three.js r162 `src/geometries/{Box,Cylinder,Cone,Sphere}Geometry.js`
 * (MIT License, © 2010-2024 three.js authors). **顶点与索引的生成顺序逐行照抄**
 * ——`mesh/primitives.ts` 的 `faceRanges` 面序契约正建立在该顺序之上（例如 Box
 * 12 三角形 = 6 面 × 2，顺序固定 +X/−X/+Y/−Y/+Z/−Z；Cylinder 侧面→顶盖→底盖）。
 * 改动这里的循环顺序 = 改变面序契约，属破坏性改动。
 *
 * 本模块零依赖（除 `MeshData` 类型），是「去 three」后 core 自有的参数化几何来源。
 */

import type { MeshData } from './weld'

/** Raw geometry output: interleaved positions + triangle indices. */
export interface GeoData {
  positions: Float32Array
  indices: Uint32Array
}

type Axis = 'x' | 'y' | 'z'

/**
 * Box geometry (three `BoxGeometry`, default 1 segment per side).
 * @param width - size along X.
 * @param height - size along Y.
 * @param depth - size along Z.
 * @param widthSegments - segments along X.
 * @param heightSegments - segments along Y.
 * @param depthSegments - segments along Z.
 * @returns positions + indices in three's vertex/index order.
 */
export function boxGeometry(
  width = 1,
  height = 1,
  depth = 1,
  widthSegments = 1,
  heightSegments = 1,
  depthSegments = 1,
): GeoData {
  const indices: number[] = []
  const vertices: number[] = []
  let numberOfVertices = 0

  const gx = Math.floor(widthSegments)
  const gy = Math.floor(heightSegments)
  const gz = Math.floor(depthSegments)
  const vector: Record<Axis, number> = { x: 0, y: 0, z: 0 }

  function buildPlane(
    u: Axis, v: Axis, w: Axis,
    udir: number, vdir: number,
    planeWidth: number, planeHeight: number, planeDepth: number,
    gridX: number, gridY: number,
  ): void {
    const segmentWidth = planeWidth / gridX
    const segmentHeight = planeHeight / gridY
    const widthHalf = planeWidth / 2
    const heightHalf = planeHeight / 2
    const depthHalf = planeDepth / 2
    const gridX1 = gridX + 1
    const gridY1 = gridY + 1
    let vertexCounter = 0

    for (let iy = 0; iy < gridY1; iy++) {
      const y = iy * segmentHeight - heightHalf
      for (let ix = 0; ix < gridX1; ix++) {
        const x = ix * segmentWidth - widthHalf
        vector[u] = x * udir
        vector[v] = y * vdir
        vector[w] = depthHalf
        vertices.push(vector.x, vector.y, vector.z)
        vertexCounter += 1
      }
    }

    for (let iy = 0; iy < gridY; iy++) {
      for (let ix = 0; ix < gridX; ix++) {
        const a = numberOfVertices + ix + gridX1 * iy
        const b = numberOfVertices + ix + gridX1 * (iy + 1)
        const c = numberOfVertices + (ix + 1) + gridX1 * (iy + 1)
        const d = numberOfVertices + (ix + 1) + gridX1 * iy
        indices.push(a, b, d)
        indices.push(b, c, d)
      }
    }

    numberOfVertices += vertexCounter
  }

  buildPlane('z', 'y', 'x', -1, -1, depth, height, width, gz, gy) // px
  buildPlane('z', 'y', 'x', 1, -1, depth, height, -width, gz, gy) // nx
  buildPlane('x', 'z', 'y', 1, 1, width, depth, height, gx, gz) // py
  buildPlane('x', 'z', 'y', 1, -1, width, depth, -height, gx, gz) // ny
  buildPlane('x', 'y', 'z', 1, -1, width, height, depth, gx, gy) // pz
  buildPlane('x', 'y', 'z', -1, -1, width, height, -depth, gx, gy) // nz

  return { positions: new Float32Array(vertices), indices: new Uint32Array(indices) }
}

/**
 * Cylinder / frustum geometry (three `CylinderGeometry`: torso then top cap then
 * bottom cap).
 * @param radiusTop - top radius.
 * @param radiusBottom - bottom radius.
 * @param height - height along Y (three is Y-up; callers rotate to Z-up).
 * @param radialSegments - radial segment count.
 * @param heightSegments - axial segment count.
 * @param openEnded - skip caps when true.
 * @param thetaStart - start angle.
 * @param thetaLength - swept angle.
 * @returns positions + indices in three's vertex/index order.
 */
export function cylinderGeometry(
  radiusTop = 1,
  radiusBottom = 1,
  height = 1,
  radialSegments = 32,
  heightSegments = 1,
  openEnded = false,
  thetaStart = 0,
  thetaLength = Math.PI * 2,
): GeoData {
  const indices: number[] = []
  const vertices: number[] = []
  let index = 0
  const halfHeight = height / 2

  const rSeg = Math.floor(radialSegments)
  const hSeg = Math.floor(heightSegments)

  const indexArray: number[][] = []

  // torso
  {

    for (let y = 0; y <= hSeg; y++) {
      const indexRow: number[] = []
      const v = y / hSeg
      const radius = v * (radiusBottom - radiusTop) + radiusTop
      for (let x = 0; x <= rSeg; x++) {
        const u = x / rSeg
        const theta = u * thetaLength + thetaStart
        const sinTheta = Math.sin(theta)
        const cosTheta = Math.cos(theta)
        vertices.push(radius * sinTheta, -v * height + halfHeight, radius * cosTheta)
        indexRow.push(index++)
      }
      indexArray.push(indexRow)
    }
    for (let x = 0; x < rSeg; x++) {
      for (let y = 0; y < hSeg; y++) {
        const a = indexArray[y][x]
        const b = indexArray[y + 1][x]
        const c = indexArray[y + 1][x + 1]
        const d = indexArray[y][x + 1]
        indices.push(a, b, d)
        indices.push(b, c, d)
      }
    }

  }

  const generateCap = (top: boolean): void => {
    const centerIndexStart = index
    const radius = top ? radiusTop : radiusBottom
    const sign = top ? 1 : -1
    for (let x = 1; x <= rSeg; x++) {
      vertices.push(0, halfHeight * sign, 0)
      index++
    }
    const centerIndexEnd = index
    for (let x = 0; x <= rSeg; x++) {
      const u = x / rSeg
      const theta = u * thetaLength + thetaStart
      const cosTheta = Math.cos(theta)
      const sinTheta = Math.sin(theta)
      vertices.push(radius * sinTheta, halfHeight * sign, radius * cosTheta)
      index++
    }
    for (let x = 0; x < rSeg; x++) {
      const c = centerIndexStart + x
      const i = centerIndexEnd + x
      if (top) indices.push(i, i + 1, c)
      else indices.push(i + 1, i, c)
    }
  }

  if (!openEnded) {
    if (radiusTop > 0) generateCap(true)
    if (radiusBottom > 0) generateCap(false)
  }

  return { positions: new Float32Array(vertices), indices: new Uint32Array(indices) }
}

/**
 * Cone geometry (three `ConeGeometry` = `CylinderGeometry(0, radius, ...)`).
 * @param radius - base radius.
 * @param height - height along Y.
 * @param radialSegments - radial segment count.
 * @param heightSegments - axial segment count.
 * @param openEnded - skip the base cap when true.
 * @param thetaStart - start angle.
 * @param thetaLength - swept angle.
 * @returns positions + indices in three's vertex/index order.
 */
export function coneGeometry(
  radius = 1,
  height = 1,
  radialSegments = 32,
  heightSegments = 1,
  openEnded = false,
  thetaStart = 0,
  thetaLength = Math.PI * 2,
): GeoData {
  return cylinderGeometry(0, radius, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength)
}

/**
 * Sphere geometry (three `SphereGeometry`).
 * @param radius - sphere radius.
 * @param widthSegments - longitude segment count.
 * @param heightSegments - latitude segment count.
 * @param phiStart - start longitude.
 * @param phiLength - swept longitude.
 * @param thetaStart - start latitude.
 * @param thetaLength - swept latitude.
 * @returns positions + indices in three's vertex/index order.
 */
export function sphereGeometry(
  radius = 1,
  widthSegments = 32,
  heightSegments = 16,
  phiStart = 0,
  phiLength = Math.PI * 2,
  thetaStart = 0,
  thetaLength = Math.PI,
): GeoData {
  const wSeg = Math.max(3, Math.floor(widthSegments))
  const hSeg = Math.max(2, Math.floor(heightSegments))
  const thetaEnd = Math.min(thetaStart + thetaLength, Math.PI)

  let index = 0
  const grid: number[][] = []
  const indices: number[] = []
  const vertices: number[] = []

  for (let iy = 0; iy <= hSeg; iy++) {
    const verticesRow: number[] = []
    const v = iy / hSeg
    for (let ix = 0; ix <= wSeg; ix++) {
      const u = ix / wSeg
      const x = -radius * Math.cos(phiStart + u * phiLength) * Math.sin(thetaStart + v * thetaLength)
      const y = radius * Math.cos(thetaStart + v * thetaLength)
      const z = radius * Math.sin(phiStart + u * phiLength) * Math.sin(thetaStart + v * thetaLength)
      vertices.push(x, y, z)
      verticesRow.push(index++)
    }
    grid.push(verticesRow)
  }

  for (let iy = 0; iy < hSeg; iy++) {
    for (let ix = 0; ix < wSeg; ix++) {
      const a = grid[iy][ix + 1]
      const b = grid[iy][ix]
      const c = grid[iy + 1][ix]
      const d = grid[iy + 1][ix + 1]
      if (iy !== 0 || thetaStart > 0) indices.push(a, b, d)
      if (iy !== hSeg - 1 || thetaEnd < Math.PI) indices.push(b, c, d)
    }
  }

  return { positions: new Float32Array(vertices), indices: new Uint32Array(indices) }
}

/** Re-export the raw mesh container type for callers. */
export type { MeshData }