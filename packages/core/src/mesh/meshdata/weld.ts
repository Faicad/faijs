/**
 * meshdata/weld — 顶点焊接（从 `boolean/geo-convert.ts` 迁出的共享实现）。
 *
 * 按 1e-6 量化位置把重复顶点焊成唯一顶点，并把索引用焊接后的编号重写。
 * 这是 mesh 面从「未焊接的生成几何」到「Shape」的统一收口，`geo-convert` 与
 * `meshdata` 共用同一实现（一个事实一个家，避免两份焊接逻辑漂移）。
 */

/** Interleaved positions + triangle indices (the raw mesh container). */
export interface MeshData {
  positions: Float32Array
  indices: Uint32Array
}

/**
 * Weld duplicate vertices by 1e-6-quantised position.
 * @param positions - flat position array (x, y, z, ...).
 * @param indices - triangle index array into `positions`.
 * @param count - number of indices to consume (defaults to the whole array).
 * @returns welded positions and rewritten indices.
 */
export function weldMesh(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  count: number = indices.length,
): MeshData {
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