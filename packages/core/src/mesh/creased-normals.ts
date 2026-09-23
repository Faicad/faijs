/**
 * creased-normals.ts — dependency-free creased (folded) normal computation.
 *
 * The engine's own port of three's `toCreasedNormals`
 * (three/examples/jsm/utils/BufferGeometryUtils.js). Why a port instead of an
 * import: the three helper drags the whole `three` package into any consumer
 * (weapp main thread cannot hold two three copies — see 3d_editor weapp plan
 * §1.1.1 "no three via dependency packages"), while the algorithm itself is
 * pure array math.
 *
 * Semantics are aligned with three r162..r184 `toCreasedNormals` line by line:
 * - input is expanded to non-indexed triangles (indexed geometry is unwound);
 *   output is always non-indexed (positions count = triangleCount * 3, indices = null);
 * - a face normal is computed per triangle and pushed onto hash buckets of its
 *   3 vertices (hash = trunc(x * 100 * (1 + 1e-10)) per component, same
 *   quantization as three's `hashVertex`);
 * - each vertex normal = normalize(sum of bucket normals whose dot with the
 *   face normal exceeds cos(creaseAngleDeg)) — sharp edges split, smooth
 *   surfaces (drill walls) stay averaged;
 * - degenerate (zero-area) faces yield NaN normals exactly like three's
 *   divide-by-zero; callers treat that as invalid geometry upstream.
 */

export interface CreasedNormalsInput {
  /** Triangle positions, xyz interleaved, length = n * 3. */
  positions: Float32Array
  /** Triangle vertex indices, length = n * 3 (n = triangle count). `null` = sequential. */
  indices: Uint32Array | null
  /** Dihedral-angle threshold in degrees above which normals split (default 60). */
  creaseAngleDeg?: number
}

/**
 * Creased-normals computation input/output (dependency-free surface).
 */
export interface CreasedNormalsResult {
  /** Non-indexed positions (indexed input is expanded). */
  positions: Float32Array
  /** Per-vertex creased normals, xyz interleaved. */
  normals: Float32Array
  /** Always null — creased normals cannot be expressed on shared vertices. */
  indices: null
}

const HASH_MULTIPLIER = (1 + 1e-10) * 1e2

function hashVertex(x: number, y: number, z: number): string {
  // Same truncation semantics as three: `~~` (32-bit trunc) on scaled coords.
  const hx = ~~(x * HASH_MULTIPLIER)
  const hy = ~~(y * HASH_MULTIPLIER)
  const hz = ~~(z * HASH_MULTIPLIER)
  return `${hx},${hy},${hz}`
}

/**
 * Derive creased (folded) normals from raw triangle data — the dependency-free
 * equivalent of three's `toCreasedNormals`. See the module header for the
 * aligned semantics.
 * @param input - positions (+ optional indices) and the crease angle threshold.
 * @returns non-indexed positions plus per-vertex creased normals.
 */
export function deriveCreasedNormalsData(input: CreasedNormalsInput): CreasedNormalsResult {
  const { indices, creaseAngleDeg = 60 } = input
  const srcPos = input.positions

  const triCount = indices ? indices.length / 3 : srcPos.length / 9

  // Expand to non-indexed triangles (three: geometry.toNonIndexed()).
  const pos = new Float32Array(triCount * 9)
  for (let t = 0; t < triCount; t++) {
    for (let v = 0; v < 3; v++) {
      const srcIdx = indices ? indices[t * 3 + v] : t * 3 + v
      pos[t * 9 + v * 3 + 0] = srcPos[srcIdx * 3 + 0]
      pos[t * 9 + v * 3 + 1] = srcPos[srcIdx * 3 + 1]
      pos[t * 9 + v * 3 + 2] = srcPos[srcIdx * 3 + 2]
    }
  }

  const creaseDot = Math.cos((creaseAngleDeg * Math.PI) / 180)

  // Pass 1: face normals into per-vertex hash buckets.
  const vertexMap = new Map<string, number[][]>()
  const fnx = new Float32Array(triCount)
  const fny = new Float32Array(triCount)
  const fnz = new Float32Array(triCount)

  for (let t = 0; t < triCount; t++) {
    const ax = pos[t * 9 + 0], ay = pos[t * 9 + 1], az = pos[t * 9 + 2]
    const bx = pos[t * 9 + 3], by = pos[t * 9 + 4], bz = pos[t * 9 + 5]
    const cx = pos[t * 9 + 6], cy = pos[t * 9 + 7], cz = pos[t * 9 + 8]

    // cb = c - b, ab = a - b; normal = cb × ab (same edge order as three).
    const e1x = cx - bx, e1y = cy - by, e1z = cz - bz
    const e2x = ax - bx, e2y = ay - by, e2z = az - bz
    let nx = e1y * e2z - e1z * e2y
    let ny = e1z * e2x - e1x * e2z
    let nz = e1x * e2y - e1y * e2x
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len > 0) {
      nx /= len; ny /= len; nz /= len
    }
    fnx[t] = nx; fny[t] = ny; fnz[t] = nz

    for (let v = 0; v < 3; v++) {
      const h = hashVertex(pos[t * 9 + v * 3], pos[t * 9 + v * 3 + 1], pos[t * 9 + v * 3 + 2])
      let bucket = vertexMap.get(h)
      if (!bucket) {
        bucket = []
        vertexMap.set(h, bucket)
      }
      bucket.push([nx, ny, nz])
    }
  }

  // Pass 2: average bucket normals within the crease threshold.
  const normals = new Float32Array(triCount * 9)
  for (let t = 0; t < triCount; t++) {
    for (let v = 0; v < 3; v++) {
      const h = hashVertex(pos[t * 9 + v * 3], pos[t * 9 + v * 3 + 1], pos[t * 9 + v * 3 + 2])
      const bucket = vertexMap.get(h)!
      let sx = 0, sy = 0, sz = 0
      for (let k = 0; k < bucket.length; k++) {
        const on = bucket[k]
        // Three uses `>` (strictly greater) — coplanar neighbours merge,
        // faces at exactly the crease angle do not.
        if (fnx[t] * on[0] + fny[t] * on[1] + fnz[t] * on[2] > creaseDot) {
          sx += on[0]; sy += on[1]; sz += on[2]
        }
      }
      const sl = Math.sqrt(sx * sx + sy * sy + sz * sz)
      // Divide unconditionally: a zero-length sum yields NaN, matching three's
      // divide-by-zero behavior on degenerate geometry.
      normals[t * 9 + v * 3 + 0] = sx / sl
      normals[t * 9 + v * 3 + 1] = sy / sl
      normals[t * 9 + v * 3 + 2] = sz / sl
    }
  }

  return { positions: pos, normals, indices: null }
}
