/**
 * geom-build — 带容差的组线 / 成面 / 缝合 / 实体化
 *
 * CadQuery 的 `Wire.combine(edges, tol)` 走 OCP 的
 * `ShapeAnalysis_FreeBounds::ConnectEdgesToWires`（按端点距离带容差串接**任意顺序**的边）。
 * faijs/occt-wasm **没有**这个绑定，而 `BrepEngineApi.makeWire(edges)` 是
 * `BRepBuilderAPI_MakeWire`——实测（2026-09-08）给 68 条无序边只连出 9 条边的坏线。
 *
 * 所以这里自己实现串接：按端点坐标在 `tol` 内配对，O(n²) 遍历（n = 4·z，最大几百，够用）。
 * 这是 cq_gears 全部族（Spur / Bevel / Rack / Worm）都要用的公共能力。
 */

import type { BrepHandle } from '@faicad/faijs-core'
import type { RawOcctKernel } from './kernel'
import type { Vec3 } from './math'

/** 一条边的两个端点（顺序即边的参数方向）。 */
export interface EdgeEnds {
  edge: BrepHandle
  a: Vec3
  b: Vec3
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

/**
 * 取一条边的两个端点坐标。
 *
 * ⚠️ 端点取法红线（2026-09-11 实测）：`getSubShapes(edge, 'vertex')` 对 **B-spline 曲线边**
 * 返回的定点数 < 2（OCCT 不为曲线边存显式顶点），导致 `connectEdgesToWires` 把每条边当成
 * 独立 wire。正确做法是走曲线参数域：`curveParameters(edge)` 给出
 * `{first, last}`，`curvePointAtParam(edge, param)` 取该参数下的空间点——这适用于**所有**边类
 * 型（直线 / 圆弧 / B-spline），故作为主路径；顶点取法仅作退化兜底。
 *
 * @param kernel 原始 OCCT 内核
 * @param edge 边句柄
 * @returns 边的两个端点（闭合边首末同点）
 */
export function edgeEnds(kernel: RawOcctKernel, edge: BrepHandle): EdgeEnds {
  try {
    const { first, last } = kernel.curveParameters(edge)
    return {
      edge,
      a: kernel.curvePointAtParam(edge, first),
      b: kernel.curvePointAtParam(edge, last),
    }
  } catch {
    // 兜底：极少数无底层曲线的退化边，退回顶点端点取法
    const vs = kernel.getSubShapes(edge, 'vertex')
    if (vs.length < 2) {
      const p = kernel.vertexPosition(vs[0])
      return { edge, a: p, b: p }
    }
    return { edge, a: kernel.vertexPosition(vs[0]), b: kernel.vertexPosition(vs[1]) }
  }
}

/**
 * `ShapeAnalysis_FreeBounds::ConnectEdgesToWires` 的 TS 等价物。
 *
 * @param kernel 原始 OCCT 内核
 * @param edges 任意顺序的边集合
 * @param tol 端点配对容差（mm）；cq 用 `wire_comb_tol = 1e-2`
 * @returns 一个或多个 wire；每条 wire 的边已按首尾相接排好
 */
export function connectEdgesToWires(
  kernel: RawOcctKernel,
  edges: BrepHandle[],
  tol: number,
): BrepHandle[] {
  if (!Number.isFinite(tol) || tol <= 0) {
    throw new Error(`connectEdgesToWires: tol must be a positive finite number, got ${String(tol)}`)
  }
  const pool: EdgeEnds[] = edges.map((e) => edgeEnds(kernel, e))
  const used = new Array<boolean>(pool.length).fill(false)
  const wires: BrepHandle[] = []

  for (let start = 0; start < pool.length; start++) {
    if (used[start]) continue
    used[start] = true

    const chain: BrepHandle[] = [pool[start].edge]
    let tail = pool[start].b
    const head = pool[start].a

    // 向前串：找一条未用的边，其某端点与当前 tail 在容差内相接
    for (;;) {
      let found = -1
      let best = Infinity
      for (let j = 0; j < pool.length; j++) {
        if (used[j]) continue
        const dA = dist(pool[j].a, tail)
        const dB = dist(pool[j].b, tail)
        const d = Math.min(dA, dB)
        if (d <= tol && d < best) {
          best = d
          found = j
        }
      }
      if (found < 0) break
      used[found] = true
      const e = pool[found]
      const flip = dist(e.a, tail) <= dist(e.b, tail)
      // 边与边之间的间隙若超过 OCCT 精度（~1e-7），kernel.makeWire 会静默
      // 丢弃后继边——插入一条桥接线段补齐（cq ConnectEdgesToWires 同样自动
      // 补齐容差内间隙）。
      if (best > 1e-7) {
        chain.push(kernel.makeLineEdge(tail, flip ? e.a : e.b))
      }
      // 需要反向才首尾相接时，用 reverseShape 造一条反向副本
      chain.push(flip ? e.edge : kernel.reverseShape(e.edge))
      tail = flip ? e.b : e.a
      // 回到起点 ⇒ 闭环，停止
      if (dist(tail, head) <= tol) break
    }

    // 闭环尾部与起点的间隙同样补齐
    const endGap = dist(tail, head)
    if (chain.length > 1 && endGap > 1e-7 && endGap <= tol) {
      chain.push(kernel.makeLineEdge(tail, head))
    }

    wires.push(kernel.makeWire(chain))
  }
  return wires
}

/**
 * cq `Wire.combine(edges, tol)` 的等价物：取**第一条** wire。
 *
 * 与 cq 一致只取第一条（`makeFromWires(topface_wires[0])`），所以对「必须闭成一条环」
 * 的场景，调用方要自己断言 `wires.length === 1`——不要靠取第 0 条掩盖多环问题。
 *
 * @param kernel 原始 OCCT 内核
 * @param edges 任意顺序的边集合
 * @param tol 端点配对容差（mm）
 * @returns 第一条组好的 wire
 */
export function combineWires(
  kernel: RawOcctKernel,
  edges: BrepHandle[],
  tol: number,
): BrepHandle {
  const wires = connectEdgesToWires(kernel, edges, tol)
  if (wires.length === 0) throw new Error('combineWires: no wire produced')
  return wires[0]
}

/** cq `Face.makeFromWires(outer, holes)` 的等价物。
 *
 * @param kernel 原始 OCCT 内核
 * @param outer 外环 wire
 * @param holes 内孔 wire 列表（可为空）
 * @returns 面句柄
 */
export function faceFromWires(
  kernel: RawOcctKernel,
  outer: BrepHandle,
  holes: BrepHandle[] = [],
): BrepHandle {
  const f = kernel.makeFace(outer)
  return holes.length > 0 ? kernel.addHolesInFace(f, holes) : f
}

/**
 * cq `make_shell(faces, tol)` + `Solid.makeSolid(shell)` 的等价物。
 *
 * `sew` 之后**不**静默吞掉非 shell 结果——那是构造失败的信号。
 *
 * @param kernel 原始 OCCT 内核
 * @param faces 待缝合的面集合
 * @param sewingTol 缝合容差（mm，cq `shell_sewing_tol`）
 * @returns 由缝合 shell 实体化得到的 solid
 */
export function shellToSolid(
  kernel: RawOcctKernel,
  faces: BrepHandle[],
  sewingTol: number,
): BrepHandle {
  const shell = kernel.sew(faces, sewingTol)
  if (!kernel.isShell(shell) && !kernel.isSolid(shell)) {
    throw new Error(
      `shellToSolid: sew did not produce a shell (got ${String(kernel.getShapeType(shell))})`,
    )
  }
  return kernel.makeSolid(shell)
}
