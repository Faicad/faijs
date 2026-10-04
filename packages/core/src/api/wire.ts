/**
 * api wire — 从点列构造 1D 曲线（折线 / 闭合轮廓 / 平滑样条）
 *
 * 用途：脚本面造线能力（G-D 门控层，Phase 3）。下游 sweep / loft / twistExtrude /
 * complexExtrude / roof 等 11 个动作都需要 wire 输入；此前脚本面造不出 wire，这些动作
 * 即使登记也喂不进输入。
 *
 * 设计：
 * - 中立 op（dual-path）：mesh 路径用折线 mesh 包成 `curve(mesh)`；brep 路径用 L1 构造
 *   （makeLineEdge / interpolatePoints + makeWire），经 `fromBrepCurve` 登记 1D 句柄。
 *   两种 mode 下 kind 都取 'curve'，避免随 mode 漂移（§7.1 建议 1 / 附带子项②推荐 (i)）。
 * - 无输入（creator），故 dispatch 走 mesh（mode=mesh）或 brep（mode=brep/auto 有 brep 实现）。
 * - 1D 产物命名取 unmodeled（无面 → 无 roleTable，先例 torus/convexHull）。
 */

import type { Shape } from '../mesh/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import type { BrepHandle, BrepVec3 } from '../brep/engine/types'
import { getBrepApi } from '../brep/handle-bridge'
import { solidToShape } from '../brep/brep-ops'
import { curve, fromBrepCurve } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'

/** 一个 3D 点（点列成员）。 */
export type WirePoint = [number, number, number]

/** `cad.wire` 选项：折线 / 闭合轮廓 / 平滑曲线。 */
export interface WireOptions {
  /** 闭合轮廓：首尾相连。 */
  closed?: boolean
  /** 平滑曲线：经 interpolatePoints 走 B-样条穿过全部点（默认折线）。 */
  smooth?: boolean
  /** smooth 时的样条次数（默认 3）。 */
  degree?: number
}

/** 校验并归一化点列（至少 2 点，每点 [x,y,z]）。 */
function normalizePoints(raw: unknown): BrepVec3[] {
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error('E_WIRE_TOO_FEW_POINTS: wire requires at least 2 points')
  }
  const pts: BrepVec3[] = []
  for (const p of raw as unknown[]) {
    if (!Array.isArray(p) || p.length < 3) {
      throw new Error('E_WIRE_BAD_POINT: each wire point must be [x, y, z]')
    }
    pts.push({ x: Number(p[0]), y: Number(p[1]), z: Number(p[2]) })
  }
  return pts
}

/** mesh 路径：折线 mesh 载荷（位置 + 线段索引），包成 curve（kind 维持 'curve'）。 */
function wireMesh(points: WirePoint[], opts?: WireOptions): Shape {
  const pts = normalizePoints(points)
  const closed = !!(opts && opts.closed)
  const positions: number[] = []
  for (const p of pts) positions.push(p.x, p.y, p.z)
  if (closed) positions.push(pts[0]!.x, pts[0]!.y, pts[0]!.z)
  const n = pts.length + (closed ? 1 : 0)
  const indices: number[] = []
  for (let i = 0; i < n - 1; i++) indices.push(i, i + 1)
  return curve({ positions: new Float32Array(positions), indices: new Uint32Array(indices) })
}

/** BREP 路径：点列 → wire（折线或平滑样条），经 fromBrepCurve 登记 1D 句柄。 */
function wireBrep(points: WirePoint[], opts?: WireOptions): Shape {
  const pts = normalizePoints(points)
  const closed = !!(opts && opts.closed)
  const smooth = !!(opts && opts.smooth)
  const kernel: BrepEngineApi = getBrepApi()
  let handle: unknown
  if (smooth && pts.length >= 2) {
    // 平滑曲线：interpolatePoints 返回穿过全部点的 B-样条（曲线/线柄），直接作为 wire 载荷。
    const degree = typeof opts?.degree === 'number' ? opts.degree : 3
    handle = kernel.interpolatePoints(pts, degree)
  } else {
    const edges: BrepHandle[] = []
    const segCount = closed ? pts.length : pts.length - 1
    for (let i = 0; i < segCount; i++) {
      const a = pts[i]!
      const b = pts[(i + 1) % pts.length]!
      edges.push(kernel.makeLineEdge(a, b))
    }
    handle = kernel.makeWire(edges)
  }
  return fromBrepCurve(solidToShape(kernel, handle as BrepHandle), { solid: handle as BrepHandle })
}

/**
 * 从点列构造 1D 曲线（折线 / 闭合轮廓 / 平滑样条）。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name wire
 * @returns Shape 1D 曲线（kind:'curve'，无三角载荷；显示经 wireframe）。
 * @param points - 有序点列 [[x,y,z], ...]，至少 2 点。type:Vec3[] required:true
 * @param options.closed - 闭合轮廓（首尾相连）。type:boolean required:false
 * @param options.smooth - 平滑曲线（B-样条穿过全部点，默认折线）。type:boolean required:false
 * @param options.degree - smooth 时的样条次数（默认 3）。type:number required:false
 * @example
 * const w = cad.wire([[0,0,0],[10,0,0],[10,10,0]], { closed: true })
 */
export const wire = defineOp({
  mesh(points: WirePoint[], opts?: WireOptions) {
    return wireMesh(points, opts)
  },
  brep(points: WirePoint[], opts?: WireOptions) {
    return wireBrep(points, opts)
  },
  naming: { kind: 'unmodeled', reason: 'construct vocabulary pending Phase 3' } as Provenance,
})
