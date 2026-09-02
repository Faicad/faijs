/**
 * fillet — 圆角（BREP-only，P7 双链整合样板 op）
 *
 * 设计：docs/plans/2026-09-01-layered-api-architecture.md §D10 / §D11 / P7
 *
 * 这是「L3 brep 实现调移植 L2」的第一条接线（D11：brep 链缺失能力 → 调移植 L2）：
 * - 实现来源：vendored `topology/modifierFns.fillet`（brepjs 移植树，跑在 D10
 *   绑定的同一 occt-wasm 实例上）；
 * - 句柄互通（D10）：输入 BrepHandle 经 `createBorrowedHandle` 包装成移植 L2 的
 *   Shape（non-owning，只读——释放责任永远在 faijs 侧）；产物句柄经
 *   `unregisterFromCleanup` 脱离移植树 GC 兜底，所有权转入 faijs 身份槽
 *   （`fromBrep`），后续释放由 cad-runtime 顶替释放统一编排；
 * - Result → throw 翻转（D3）：移植 L2 的 `Result` 在 L3 边界翻成异常，这是
 *   L3 实现体的固定样板。
 *
 * faijs 既有 brep/ 层与 mesh/ 层均无 fillet（BrepEngineApi 无此原语）——这是
 * 移植 L2 的价值所在（chamfer 之外的圆角/抽壳/偏移/扫掠等缺失能力）。
 */

import { defineOp } from '../sdk'
import { getBackends } from '../runtime-state'
import { brepOf, fromBrep } from '../shape'
import { solidToShape } from '../brep/brep-ops'
import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { fillet as brepjsFillet } from '../vendored/brepjs/topology/modifierFns.js'
import { createBorrowedHandle, unregisterFromCleanup, type ShapeHandle } from '../vendored/brepjs/core/disposal.js'
import { handle, mapShapeType } from '../vendored/brepjs/kernel/occtWasm/helpers.js'
import type { ValidSolid } from '../vendored/brepjs/core/shapeTypes.js'
import { assertPositiveNumber } from './assert'

/** BREP-only 主入口：输入必须在 brep 链上（dispatchPath 已保证 brep 路径）。 */
function filletBrep(input: Shape, params: Record<string, unknown>): Shape {
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[stdlib/fillet] no BREP kernel')
  const solid = brepOf(input) as BrepHandle | undefined
  if (!solid) throw new Error('[stdlib/fillet] E_FILLET_NO_BREP: input is not BREP')
  const radius = params.radius as number
  assertPositiveNumber(radius, 'fillet.radius')

  // D10 句柄互通：faijs BrepHandle 运行时是 occt-wasm 的 u32 arena id；移植树
  // 的拓扑缓存（WeakMap）与 Shape 包装要求 OcctWasmHandle 对象——在 L3 边界做
  // number → handle 包装（同 wasm 实例，零成本），并经 createBorrowedHandle 借出
  // （non-owning，L2 对输入只读，释放责任永远在 faijs 侧）。
  const id = solid as unknown as number
  const rawKernel = kernel as unknown as { getShapeType(id: number): string }
  const ocHandle = handle(mapShapeType(rawKernel.getShapeType(id)), id)
  const borrowed = createBorrowedHandle(ocHandle) as unknown as ValidSolid
  // edges=undefined → 全部棱边圆角；trackEvolution=false → 走 kernel.fillet 直调
  // （不计算面演化哈希——faijs 侧身份槽登记不需要它）。
  const result = brepjsFillet(borrowed, undefined, radius, { trackEvolution: false })
  if (!result.ok) {
    const msg = result.error instanceof Error ? result.error.message : String(result.error)
    throw new Error(`[stdlib/fillet] E_FILLET_FAILED: ${msg}`)
  }

  // D10 所有权转出：产物句柄脱离移植树 GC 兜底 → 取回 u32 arena id → 转入 faijs 身份槽。
  const out = result.value as unknown as ShapeHandle
  unregisterFromCleanup(out)
  const resultHandle = (out.wrapped as { id: number }).id as unknown as BrepHandle
  return fromBrep(solidToShape(kernel, resultHandle), { solid: resultHandle })
}

/**
 * 在几何体上做圆角（全部棱边，等半径）。仅 BREP 可用。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name fillet
 * @note 圆角是 BREP-only：非 BREP 输入抛 E_MESH_UNSUPPORTED。调移植 L2（brepjs
 * topology/modifierFns.fillet，D11 缺失能力接线样板）。
 * @returns Shape 圆角后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param params.radius - 圆角半径（mm），正数。type:number required:true
 * @example
 * const p = await cad.fillet(part0, { radius: 2 })
 */
export const fillet = defineOp({
  capabilities: ['directEdit'],
  // L3 metadata (D2): modifier consumes its single shape input (timeline default 'all').
  schema: { radius: 'number' },
  brep(input: Shape, params: Record<string, unknown>) {
    return filletBrep(input, params)
  },
})
