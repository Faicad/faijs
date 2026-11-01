/**
 * Stock (workpiece) mesh generation — box / cylinder primitives as triangle
 * meshes. Consumed by the host for stock visualization (translucent body) and
 * by future stock-aware strategies. Pure function over a `CamStockDecl`;
 * produces the same `{ positions, indices }` shape as faijs mesh Shapes.
 */
import { roundCamCoord } from './types.js'
import type { CamStockDecl } from './decl.js'

/** StockMesh — CAM toolpath type (BREP.io port). */
export type StockMesh = {
  positions: Float32Array
  indices: Uint32Array
  bounds: {
    min: [number, number, number]
    max: [number, number, number]
  }
}

function boxMesh(size: [number, number, number], center: [number, number, number]): StockMesh {
  const [sx, sy, sz] = size.map(roundCamCoord)
  const [cx, cy, cz] = center.map(roundCamCoord)
  const hx = sx * 0.5
  const hy = sy * 0.5
  const hz = sz * 0.5
  // 8 corners, 6 faces × 2 triangles (CCW outward, +Z up).
  const corners: Array<[number, number, number]> = [
    [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz], [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz], [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz],
  ]
  const faces: Array<[number, number, number, number]> = [
    [0, 1, 2, 3], // bottom (-z)
    [4, 5, 6, 7], // top (+z)
    [0, 1, 5, 4], // -y
    [3, 2, 6, 7], // +y
    [1, 2, 6, 5], // +x
    [0, 3, 7, 4], // -x
  ]
  const positions = new Float32Array(24 * 3)
  const indices = new Uint32Array(36)
  corners.forEach((point, i) => {
    positions[i * 3] = point[0]
    positions[i * 3 + 1] = point[1]
    positions[i * 3 + 2] = point[2]
  })
  let o = 0
  faces.forEach((face) => {
    indices[o] = face[0]; indices[o + 1] = face[1]; indices[o + 2] = face[2]
    indices[o + 3] = face[0]; indices[o + 4] = face[2]; indices[o + 5] = face[3]
    o += 6
  })
  return {
    positions,
    indices,
    bounds: {
      min: [roundCamCoord(cx - hx), roundCamCoord(cy - hy), roundCamCoord(cz - hz)],
      max: [roundCamCoord(cx + hx), roundCamCoord(cy + hy), roundCamCoord(cz + hz)],
    },
  }
}

function cylinderMesh(radius: number, height: number, center: [number, number, number], radialSteps = 64): StockMesh {
  const r = Math.max(1e-7, radius)
  const h = Math.max(0, height)
  const [cx, cy, cz] = center.map(roundCamCoord)
  const positions = new Float32Array((radialSteps * 2 + 2) * 3)
  const indices = new Uint32Array(radialSteps * 12)
  const zTop = cz + h * 0.5
  const zBottom = cz - h * 0.5
  for (let i = 0; i < radialSteps; i += 1) {
    const angle = (Math.PI * 2 * i) / radialSteps
    positions[i * 3] = cx + r * Math.cos(angle)
    positions[i * 3 + 1] = cy + r * Math.sin(angle)
    positions[i * 3 + 2] = zBottom
    positions[(radialSteps + i) * 3] = cx + r * Math.cos(angle)
    positions[(radialSteps + i) * 3 + 1] = cy + r * Math.sin(angle)
    positions[(radialSteps + i) * 3 + 2] = zTop
  }
  positions[radialSteps * 2 * 3] = cx
  positions[radialSteps * 2 * 3 + 1] = cy
  positions[radialSteps * 2 * 3 + 2] = zBottom
  positions[(radialSteps * 2 + 1) * 3] = cx
  positions[(radialSteps * 2 + 1) * 3 + 1] = cy
  positions[(radialSteps * 2 + 1) * 3 + 2] = zTop
  const next = (i: number) => (i + 1) % radialSteps
  let o = 0
  for (let i = 0; i < radialSteps; i += 1) {
    // side wall (2 tris, outward CCW seen from outside with +Z up)
    indices[o] = i; indices[o + 1] = radialSteps + next(i); indices[o + 2] = next(i)
    indices[o + 3] = i; indices[o + 4] = radialSteps + i; indices[o + 5] = radialSteps + next(i)
    // bottom cap (facing -z)
    indices[o + 6] = i; indices[o + 7] = next(i); indices[o + 8] = radialSteps * 2
    // top cap (facing +z)
    indices[o + 9] = radialSteps + i; indices[o + 10] = radialSteps * 2 + 1; indices[o + 11] = radialSteps + next(i)
    o += 12
  }
  return {
    positions,
    indices,
    bounds: {
      min: [roundCamCoord(cx - r), roundCamCoord(cy - r), roundCamCoord(zBottom)],
      max: [roundCamCoord(cx + r), roundCamCoord(cy + r), roundCamCoord(zTop)],
    },
  }
}

/** makeStockMesh — CAM toolpath helper (BREP.io port).
 *
 *
 * @param decl - the decl value.
 * @returns StockMesh | null - computed result.
 */
export function makeStockMesh(decl: CamStockDecl | null): StockMesh | null {
  if (!decl) return null
  const center: [number, number, number] = decl.center || [0, 0, 0]
  if (decl.type === 'box') {
    const size = decl.size || [0, 0, 0]
    if (!(size[0] > 0 && size[1] > 0 && size[2] > 0)) return null
    return boxMesh(size, center)
  }
  if (decl.type === 'cylinder') {
    const radius = decl.radius || 0
    const height = decl.height || 0
    if (!(radius > 0 && height > 0)) return null
    return cylinderMesh(radius, height, center)
  }
  return null
}
