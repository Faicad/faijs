/**
 * api wireFromEdges — 边列表 → wire（组装矩阵「部件列表→容器」的 1D 格）
 *
 * 与 `cad.solidFromFaces`（面集→实体）、`cad.sew`（面/壳→壳）同族：把一组
 * 有序子形状组装成一个容器。L1 `makeWire`（`brep/engine/primitives.ts`）
 * 两引擎同实现（occt + brepkit dialect，engine-method-map「brepkit 多 closed
 * 参数」），故本 op 是中立 op。
 *
 * 顺序敏感：按入参顺序组装，不做端点排序——排序责任在调用方（与 `cad.wire`
 * 点列的「有序点列」口径一致）。内核 makeWire 自行校验连接性，失败抛内核
 * 错误（静态规则：BREP 路径异常 = 设计缺陷直接暴露，不兜底）。
 *
 * 产物是 1D curve Shape（`fromBrepCurve` 口径同 `cad.wire`）；1D 产物命名取
 * unmodeled（无面 → 无 roleTable，先例 `cad.wire` / torus / convexHull）。
 */

import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import { solidToShape } from '../brep/brep-ops'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf, fromBrepCurve } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'

/** `cad.wireFromEdges` 选项。 */
export interface WireFromEdgesOptions {
  /** 要求闭合链：组装后校验首尾相连（`curveIsClosed`），不闭合抛错。默认 false（开链合法）。 */
  closed?: boolean
}

/** BREP 路径：借入边句柄 → L1 makeWire（顺序敏感）→ （可选）闭合校验 → fromBrepCurve 收养。 */
function wireFromEdgesBrep(edges: Shape[], opts?: WireFromEdgesOptions): Shape {
  if (!Array.isArray(edges) || edges.length < 1) {
    throw new Error('E_WIRE_FROM_EDGES_TOO_FEW: wireFromEdges requires at least 1 edge')
  }
  const handles = edges.map((s) => {
    const h = brepOf(s) as BrepHandle | undefined
    if (h === undefined) throw new Error('E_WIRE_FROM_EDGES_NO_BREP: wireFromEdges input shape is not BREP')
    return h
  })
  const kernel = getBrepApi()
  const wire = kernel.makeWire(handles)
  if (opts?.closed === true && !kernel.curveIsClosed(wire)) {
    throw new Error('E_WIRE_FROM_EDGES_NOT_CLOSED: assembled wire is not closed (start and end points must coincide)')
  }
  return fromBrepCurve(solidToShape(kernel, wire), { solid: wire })
}

/**
 * 边列表 → wire：把有序边 Shape 组装成一条 wire（1D 曲线）。
 * @group 创建
 * @inputs 1
 * @async false
 * @qual ok
 * @name wireFromEdges
 * @note 中立 op：L1 makeWire 两引擎同实现。顺序敏感——按入参顺序组装，
 *       不做端点排序；连接性由内核校验，失败抛内核错误。
 *
 *       单边合法（2026-11-14 放宽，原下限是 2）：`makeWire([singleEdge])` 本身就
 *       是内核支持的形态（探针实测 `makeWire([circleEdge])` 即整圆 wire）。这条对
 *       **扫掠脊柱**是关键出路——`cad.circleArc` 产出单条 edge，只有允许单边组 wire，
 *       脚本层才能写出"单段真弧脊柱"（`cad.sweep(section, cad.wireFromEdges([arc]))`）。
 *       此前下限 2 让真弧脊柱在脚本层无路可走，只能退化成折线（体积按 2/π 丢）。
 * @returns Shape 1D 曲线（kind:'curve'）。
 * @param edges - 有序边 Shape 列表（`cad.edge` / `cad.circleArc` / `cad.tangentArc` 等产物），至少 1 条。type:Shape[] required:true
 * @param options.closed - 要求闭合链（组装后校验首尾相连，不闭合抛 E_WIRE_FROM_EDGES_NOT_CLOSED；默认 false 开链合法）。type:boolean required:false
 * @example
 * const e1 = cad.edge([0,0,0],[10,0,0])
 * const e2 = cad.edge([10,0,0],[10,10,0])
 * const w = cad.wireFromEdges([e1, e2])
 * // 单条真弧 → wire，可直接当扫掠脊柱（扫掠体积须等于 面积 × 弧长）
 * const spine = cad.wireFromEdges([cad.circleArc([0,-10,0],[1,0,0],10,0*DEGREE,90*DEGREE)])
 */
export const wireFromEdges = defineOp({
  brep(edges: Shape[], opts?: WireFromEdgesOptions) {
    return wireFromEdgesBrep(edges, opts)
  },
  naming: { kind: 'unmodeled', reason: 'construct vocabulary pending Phase 3' } as Provenance,

  paramDims: {},
})
