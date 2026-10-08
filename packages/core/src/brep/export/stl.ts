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

/**
 * Compose two row-major 3×4 affine matrices (implicit homogeneous row [0,0,0,1]).
 * Returns B∘A: apply A first, then B. Used to accumulate a node's local transform
 * onto its parent's world transform during assembly flattening (方案 §2.1 / §5).
 *
 * @param a - 先应用的内层矩阵（子节点局部 transform）。
 * @param b - 后应用的外层矩阵（父节点累积 transform）。
 * @returns 复合后的行主序 3×4 仿射矩阵（12 元组）。
 */
export function composeMatrix12(a: number[], b: number[]): number[] {
  const C = new Array<number>(12).fill(0)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0
      for (let k = 0; k < 3; k++) s += b[r * 4 + k]! * a[k * 4 + c]!
      C[r * 4 + c] = s
    }
    let t = 0
    for (let k = 0; k < 3; k++) t += b[r * 4 + k]! * a[k * 4 + 3]!
    C[r * 4 + 3] = t + b[r * 4 + 3]!
  }
  return C
}

/**
 * Apply a row-major 3×4 affine matrix (implicit homogeneous [0,0,0,1]) to every
 * vertex of an interleaved position buffer, returning a new buffer (STL 顶点烘焙).
 *
 * @param positions - 交错的顶点坐标缓冲（每顶点 x,y,z）。
 * @param m - 行主序 3×4 仿射矩阵（12 元组，隐式齐次行 [0,0,0,1]）。
 * @returns 烘焙后的新缓冲（不修改入参）。
 */
export function bakeMatrix12ToPositions(positions: Float32Array, m: number[]): Float32Array {
  const out = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!
    const y = positions[i + 1]!
    const z = positions[i + 2]!
    out[i] = m[0]! * x + m[1]! * y + m[2]! * z + m[3]!
    out[i + 1] = m[4]! * x + m[5]! * y + m[6]! * z + m[7]!
    out[i + 2] = m[8]! * x + m[9]! * y + m[10]! * z + m[11]!
  }
  return out
}

/**
 * Build a binary STL buffer from raw positions and indices (no THREE dependency).
 * @param positions - the interleaved vertex positions (x,y,z per vertex).
 * @param indices - the triangle indices (3 indices per triangle).
 * @param header - optional 80-byte header text (defaults to 'Faicad STL').
 * @param transform - optional row-major 3×4 affine matrix (12-tuple). When given,
 *        every vertex is baked through it before writing (STL 顶点烘焙, 方案 §2.1 / §5).
 * @returns an ArrayBuffer holding the binary STL data.
 */
export function buildStlBufferFromMesh(
  positions: Float32Array,
  indices: Uint32Array,
  header?: string,
  transform?: number[],
): ArrayBuffer {
  const triCount = indices.length / 3
  const pos = transform ? bakeMatrix12ToPositions(positions, transform) : positions

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

    const ax = pos[ia * 3]
    const ay = pos[ia * 3 + 1]
    const az = pos[ia * 3 + 2]
    const bx = pos[ib * 3]
    const by = pos[ib * 3 + 1]
    const bz = pos[ib * 3 + 2]
    const cx = pos[ic * 3]
    const cy = pos[ic * 3 + 1]
    const cz = pos[ic * 3 + 2]

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
