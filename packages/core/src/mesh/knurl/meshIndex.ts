/**
 * meshIndex.ts — 顶点去重哈希表，从 stlTexturizer/js/meshIndex.js 移植为 TS。
 *
 * QuantizedPointMap: 开放寻址哈希表，零分配查询，精确整数 key 比较。
 * 用于全 mesh 顶点去重：相同位置的多个副本（非 indexed 三角面 soup）共享一个 ID。
 */

/**
 * Open-addressing hash table that deduplicates quantized 3D points. Queries
 * allocate nothing and compare exact integer keys, so identical positions in a
 * non-indexed triangle soup share a single ID.
 */
export class QuantizedPointMap {
  private quant: number
  private _cap!: number
  private _mask!: number
  private _qx!: Float64Array
  private _qy!: Float64Array
  private _qz!: Float64Array
  private _val!: Int32Array
  private _size = 0
  /** True when the last getOrSet call inserted a new key. */
  inserted = false

  constructor(quant: number, expected: number = 256) {
    this.quant = quant
    let cap = 16
    const target = Math.max(16, Math.ceil(expected / 0.6))
    while (cap < target) cap *= 2
    this._alloc(cap)
  }

  /** Number of unique keys currently stored. */
  get size(): number {
    return this._size
  }

  private _alloc(cap: number): void {
    this._cap = cap
    this._mask = cap - 1
    this._qx = new Float64Array(cap)
    this._qy = new Float64Array(cap)
    this._qz = new Float64Array(cap)
    this._val = new Int32Array(cap).fill(-1)
  }

  private _slot(qx: number, qy: number, qz: number): number {
    let h =
      (Math.imul(qx | 0, 0x9e3779b1) ^
        Math.imul(qy | 0, 0x85ebca77) ^
        Math.imul(qz | 0, 0xc2b2ae3d)) |
      0
    h ^= h >>> 15
    let i = h & this._mask
    const { _qx, _qy, _qz, _val, _mask } = this
    while (_val[i] !== -1) {
      if (_qx[i] === qx && _qy[i] === qy && _qz[i] === qz) return i
      i = (i + 1) & _mask
    }
    return i
  }

  private _grow(): void {
    const oqx = this._qx,
      oqy = this._qy,
      oqz = this._qz,
      oval = this._val,
      ocap = this._cap
    this._alloc(ocap * 2)
    for (let i = 0; i < ocap; i++) {
      if (oval[i] === -1) continue
      const s = this._slot(oqx[i], oqy[i], oqz[i])
      this._qx[s] = oqx[i]
      this._qy[s] = oqy[i]
      this._qz[s] = oqz[i]
      this._val[s] = oval[i]
    }
  }

  /**
   * Look up the value stored for (x, y, z), or -1 when the key is absent.
   *
   * @param x - the x coordinate.
   * @param y - the y coordinate.
   * @param z - the z coordinate.
   * @returns the stored value, or -1 when not present.
   */
  get(x: number, y: number, z: number): number {
    const q = this.quant
    const i = this._slot(
      Math.round(x * q),
      Math.round(y * q),
      Math.round(z * q),
    )
    return this._val[i]
  }

  /**
   * Return the value stored for (x, y, z); when the key is new, store `value`
   * first and report the insertion on `inserted`.
   *
   * @param x - the x coordinate.
   * @param y - the y coordinate.
   * @param z - the z coordinate.
   * @param value - the value to store when the key is new.
   * @returns the existing stored value, or `value` after insertion.
   */
  getOrSet(x: number, y: number, z: number, value: number): number {
    const q = this.quant
    const qx = Math.round(x * q),
      qy = Math.round(y * q),
      qz = Math.round(z * q)
    const i = this._slot(qx, qy, qz)
    const existing = this._val[i]
    if (existing !== -1) {
      this.inserted = false
      return existing
    }
    this._qx[i] = qx
    this._qy[i] = qy
    this._qz[i] = qz
    this._val[i] = value
    this.inserted = true
    if (++this._size > this._cap * 0.7) this._grow()
    return value
  }
}

/**
 * Weld a non-indexed position buffer: give each vertex the sequential ID of
 * its quantized position, with the first occurrence winning.
 *
 * @param pos - the interleaved xyz position buffer.
 * @param count - the number of vertices in the buffer.
 * @param quant - quantization multiplier used to round positions.
 * @returns the per-vertex canonical ID and the number of unique positions.
 */
export function weldVertices(
  pos: Float32Array | Float64Array,
  count: number,
  quant: number,
): { vertexId: Uint32Array; uniqueCount: number } {
  const map = new QuantizedPointMap(quant, Math.min(count, 1 << 22))
  const vertexId = new Uint32Array(count)
  let nextId = 0
  for (let i = 0; i < count; i++) {
    const id = map.getOrSet(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], nextId)
    if (map.inserted) nextId++
    vertexId[i] = id
  }
  return { vertexId, uniqueCount: nextId }
}
