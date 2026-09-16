/**
 * stdlib sketch — 从 2D 轮廓构面（creator 函数，无输入，brep-only）。
 *
 * 用途：faijs 此前没有「从 2D 轮廓构造 planar face」的能力，导致草图轮廓无法喂给
 * extrude/revolve。本 op 接收 2D 轮廓（线段 + 圆弧），在 z=0 平面用 OCCT 构面：
 *   makeLineEdge/makeArcEdge → makeWire → makeFace（+ addHolesInFace）。
 *
 * 设计：
 * - 输入：{ contours: SketchLoop[] }，每个 loop = 有序 segments（line / arc，z=0）。
 * - 外环 = 面积（shoelace）绝对值最大的 loop；其余 loop 作为孔。
 * - 圆弧：用起点/中点/终点三点的 makeArcEdge；整圆（sweep≈2π）拆成两段弧。
 * - 输出：Shape（mesh 三角化 + 句柄登记）。brep-only（下游 extrude/revolve 亦 brep-only）。
 *
 * 坐标系：输入 2D 点即 (x, y, 0)，法向 +Z；草图在 Body 局部系内的定位由调用方（fcstd 端口）
 * 在轮廓坐标里预先变换，或由下游特征的 Placement 承担。
 */

import type { Shape } from '../mesh/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { getBackends } from '../runtime-state'
import { solidToShape } from '../brep/brep-ops'
import { fromBrep } from '../shape'
import { defineOp } from '../sdk'

// ── 参数形状（与 fcstd Contour 结构相同，避免引擎依赖端口层）──

export interface SketchLineSeg {
  kind: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface SketchArcSeg {
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

export type SketchSeg = SketchLineSeg | SketchArcSeg

export interface SketchLoop {
  segments: SketchSeg[]
}

export interface SketchContoursParams {
  contours: SketchLoop[]
}

// ── 参数自校验 ──

/**
 * Validate sketch parameters: `contours` must be a non-empty array of loops,
 * each with at least one segment.
 * @param params the raw sketch operation parameters.
 */
export function assertSketchParams(params: Record<string, unknown>): void {
  const contours = params.contours
  if (!Array.isArray(contours) || contours.length === 0) {
    throw new Error('E_SKETCH_NO_CONTOURS: sketch requires at least one contour')
  }
  for (const loop of contours) {
    if (!loop || typeof loop !== 'object' || !Array.isArray((loop as SketchLoop).segments)) {
      throw new Error('E_SKETCH_BAD_LOOP: each contour must have a segments array')
    }
    if ((loop as SketchLoop).segments.length === 0) {
      throw new Error('E_SKETCH_EMPTY_LOOP: a contour must have at least one segment')
    }
  }
}

/** 单环 shoelace 面积（带符号）。 */
function loopSignedArea(loop: SketchLoop): number {
  const pts: Array<[number, number]> = []
  for (const seg of loop.segments) {
    pts.push([seg.x1, seg.y1])
  }
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!
    const [x2, y2] = pts[(i + 1) % pts.length]!
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

/** 圆弧 → 一条或两条 makeArcEdge（整圆拆分）。 */
function arcToHandles(
  kernel: BrepEngineApi,
  seg: SketchArcSeg,
): ReturnType<BrepEngineApi['makeArcEdge']>[] {
  const { cx, cy, radius, startAngle, endAngle } = seg
  let sweep = endAngle - startAngle
  // 归一化到 (0, 2π]，处理角度回绕
  while (sweep <= 0) sweep += 2 * Math.PI
  while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI

  const makeOne = (a0: number, a1: number): ReturnType<BrepEngineApi['makeArcEdge']> => {
    const mid = (a0 + a1) / 2
    const start = { x: cx + radius * Math.cos(a0), y: cy + radius * Math.sin(a0), z: 0 }
    const m = { x: cx + radius * Math.cos(mid), y: cy + radius * Math.sin(mid), z: 0 }
    const end = { x: cx + radius * Math.cos(a1), y: cy + radius * Math.sin(a1), z: 0 }
    return kernel.makeArcEdge(start, m, end)
  }

  // 整圆（sweep≈2π）：拆成两段半圆，避免 makeArcEdge 起点≈终点退化
  if (sweep >= 2 * Math.PI - 1e-9) {
    const half = 2 * Math.PI / 2
    return [makeOne(startAngle, startAngle + half), makeOne(startAngle + half, startAngle + 2 * Math.PI)]
  }
  return [makeOne(startAngle, endAngle)]
}

/** 单环 → wire handle（仅构面，不释放中间句柄，遵循现有惯例）。 */
function loopToWire(kernel: BrepEngineApi, loop: SketchLoop): ReturnType<BrepEngineApi['makeWire']> {
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

/** BREP 路径：2D 轮廓 → planar face（外环 + 孔）。 */
function sketchBrep(params: Record<string, unknown>): Shape {
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[stdlib/sketch] no BREP kernel')

  const loops = (params.contours as SketchLoop[]).map((loop) => ({ loop, area: Math.abs(loopSignedArea(loop)) }))
  // 面积最大者为外环，其余为孔
  let outerIdx = 0
  for (let i = 1; i < loops.length; i++) {
    if (loops[i]!.area > loops[outerIdx]!.area) outerIdx = i
  }

  const outerWire = loopToWire(kernel, loops[outerIdx]!.loop)
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
 * @name sketch
 * @returns Shape 平面几何（mesh 三角化 + BREP 句柄）。
 * @param params.contours - 有序 2D 轮廓（线段/圆弧；外环 + 孔）。type:SketchLoop[] required:true
 * @example
 * const f = cad.sketch({ contours: [{ segments: [{ kind:'line', x1:0,y1:0,x2:10,y2:0 }, ...] }] })
 */
export const sketch = defineOp({
  capabilities: ['directEdit'],
  brep(params: Record<string, unknown>) {
    assertSketchParams(params)
    return sketchBrep(params)
  },
})
