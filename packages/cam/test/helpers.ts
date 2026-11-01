/**
 * Shared test fixtures for @faicad/cam — a box mesh with optional faceRanges
 * (6 faces × 2 triangles each, matching the boxMesh winding in stock.ts).
 */
import type { CamPoint3 } from '../src/types.js'

export type BoxMesh = {
  positions: Float32Array
  indices: Uint32Array
  faceRanges?: Array<{ start: number; count: number }>
}

export function makeBoxMesh(size: [number, number, number], center: [number, number, number] = [0, 0, 0]): BoxMesh {
  const [sx, sy, sz] = size
  const [cx, cy, cz] = center
  const hx = sx * 0.5
  const hy = sy * 0.5
  const hz = sz * 0.5
  const corners: CamPoint3[] = [
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
    faceRanges: faces.map((_, i) => ({ start: i * 2, count: 2 })),
  }
}

/** A shape-like fixture (positions/indices/faceRanges) that satisfies the
 * faijs Shape duck contract used by generate.ts. */
export function makeShapeFixture(size: [number, number, number]) {
  const mesh = makeBoxMesh(size)
  return {
    positions: mesh.positions,
    indices: mesh.indices,
    faceRanges: mesh.faceRanges,
  }
}
