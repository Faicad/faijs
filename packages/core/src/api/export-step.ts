/**
 * api exportStep — STEP 导出（脚本面薄壳：宿主门 + 引擎门 + 库面序列化器）
 *
 * §2.6 定式 1「薄壳 + 门禁，不重写格式逻辑」：本体只做四件事——宿主门
 * （`assertHostFor`）→ 引擎门（`assertEngineFor`）→ 把入参转成 `ExportEntry[]`
 * （`brep/export/export-model.ts#ExportEntry`）→ 调库面序列化器
 * `exportModelSync(entries, 'step', { unit })`。因此脚本面与库面**天然逐字节同源**
 * （矩阵 B12），单位声明与坐标刻度的成对不变式（§10.3 规则 3：OCCT 恒写
 * SI_UNIT(.MILLI.,.METRE.)，坐标预缩放后声明必须跟上）由库面统一保证，op 里不复刻。
 *
 * **引擎门**：STEP 的装配层级走 XCAF，只有 occt 具备（§2.3），故与
 * `api/export-brep.ts:32` 同构地断言 `assertEngineFor('exportStep', ['occt'])`——
 * 在触碰任何句柄之前报出 `E_BREP_UNSUPPORTED` 并带上当前引擎名，不补桩、不回退。
 * 非 occt 引擎下**不得**让调用落进 `getBrepApi()` / `getOcctKernel()` 的未初始化
 * 异常，也不得把 brepkit 句柄交给 occt 内核（句柄不得跨引擎传递）。
 *
 * **宿主门**：与其余导出命令同轴（§2.5），仅 `'node'` 宿主开放，且宿主门在引擎门
 * 之前。理由：`.fai.js` 可由 AI 生成任意代码、属不受信输入，导出把「往哪写、写几份、
 * 写什么」的决定权交给脚本文本；浏览器 / 小程序里要导出模型必须由宿主入口发起。
 * 断言写在函数体第一行，所以脚本面 `cad.*` 与 TS 直连同一函数都被同一门禁覆盖。
 *
 * **层级入口**：入参是 `Shape` 或 `CompoundShape`（§2.1——`cad.assembly` / `cad.group`
 * 的产物），`cad.exportStep(compound)` 即脚本面的层级导出入口；成员拆解口径见
 * `api/internal/export-members.ts`（对齐 `node-host/cli.ts#writeAssemblyStep`）。
 *
 * **条目按格式分派**（定式 4）：step 吃 `solid`（保留精确 BREP 拓扑，缺则库面用
 * `mesh` 重建，`brep/export/step.ts:83`），所以活句柄存在就给 `solid`，没有才给
 * `mesh`——与 `cli.ts#writeOutput`（`:744-758`）同口径。空装配**显式报错**，不落
 * 空文件（对齐 `api/export-stl.ts` 的 `E_EXPORT_STL_EMPTY` 口径）。
 */

import type { Shape } from '../mesh/types'
import type { CompoundShape } from '../shape'
import type { BrepHandle } from '../brep/engine/types'
import type { UnitName } from '../units'
import { brepOf } from '../shape'
import { exportModelSync, type ExportEntry } from '../brep/export/export-model'
import { exportMembersOf, type ExportMember } from './internal/export-members'
import { assertEngineFor, assertHostFor } from './internal/l3-bridge'

/** `cad.exportStep` 选项。 */
export interface ExportStepOptions {
  /**
   * 文件里声明的长度单位（缺省 `'mm'`）。语义与库面 `ExportOptions.unit` 一致：
   * 实现负责把坐标换算到该刻度，并与声明**成对**写出（`export-model.ts` §10.3）。
   */
  unit?: UnitName
}

/** 一个成员 → step 条目：有活句柄给精确 BREP，没有才退回自带三角载荷。 */
function stepEntryOf(member: ExportMember): ExportEntry | undefined {
  const handle = brepOf(member.shape) as BrepHandle | undefined
  const positions = member.shape?.positions
  const indices = member.shape?.indices
  const hasMesh = !!positions && !!indices && positions.length > 0 && indices.length > 0
  const payload: ExportEntry | undefined = handle
    ? { solid: handle }
    : hasMesh
      ? { mesh: { positions, indices } }
      : undefined
  if (!payload) return undefined
  return {
    ...payload,
    ...(member.name === undefined ? {} : { name: member.name }),
    ...(member.color === undefined ? {} : { color: member.color }),
  }
}

/**
 * 导出 STEP 文本（与 `cad.import_step` 成对的导出侧）。
 * @group 导出
 * @inputs 1
 * @async false
 * @qual ok
 * @name exportStep
 * @note 薄壳 op：条目构造后一律交库面 `exportModelSync(entries,'step',{unit})` 序列化，
 *       故同一入参下脚本面文本与库面**逐字节一致**（同一真源，不另起写出通道）。
 *       返回**纯文本**（ISO-10303-21），由宿主写入 `.step` / `.stp` 文件——内核不 import
 *       fs。`unit` 只声明单位，坐标换算与声明由库面成对完成（缺省 mm）。
 *       入参可为单件 Shape 或装配 compound（`cad.assembly` / `cad.group` 产物），
 *       compound 逐成员导出并带上成员名与 `memberColors`；空装配显式报
 *       E_EXPORT_STEP_EMPTY，不落空文件。
 *       **双门**：宿主门仅 `'node'`（browser / weapp / 未声明报 E_HOST_UNSUPPORTED），
 *       引擎门仅 `occt`（装配层级走 XCAF；非 occt 报 E_BREP_UNSUPPORTED）。门序固定
 *       为宿主门 → 引擎门 → 实现体，两级都在触碰任何句柄之前。
 * @returns string STEP（ISO-10303-21）文本。
 * @param shape - 目标几何（单件 Shape 或装配 compound）。type:Shape|CompoundShape required:true
 * @param options.unit - 文件里声明的长度单位，缺省 mm（坐标随之换算）。type:UnitName
 * @example
 * const text = cad.exportStep(part0)
 * const asm = cad.exportStep(asm1, { unit: 'inch' })
 */
export function exportStep(shape: Shape | CompoundShape, options?: ExportStepOptions): string {
  // 门序固定：宿主门 → 引擎门（都在读 Shape 槽 / 触碰内核之前）。
  assertHostFor('exportStep', ['node'])
  assertEngineFor('exportStep', ['occt'])
  const entries: ExportEntry[] = []
  for (const member of exportMembersOf(shape)) {
    const entry = stepEntryOf(member)
    if (entry) entries.push(entry)
  }
  if (entries.length === 0) {
    throw new Error('E_EXPORT_STEP_EMPTY: exportStep input has no exportable member (empty assembly or payload-less members)')
  }
  const buffer = exportModelSync(entries, 'step', options?.unit === undefined ? undefined : { unit: options.unit })
  const text = new TextDecoder().decode(new Uint8Array(buffer))
  if (text.length === 0) {
    throw new Error('E_EXPORT_STEP_EMPTY: occt produced no STEP text')
  }
  return text
}
