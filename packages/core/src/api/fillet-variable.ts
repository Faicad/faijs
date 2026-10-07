/**
 * api fillet-variable — 变半径圆角：单边起止半径（手写中立 op，Phase 5）
 *
 * 中立 op：L1 `filletVariable(solid, edge, startRadius, endRadius)` 在 occt 与
 * brepkit 两侧均有真实现（engine-method-map 实测 `dialect`）⇒ 走 `getBrepApi()`
 * （D12），不声明 engines（中立 op：实现只经 L1 契约面）。
 *
 * 这是 faijs 简化形态（单边 + 起止半径）；旧版的 per-edge 回调形态
 * （`variableFillet`）维持 skip（状态化回调不可静态建模）。
 * 选边口径与 `fillet` 一致（EdgeTopoRef，faces 两面 role 线路）。
 */

import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import { solidToShape } from '../brep/brep-ops'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf, fromBrep } from '../shape'
import { defineOp } from '../sdk'
import type { EdgeTopoRef } from '../topology/naming'
import { resolveTopoRef, TopoRefError } from '../topology/naming'
import type { Provenance } from '../topology/naming/lineage'
import { buildEdgeResolutionContext } from './topo-resolve'

/** BREP 路径：解析边引用 → L1 filletVariable → 收养。 */
function filletVariableBrep(input: Shape, edge: EdgeTopoRef, startRadius: number, endRadius: number): Shape {
  if (!edge || (edge as { kind?: unknown }).kind !== 'edge') {
    throw new Error('E_FILLETVAR_BAD_EDGE_REF: edge must be an EdgeTopoRef (as consumed by cad.fillet)')
  }
  const faces = (edge as { faces?: unknown }).faces
  if (!Array.isArray(faces) || faces.length !== 2) {
    throw new Error('E_FILLETVAR_BAD_EDGE_REF: EdgeTopoRef.faces must be a two-entry RoleQualifier pair')
  }
  for (const r of [startRadius, endRadius]) {
    if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) {
      throw new Error('E_FILLETVAR_BAD_RADIUS: startRadius / endRadius must be positive numbers')
    }
  }
  const kernel = getBrepApi()
  const solid = brepOf(input) as BrepHandle | undefined
  if (!solid) throw new Error('E_FILLETVAR_NO_BREP: filletVariable input is not BREP')

  const ctx = buildEdgeResolutionContext(kernel, input as object)
  if (!ctx) throw new TopoRefError('E_TOPO_NOT_FOUND', 'edge', 'filletVariable: input has no BREP naming context')
  const r = resolveTopoRef(edge, ctx)
  if (r.handle === undefined) {
    throw new TopoRefError('E_TOPO_NOT_FOUND', 'edge', `filletVariable: edge resolved without handle (${edge.faces[0].role}/${edge.faces[1].role})`)
  }

  const result = kernel.filletVariable(solid, r.handle as BrepHandle, startRadius, endRadius)
  return fromBrep(solidToShape(kernel, result), { solid: result })
}

/**
 * 变半径圆角：对单条边施加从起点到终点的线性变半径圆角。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name filletVariable
 * @note 中立 op：L1 filletVariable 两引擎同实现。`r1 == r2` 时与 cad.fillet 等半径
 *       结果等价。旧版的 per-edge 回调变半径（variableFillet）不上脚本面。
 *       仅 BREP 可用。
 * @returns Shape 变半径圆角后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param edge - 目标边（EdgeTopoRef，同 cad.fillet 的 edges 条目）。type:EdgeTopoRef required:true
 * @param r1 - 起点半径（mm，>0）。type:number required:true
 * @param r2 - 终点半径（mm，>0）。type:number required:true
 * @example
 * const v = await cad.filletVariable(part0, partEdges[0], 1, 4)
 */
export const filletVariable = defineOp({
  capabilities: ['directEdit'],
  brep(input: Shape, edge: EdgeTopoRef, r1: number, r2: number) {
    return filletVariableBrep(input, edge, r1, r2)
  },
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,
})
