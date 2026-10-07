/**
 * api exportBrep — BREP 文本导出（平台：occt 专属，普通函数形态）
 *
 * @platform occt — 实现直调 occt 原生 `toBREP(shape)`（occt-wasm 有，L1 契约
 * `brep/engine/primitives.ts` **只有 `fromBREP` 导入侧、没有导出成员**）。
 *
 * 为什么不是 `defineOp`：本 op 返回**纯文本**（非 Shape）。`defineOp` 的 brep 包装
 * （`define-op.ts#wrapBrepOne`）把返回值一律收养为 Shape——字符串会落到
 * `fromHandle` 并抛 `E_BAD_HANDLE: ... got string`（实测）。数据型 op 走普通函数是
 * 本仓既有口径（先例：`api/view/view-projection.ts#projectView` 返回 SVG 字符串）。
 *
 * 引擎身份**不能**靠 dispatchPath 门控（普通函数不走那条路）⇒ 按
 * `api/internal/l3-bridge.ts#assertEngineFor` 的既定做法：函数体第一行断言当前
 * 引擎，触碰内核之前报出与 D11-4 同构的 `E_BREP_UNSUPPORTED`，不补桩、不回退。
 * （与 dispatchPath 的差异：`assertEngineFor` **不含** D11-3 的 `brep_mock` 豁免——
 *  mock 句柄不是 occt 句柄，放行只会拿到错形状，故这里如实拦截。）
 *
 * §9.5 降级路径（记录在案）：brepkit 的 wasm 面**自带 `toBREP`**
 * （`api/surface/brepkit-wasm-surface.json` 的 `methods` 含 `toBREP`），只是尚未接进
 * L1 契约。一旦契约新增导出成员且两侧适配器同时落地，本函数删掉 `assertEngineFor`
 * 并改走 `getBrepApi()`，该方法即从 C2 转入 C1。
 */

import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import { brepOf } from '../shape'
import { getOcctKernel } from '../occt-kernel/occtKernel'
import { assertEngineFor } from './internal/l3-bridge'

/** BREP 路径：先断言引擎身份 → 借出 brep 句柄 → occt 原生 toBREP 文本。 */
function exportBrepNative(shape: Shape): string {
  assertEngineFor('exportBrep', ['occt'])
  const handle = brepOf(shape) as BrepHandle | undefined
  if (!handle) {
    throw new Error('E_EXPORT_BREP_NO_BREP: exportBrep input has no BREP handle (mesh-only shape)')
  }
  const text = getOcctKernel().toBREP(handle as never)
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('E_EXPORT_BREP_EMPTY: occt toBREP produced no text')
  }
  return text
}

/**
 * 导出 BREP 文本（与 `import_brep` 成对的导出侧）。
 * @group 导出
 * @inputs 1
 * @async false
 * @qual ok
 * @name exportBrep
 * @note 平台 op：仅 occt 引擎（原生 toBREP，L1 契约无对应导出成员）。非 occt 引擎
 *       执行前报 E_BREP_UNSUPPORTED；brep_mock 不拦截（引擎身份判定读
 *       `config.brepEngineId`）。返回**纯文本**，由宿主写入 `.brep` 文件；
 *       经 `import_brep` / L1 `fromBREP` 可无损回读（精确 BREP，非 mesh 回填）。
 * @returns string OCCT BREP 文本。
 * @param shape - 目标几何（必须带 BREP 槽；mesh-only 输入报 E_EXPORT_BREP_NO_BREP）。type:Shape required:true
 * @example
 * const text = cad.exportBrep(part0)
 */
export function exportBrep(shape: Shape): string {
  return exportBrepNative(shape)
}
