/**
 * stdlib profile — 从 2D 轮廓构面（creator 函数，无输入，brep-only）。
 *
 * 用途：faijs 此前没有「从 2D 轮廓构造 planar face」的能力，导致草图轮廓无法喂给
 * extrude/revolve。本 op 接收 2D 轮廓（线段 + 圆弧），在 z=0 平面用 OCCT 构面：
 *   makeLineEdge/makeArcEdge → makeWire → makeFace（+ addHolesInFace）。
 *
 * 设计：
 * - 输入：{ contours: ProfileLoop[] }，每个 loop = 有序 segments（line / arc，z=0）。
 * - 外环 = 面积（shoelace）绝对值最大的 loop；其余 loop 作为孔。
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

/** `cad.profile` 参数：轮廓环集合（第一个为外环，其余为孔）。 */
export interface ProfileParams {
  contours: ProfileLoop[]
  /**
   * 产物形态：'face'（默认）构面；'wire' 只交出不带面的外环 wire（1D 曲线），
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

/**
 * BREP 路径：2D 轮廓 → planar face（外环 + 孔），或 'wire' 形态仅交外环 wire。
 *
 * 导出供 `@faicad/faijs-sketch` 等下游库复用——构面实现单点，草图求解结果经此构面。
 *
 * @param params - 轮廓环集合与产物形态。
 * @returns Shape（`as:'wire'` 时为 1D 曲线）。
 */
export function buildProfileShape(params: ProfileParams): Shape {
  const kernel = getBrepApi()
  const as = params.as ?? 'face'

  const loops = params.contours.map((loop) => ({ loop, area: Math.abs(loopSignedArea(loop)) }))
  // 面积最大者为外环，其余为孔
  let outerIdx = 0
  for (let i = 1; i < loops.length; i++) {
    if (loops[i]!.area > loops[outerIdx]!.area) outerIdx = i
  }

  const outerWire = loopToWire(kernel, loops[outerIdx]!.loop)

  // 'wire' 形态：只交外环 wire（1D 曲线），不构面 —— 供扫掠族作 spine。
  if (as === 'wire') {
    return fromBrepCurve(solidToShape(kernel, outerWire), { solid: outerWire })
  }

  const face = kernel.makeFace(outerWire)

  const holeWires: ReturnType<BrepEngineApi['makeWire']>[] = []
  for (let i = 0; i < loops.length; i++) {
    if (i === outerIdx) continue
    holeWires.push(loopToWire(kernel, loops[i]!.loop))
  }
  if (holeWires.length > 0) {
    const faced = kernel.addHolesInFace(face, holeWires)
    kernel.release(face)
    return fromBrep(solidToShape(kernel, faced), { solid: faced })
  }

  kernel.release(outerWire)
  return fromBrep(solidToShape(kernel, face), { solid: face })
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