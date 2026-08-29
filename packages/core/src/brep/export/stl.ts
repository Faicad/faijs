/**
 * buildStlBufferFromMesh — L1 纯数据 STL 导出（无 THREE 依赖）
 *
 *
 * 从原始 positions + indices 构建 binary STL buffer。
 * 与 src/renderer/lib/build-stl.ts 的 buildStlBuffer() 功能相同，
 * 但不依赖 THREE.BufferGeometry，可在 Node 环境直接使用。
 *
 * Binary STL format:
 *   bytes 0-79:    80-byte header
 *   bytes 80-83:   4-byte uint32 triangle count N
 *   bytes 84+:     N × 50-byte triangles
 *     - normal:   3 × float32 (12 bytes)
 *     - vertex1:  3 × float32 (12 bytes)
 *     - vertex2:  3 × float32 (12 bytes)
 *     - vertex3:  3 × float32 (12 bytes)
 *     - attr:     2 bytes (0)
 */

export function buildStlBufferFromMesh(
  positions: Float32Array,
  indices: Uint32Array,
  header?: string,
): ArrayBuffer {
  const triCount = indices.length / 3

  const headerSize = 80
  const countSize = 4
  const triByteSize = 50 // 12 (normal) + 12*3 (vertices) + 2 (attr)
  const totalSize = headerSize + countSize + triCount * triByteSize

  const buffer = new ArrayBuffer(totalSize)
  const dv = new DataView(buffer)

  // Header (80 bytes)
  const headerStr = header ?? 'Faicad STL'
  for (let i = 0; i < Math.min(headerStr.length, 80); i++) {
    dv.setUint8(i, headerStr.charCodeAt(i))
  }

  // Triangle count
  dv.setUint32(80, triCount, true)

  // Triangles
  for (let i = 0; i < triCount; i++) {
    const base = 84 + i * 50
    const ia = indices[i * 3]!
    const ib = indices[i * 3 + 1]!
    const ic = indices[i * 3 + 2]!

    const ax = positions[ia * 3]
    const ay = positions[ia * 3 + 1]
    const az = positions[ia * 3 + 2]
    const bx = positions[ib * 3]
    const by = positions[ib * 3 + 1]
    const bz = positions[ib * 3 + 2]
    const cx = positions[ic * 3]
    const cy = positions[ic * 3 + 1]
    const cz = positions[ic * 3 + 2]

    // Compute face normal: cross(B-A, C-A)
    const ux = bx - ax
    const uy = by - ay
    const uz = bz - az
    const vx = cx - ax
    const vy = cy - ay
    const vz = cz - az
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (nlen > 0) {
      nx /= nlen
      ny /= nlen
      nz /= nlen
    }

    // Normal
    dv.setFloat32(base + 0, nx, true)
    dv.setFloat32(base + 4, ny, true)
    dv.setFloat32(base + 8, nz, true)

    // Vertex A
    dv.setFloat32(base + 12, ax, true)
    dv.setFloat32(base + 16, ay, true)
    dv.setFloat32(base + 20, az, true)

    // Vertex B
    dv.setFloat32(base + 24, bx, true)
    dv.setFloat32(base + 28, by, true)
    dv.setFloat32(base + 32, bz, true)

    // Vertex C
    dv.setFloat32(base + 36, cx, true)
    dv.setFloat32(base + 40, cy, true)
    dv.setFloat32(base + 44, cz, true)

    // Attribute (2 bytes, usually 0)
    dv.setUint16(base + 48, 0, true)
  }

  return buffer
}
