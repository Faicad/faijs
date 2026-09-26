/**
 * stdlib profile — 从 2D 轮廓构面（creator 函数，无输入，brep-only）。
 *
 * 用途：faijs 此前没有「从 2D 轮廓构造 planar face」的能力，导致草图轮廓无法喂给
 * extrude/revolve。本 op 接收 2D 轮廓（线段 + 圆弧），在 z=0 平面用 OCCT 构面：
 *   makeLineEdge/makeArcEdge → makeWire → makeFace（+ addHolesInFace）。
 *
 * 设计：
 * - 输入：{ contours: ProfileLoop[] }，每个 loop = 有序 segments（line / arc，z=0）。
 * - 环语义：嵌套 = 孔，不相交 = 独立岛（多岛 → face 的 compound），见 buildProfileShape。
 * - 圆弧：用起点/中点/终点三点的 makeArcEdge；整圆（sweep≈2π）拆成两段弧。
 * - 输出：Shape（mesh 三角化 + 句柄登记）。brep-only（下游 extrude/revolve 亦 brep-only）。
 *
 * 坐标系：输入 2D 点即 (x, y, 0)，法向 +Z；草图在 Body 局部系内的定位由调用方（fcstd 端口）
 * 在轮廓坐标里预先变换，或由下游特征的 Placement 承担。
 */

import type { Shape } from '../mesh/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { getBrepApi } from '../brep/handle-bridge'
import { solidToShape } from '../brep/brep-ops'
import { fromBrep, fromBrepCurve } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'

// ── 参数形状（与 fcstd Contour 结构相同，避免引擎依赖端口层）──

/** 直线段（2D，z=0；端点为绝对坐标）。 */
export interface ProfileLineSeg {
  kind: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
}

/** 圆弧段（圆心 + 半径 + 起止角，弧度；z=0）。 */
export interface ProfileArcSeg {
  kind: 'arc'
  cx: number
  cy: number
  radius: number
  /** 起始角（弧度） */
  startAngle: number
  /** 终止角（弧度） */
  endAngle: number
  ccw: boolean
  x1: number
  y1: number
  x2: number
  y2: number
}

/** 一条有序 2D 轮廓段（直线或圆弧）。 */
export type ProfileSeg = ProfileLineSeg | ProfileArcSeg

/** 单个轮廓环：有序段序列（首尾相接）。 */
export interface ProfileLoop {
  segments: ProfileSeg[]
}

/** `cad.profile` 参数：轮廓环集合。语义见 {@link buildProfileShape}（嵌套=孔，不相交=独立岛）。 */
export interface ProfileParams {
  contours: ProfileLoop[]
  /**
   * 产物形态：'face'（默认）构面；'wire' 只交出不带面的最大岛外环 wire（1D 曲线），
   * 供扫掠族（sweep/loft/…）直接作 spine。'wire' 形态丢弃孔环（扫掠脊柱为单闭合轮廓）。
   */
  as?: 'face' | 'wire'
}

// ── 参数自校验 ──

/**
 * Validate profile parameters: `contours` must be a non-empty array of loops,
 * each with at least one segment.
 * @param params the raw profile operation parameters.
 */
export function assertProfileParams(params: Record<string, unknown>): void {
  const contours = params.contours
  if (!Array.isArray(contours) || contours.length === 0) {
    throw new Error('E_PROFILE_NO_CONTOURS: profile requires at least one contour')
  }
  for (const loop of contours) {
    if (!loop || typeof loop !== 'object' || !Array.isArray((loop as ProfileLoop).segments)) {
      throw new Error('E_PROFILE_BAD_LOOP: each contour must have a segments array')
    }
    if ((loop as ProfileLoop).segments.length === 0) {
      throw new Error('E_PROFILE_EMPTY_LOOP: a contour must have at least one segment')
    }
  }
}

/**
 * 单环带符号面积（对每段做有向面积积分，而非只用段起点 shoelace）。
 *
 * 直线段：1/2 (x1·y2 − x2·y1)。
 * 圆弧段：1/2 ∫(x dy − y dx) 的解析解 = 1/2 [r²·sweep + cx·r(sin a1 − sin a0) − cy·r(cos a1 − cos a0)]。
 * 整圆（单段弧、起终点重合）由此得到 πr²，不再是 0——否则「整圆 + 方孔」会把孔误判成外环。
 */
function loopSignedArea(loop: ProfileLoop): number {
  let a = 0
  for (const seg of loop.segments) {
    if (seg.kind === 'line') {
      a += (seg.x1 * seg.y2 - seg.x2 * seg.y1) / 2
      continue
    }
    let sweep = seg.endAngle - seg.startAngle
    while (sweep <= 0) sweep += 2 * Math.PI
    while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI
    const { cx, cy, radius: r, startAngle: a0 } = seg
    const a1 = a0 + sweep
    a += 0.5 * (r * r * sweep + cx * r * (Math.sin(a1) - Math.sin(a0)) - cy * r * (Math.cos(a1) - Math.cos(a0)))
  }
  return a
}

/** 圆弧 → 一条或两条 makeArcEdge（整圆拆分）。 */
function arcToHandles(
  kernel: BrepEngineApi,
  seg: ProfileArcSeg,
): ReturnType<BrepEngineApi['makeArcEdge']>[] {
  const { cx, cy, radius, startAngle, endAngle, ccw = true } = seg
  // GOTCHA（2026-09-25，A3 FCBL_tree_entourage）：ccw 必须参与弧的几何方向。
  // makeArcEdge 按「起点-中点-终点」三点定弧，旧实现一律取 CCW 中点
  // ((start+end)/2 归一化到 (0,2π])，ccw:false 的弧被画成 CCW **长弧**（补角）。
  // 实测后果：长弧穿过旋转轴 → revolve 产物退化（bbox NaN）→ BRepMesh 挂死
  // （进程无声死亡）；正确 CW 短弧下内核 revolve 仅 ~19ms。
  let sweep: number
  let midAngle: number
  if (ccw) {
    sweep = endAngle - startAngle
    while (sweep <= 0) sweep += 2 * Math.PI
    while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI
    midAngle = startAngle + sweep / 2
  } else {
    // 顺时针：从 startAngle 递减到 endAngle，扫角取反向归一化
    sweep = startAngle - endAngle
    while (sweep <= 0) sweep += 2 * Math.PI
    while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI
    midAngle = startAngle - sweep / 2
  }

  const makeOne = (a0: number, am: number, a1: number): ReturnType<BrepEngineApi['makeArcEdge']> => {
    const start = { x: cx + radius * Math.cos(a0), y: cy + radius * Math.sin(a0), z: 0 }
    const m = { x: cx + radius * Math.cos(am), y: cy + radius * Math.sin(am), z: 0 }
    const end = { x: cx + radius * Math.cos(a1), y: cy + radius * Math.sin(a1), z: 0 }
    return kernel.makeArcEdge(start, m, end)
  }

  // 整圆（sweep≈2π）：拆成两段半圆，避免 makeArcEdge 起点≈终点退化
  if (sweep >= 2 * Math.PI - 1e-9) {
    const half = 2 * Math.PI / 2
    const dir = ccw ? 1 : -1
    return [
      makeOne(startAngle, startAngle + dir * half / 2, startAngle + dir * half),
      makeOne(startAngle + dir * half, startAngle + dir * (half + half / 2), startAngle + dir * 2 * Math.PI),
    ]
  }
  return [makeOne(startAngle, midAngle, endAngle)]
}

/** 单环 → wire handle（仅构面，不释放中间句柄，遵循现有惯例）。 */
function loopToWire(kernel: BrepEngineApi, loop: ProfileLoop): ReturnType<BrepEngineApi['makeWire']> {
  const edges: ReturnType<BrepEngineApi['makeLineEdge']>[] = []
  for (const seg of loop.segments) {
    if (seg.kind === 'line') {
      edges.push(kernel.makeLineEdge({ x: seg.x1, y: seg.y1, z: 0 }, { x: seg.x2, y: seg.y2, z: 0 }))
    } else {
      // 极小扫角（退化弧）→ 退化为线段，避免构边失败
      let sweep = seg.endAngle - seg.startAngle
      while (sweep <= 0) sweep += 2 * Math.PI
      while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI
      if (sweep < 1e-9) {
        edges.push(kernel.makeLineEdge({ x: seg.x1, y: seg.y1, z: 0 }, { x: seg.x2, y: seg.y2, z: 0 }))
      } else {
        edges.push(...arcToHandles(kernel, seg))
      }
    }
  }
  return kernel.makeWire(edges as ReturnType<BrepEngineApi['makeLineEdge']>[])
}

/** 环 → 2D 采样多边形（直线取端点、弧等角采样），用于环间包含性判定。 */
function loopToPolygon(loop: ProfileLoop): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = []
  for (const seg of loop.segments) {
    if (seg.kind === 'line') {
      pts.push({ x: seg.x1, y: seg.y1 })
      continue
    }
    let sweep = seg.endAngle - seg.startAngle
    while (sweep <= 0) sweep += 2 * Math.PI
    while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI
    const n = Math.max(8, Math.ceil((sweep / (2 * Math.PI)) * 32))
    for (let k = 0; k < n; k++) {
      const a = seg.startAngle + (sweep * k) / n
      pts.push({ x: seg.cx + seg.radius * Math.cos(a), y: seg.cy + seg.radius * Math.sin(a) })
    }
  }
  return pts
}

/** 射线法：点是否在多边形内（采样多边形足够密，顶点/边界角落情形由环间不共边保证不出现）。 */
function polygonContains(poly: Array<{ x: number; y: number }>, px: number, py: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x
    const yi = poly[i]!.y
    const xj = poly[j]!.x
    const yj = poly[j]!.y
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * BREP 路径：2D 轮廓集合 → planar face 集合。
 *
 * GOTCHA（2026-09-26，Beds part16/39）：环语义是「**嵌套 = 孔，不相交 = 独立岛**」
 * （与 FreeCAD 草图一致），不是「面积最大者当外环、其余全当孔」。旧实现把双岛轮廓的
 * 第二个岛判成「洞外面」→ `addHolesInFace` 收到与外环不相交的 wire → 构面退化
 * （7 面、volume 0）。多岛产物 = compound（每岛一面、各带自己的孔），下游
 * `cad.extrude` 对 compound 输入逐面挤出（kernel MakePrism 收复合形状）。
 *
 * @param params - 轮廓环集合与产物形态。
 * @returns Shape（单岛为 face；多岛为 face 的 compound；`as:'wire'` 为 1D 曲线）。
 */
export function buildProfileShape(params: ProfileParams): Shape {
  const kernel = getBrepApi()
  const as = params.as ?? 'face'

  const loops = params.contours.map((loop) => ({ loop, area: Math.abs(loopSignedArea(loop)) }))

  // 包含分类：每个环的直接父环 = 面积最小的严格包含它的环；深度偶数 = 岛，奇数 = 父环的孔。
  const polys = loops.map((l) => loopToPolygon(l.loop))
  const parent = new Array<number>(loops.length).fill(-1)
  for (let i = 0; i < loops.length; i++) {
    const probe = polys[i]![0]!
    for (let j = 0; j < loops.length; j++) {
      if (i === j || loops[j]!.area <= loops[i]!.area) continue
      if (!polygonContains(polys[j]!, probe.x, probe.y)) continue
      if (parent[i] === -1 || loops[j]!.area < loops[parent[i]]!.area) parent[i] = j
    }
  }
  const depthOf = (i: number): number => {
    let d = 0
    let cur = i
    while (parent[cur] !== -1) {
      d++
      cur = parent[cur]!
    }
    return d
  }

  const islands: number[] = []
  const holesOf = new Map<number, number[]>()
  for (let i = 0; i < loops.length; i++) {
    if (depthOf(i) % 2 === 0) islands.push(i)
    else {
      const p = parent[i]!
      const arr = holesOf.get(p)
      if (arr) arr.push(i)
      else holesOf.set(p, [i])
    }
  }

  // 'wire' 形态：只交最大岛的外环 wire（1D 曲线），不构面 —— 供扫掠族作 spine。
  if (as === 'wire') {
    let outer = islands[0]!
    for (const isl of islands) {
      if (loops[isl]!.area > loops[outer]!.area) outer = isl
    }
    const wire = loopToWire(kernel, loops[outer]!.loop)
    return fromBrepCurve(solidToShape(kernel, wire), { solid: wire })
  }

  // 每岛一面（岛环为外环，直接子环为孔）
  const faces: ReturnType<BrepEngineApi['makeFace']>[] = []
  for (const isl of islands) {
    const wire = loopToWire(kernel, loops[isl]!.loop)
    const face = kernel.makeFace(wire)
    const holes = holesOf.get(isl)
    if (holes && holes.length > 0) {
      const holeWires = holes.map((h) => loopToWire(kernel, loops[h]!.loop))
      const faced = kernel.addHolesInFace(face, holeWires)
      kernel.release(face)
      faces.push(faced)
    } else {
      faces.push(face)
    }
  }

  if (faces.length === 1) {
    const f = faces[0]!
    return fromBrep(solidToShape(kernel, f), { solid: f })
  }
  const compound = kernel.makeCompound(faces as never)
  return fromBrep(solidToShape(kernel, compound), { solid: compound })
}

/**
 * 从 2D 轮廓构造平面（creator，无输入）。仅 BREP 可用。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name profile
 * @returns Shape 平面几何（mesh 三角化 + BREP 句柄）；`as:'wire'` 时返回 1D 曲线（kind:'curve'）。
 * @param params.contours - 有序 2D 轮廓（线段/圆弧；外环 + 孔）。type:ProfileLoop[] required:true
 * @param params.as - 产物形态：'face'（默认）构面；'wire' 只交外环 wire（1D 曲线）。type:'face'|'wire' required:false
 * @example
 * const f = cad.profile({ contours: [{ segments: [{ kind:'line', x1:0,y1:0,x2:10,y2:0 }, ...] }] })
 * const w = cad.profile({ contours: [{ segments: [{ kind:'line', x1:0,y1:0,x2:10,y2:0 }, ...] }], as: 'wire' })
 */
export const profile = defineOp({
  capabilities: ['directEdit'],
  brep(params: Record<string, unknown>) {
    assertProfileParams(params)
    return buildProfileShape(params as unknown as ProfileParams)
  },
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [] } } as Provenance,
})