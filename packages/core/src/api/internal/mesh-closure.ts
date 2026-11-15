/**
 * internal/mesh-closure — 网格闭合性判定（共享叶子模块）
 *
 * 2026-11-14 从 `boolean-closure.ts` 抽出的共用件：布尔操作数校验（OpenSCAD 口径）
 * 与 `cad.validateSolid`（产物体检）必须用**同一份**判定，否则两处口径会分叉——
 * 同一件几何在布尔入口被判"闭合"、在体检出口被判"漏水"是最坏的形态。
 *
 * 判据（沿用原实现，不改）：
 * - 顶点按坐标量化去重（`round(x*1e6)`），容忍接缝处因 flat/uv 法向切分导致的索引
 *   重复顶点（它们位置相同，必须视作同一顶点，否则会假报边界边）。
 * - 每条无向边的计数应为 2（闭合实体）。计数 1 = 边界边（洞）；计数 ≥3 = 非流形边。
 * - **不**剔除退化三角。issue802 的 `polyhedron#2` 含 20 个重复坐标点但全边计数为 2，
 *   OpenSCAD 保留了它——擅自剔除会改掉判定口径。
 */

/** 网格闭合性报告。 */
export interface MeshClosureReport {
  /** 全部无向边计数为 2（闭合实体）。 */
  closed: boolean
  /** 边计数直方图 `{count: edgeCount}`（定位碎片靠它：count≥3 即非流形）。 */
  hist: Record<number, number>
  /** 三角数。 */
  tris: number
  /** 边计数 == 1 的边数（边界边 = 洞的边界）。 */
  boundaryEdges: number
  /** 边计数 > 2 的边数（非流形边）。 */
  nonmanifoldEdges: number
  /** 边计数 != 2 的边数（= boundaryEdges + nonmanifoldEdges）。 */
  irregularEdges: number
}

/**
 * 按无向边计数判定网格闭合性。
 *
 * @param pos - 顶点坐标（每 3 个一组）。
 * @param idx - 三角索引（每 3 个一组）。
 * @returns 闭合性报告；无三角时 `closed:false`、`tris:0`。
 */
export function meshClosure(pos: Float32Array, idx: Uint32Array): MeshClosureReport {
  const triCount = Math.floor(idx.length / 3)
  const empty: MeshClosureReport = {
    closed: false,
    hist: {},
    tris: 0,
    boundaryEdges: 0,
    nonmanifoldEdges: 0,
    irregularEdges: 0,
  }
  if (triCount === 0) return empty
  const vCanon = new Map<number, number>()
  const keyToId = new Map<string, number>()
  let nextId = 0
  const canon = (vi: number): number => {
    let id = vCanon.get(vi)
    if (id === undefined) {
      const x = pos[vi * 3] ?? 0
      const y = pos[vi * 3 + 1] ?? 0
      const z = pos[vi * 3 + 2] ?? 0
      const k = `${Math.round(x * 1e6)}|${Math.round(y * 1e6)}|${Math.round(z * 1e6)}`
      id = keyToId.get(k)
      if (id === undefined) {
        id = nextId++
        keyToId.set(k, id)
      }
      vCanon.set(vi, id)
    }
    return id
  }
  const edgeCount = new Map<string, number>()
  const bump = (u: number, v: number): void => {
    const k = u < v ? `${u}|${v}` : `${v}|${u}`
    edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1)
  }
  for (let t = 0; t < triCount; t++) {
    const a = canon(idx[t * 3]!)
    const b = canon(idx[t * 3 + 1]!)
    const c = canon(idx[t * 3 + 2]!)
    bump(a, b)
    bump(b, c)
    bump(c, a)
  }
  const hist: Record<number, number> = {}
  let closed = true
  let boundaryEdges = 0
  let nonmanifoldEdges = 0
  for (const count of edgeCount.values()) {
    hist[count] = (hist[count] ?? 0) + 1
    if (count === 1) boundaryEdges++
    else if (count > 2) nonmanifoldEdges++
    if (count !== 2) closed = false
  }
  return {
    closed,
    hist,
    tris: triCount,
    boundaryEdges,
    nonmanifoldEdges,
    irregularEdges: boundaryEdges + nonmanifoldEdges,
  }
}
