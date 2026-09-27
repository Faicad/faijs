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
import { Blueprint } from '../geometry2d/blueprint'
import { CompoundBlueprint } from '../geometry2d/compound-blueprint'
import { organiseBlueprints } from '../geometry2d/organise'
import { curveBounds, evaluateCurve2d } from '../geometry2d/curve2d'
import { profileSegToCurve, type ProfileSegLike } from '../geometry2d/adapt'

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

  const loops = params.contours.map((loop) => ({
    loop,
    curves: loop.segments.map((s) => profileSegToCurve(s as ProfileSegLike)),
  }))

  // F2（2026-09-27）：环分类统一到纯 2D 管线 `organiseBlueprints`
  // （geometry2d/，brepjs 移植）。「嵌套=孔，不相交=独立岛」语义与既有
  // `profile-multi-island.test.ts` 断言一致；多岛 → 多个顶层，岛+孔 →
  // CompoundBlueprint（[0]=外环，[1..]=孔）。
  const organised = organiseBlueprints(loops.map((l) => new Blueprint(l.curves)))

  // 'wire' 形态：只挑面积最大的岛的外环 wire（1D 曲线），供扫掠族作 spine。
  if (as === 'wire') {
    let best = organised.blueprints[0]!
    for (const entry of organised.blueprints) {
      if (blueprintArea(entry) > blueprintArea(best)) best = entry
    }
    const outerBp = best instanceof CompoundBlueprint ? best.blueprints[0]! : best
    const wire = blueprintToWire(kernel, outerBp)
    return fromBrepCurve(solidToShape(kernel, wire), { solid: wire })
  }

  // 每岛一面（岛的外环 + 直接子环为孔）
  const faces: ReturnType<BrepEngineApi['makeFace']>[] = []
  for (const entry of organised.blueprints) {
    if (entry instanceof CompoundBlueprint) {
      const outerWire = blueprintToWire(kernel, entry.blueprints[0]!)
      const face = kernel.makeFace(outerWire)
      const holes = entry.blueprints.slice(1).map((h) => blueprintToWire(kernel, h))
      if (holes.length > 0) {
        const faced = kernel.addHolesInFace(face, holes)
        kernel.release(face)
        faces.push(faced)
      } else {
        faces.push(face)
      }
    } else {
      faces.push(kernel.makeFace(blueprintToWire(kernel, entry)))
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
 * Convert a pure-2D Blueprint to a 3D wire (z=0) for planar face construction.
 * @param kernel - the BREP engine handle-bridge.
 * @param bp - the blueprint whose ordered curves become wire edges.
 * @returns the wire handle.
 */
function blueprintToWire(kernel: BrepEngineApi, bp: Blueprint): ReturnType<BrepEngineApi['makeWire']> {
  const edges: ReturnType<BrepEngineApi['makeLineEdge']>[] = []
  const pt3 = ([x, y]: [number, number]): { x: number; y: number; z: number } => ({ x, y, z: 0 })
  for (const c of bp.curves) {
    switch (c.kind2d) {
      case 'line':
        edges.push(kernel.makeLineEdge({ x: c.ox, y: c.oy, z: 0 }, { x: c.ox + c.dx * c.len, y: c.oy + c.dy * c.len, z: 0 }))
        break
      case 'bezier':
        edges.push(kernel.makeBezierEdge(c.poles.map(pt3)))
        break
      case 'circle': {
        // 完整圆：拆两段半圆 makeArcEdge（避免三点退化）。
        edges.push(kernel.makeArcEdge(pt3(evaluateCurve2d(c, 0)), pt3(evaluateCurve2d(c, Math.PI / 2)), pt3(evaluateCurve2d(c, Math.PI))))
        edges.push(kernel.makeArcEdge(pt3(evaluateCurve2d(c, Math.PI)), pt3(evaluateCurve2d(c, (3 * Math.PI) / 2)), pt3(evaluateCurve2d(c, 2 * Math.PI))))
        break
      }
      case 'trimmed': {
        if (c.basis.kind2d === 'circle') {
          // 圆弧：以 start/mid/end 三点构真实 makeArcEdge（保留光滑柱面，勿拆成折线段）
          edges.push(kernel.makeArcEdge(pt3(evaluateCurve2d(c, 0)), pt3(evaluateCurve2d(c, 0.5)), pt3(evaluateCurve2d(c, 1))))
          break
        }
        const b = curveBounds(c)
        const pts: Array<{ x: number; y: number; z: number }> = []
        for (let k = 0; k <= 32; k++) {
          const t = b.first + ((b.last - b.first) * k) / 32
          pts.push(pt3(evaluateCurve2d(c, t)))
        }
        for (let k = 0; k < pts.length - 1; k++) edges.push(kernel.makeLineEdge(pts[k]!, pts[k + 1]!))
        break
      }
      case 'ellipse':
      case 'bspline': {
        const b = curveBounds(c)
        const n = 32
        const pts: Array<{ x: number; y: number; z: number }> = []
        for (let k = 0; k <= n; k++) {
          const t = b.first + ((b.last - b.first) * k) / n
          pts.push(pt3(evaluateCurve2d(c, t)))
        }
        for (let k = 0; k < pts.length - 1; k++) edges.push(kernel.makeLineEdge(pts[k]!, pts[k + 1]!))
        break
      }
    }
  }
  return kernel.makeWire(edges)
}

/** 顶层 Blueprint/CompoundBlueprint 的近似有符号面积（用于 wire 最大岛选择）。 */
function blueprintArea(entry: Blueprint | CompoundBlueprint): number {
  const bp = entry instanceof CompoundBlueprint ? entry.blueprints[0]! : entry
  let a = 0
  for (const c of bp.curves) {
    if (c.kind2d === 'line') {
      a += (c.ox * (c.oy + c.dy * c.len) - (c.ox + c.dx * c.len) * c.oy) / 2
      continue
    }
    const b = curveBounds(c)
    const nSamples = 32
    for (let k = 0; k < nSamples; k++) {
      const t0 = b.first + ((b.last - b.first) * k) / nSamples
      const t1 = b.first + ((b.last - b.first) * (k + 1)) / nSamples
      const [x0, y0] = evaluateCurve2d(c, t0)
      const [x1, y1] = evaluateCurve2d(c, t1)
      a += (x0 * y1 - x1 * y0) / 2
    }
  }
  return a
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