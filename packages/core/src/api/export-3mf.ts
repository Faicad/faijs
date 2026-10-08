/**
 * api export3mf — 3MF 导出（脚本面薄壳：宿主门 + 库面序列化器）
 *
 * §2.6 定式 1「薄壳 + 门禁，不重写格式逻辑」：本体只做三件事——宿主门
 * （`assertHostFor`）→ 把入参转成 `ExportEntry[]` → 调库面序列化器
 * `exportModelSync(entries, '3mf', { unit })`。因此脚本面与库面**天然逐字节同源**
 * （矩阵 B14）。
 *
 * **无引擎门**（与 `exportStep` 的差别）：faijs 的 3MF 写出器是纯 XML + ZIP
 * （`build3mfModelXml` + `writeZipEntries`），与引擎身份无关；只有「活句柄 → 三角
 * 载荷」这一条兜底路径需要内核，且它对 occt / brepkit 一视同仁（走 `getBrepApi()`
 * 的当前引擎，不做身份断言）。
 *
 * **宿主门**：与其余导出命令同轴（§2.5），仅 `'node'` 宿主开放。理由：`.fai.js` 可
 * 由 AI 生成任意代码、属不受信输入，导出把「往哪写、写几份、写什么」的决定权交给
 * 脚本文本；浏览器 / 小程序里要导出模型必须由宿主入口发起。断言写在函数体第一行，
 * 所以脚本面 `cad.*` 与 TS 直连同一函数都被同一门禁覆盖。
 *
 * **条目必须是 `mesh`，且不得是空 mesh**（定式 4 / P8）：`build3mfModelXml` 对无
 * `mesh` 的条目**静默跳过**（`export-model.ts:330` 的 `if (!e.mesh) return`），只给
 * `solid` 会产出「ZIP 合法但对象为空」的假成功。故本 op 只交 `mesh` 条目，且三角数
 * 为 0 的成员视为不可导出；全体不可导出时**显式报错**，不落空文件。
 *
 * **三角载荷取自 Shape 自身，而非二次三角化**（对 §2.6 定式 4 措辞的按证据修正）：
 * 定式 4 原话是「3mf 先 `solidToShape` 三角化再给 `mesh`」，但其依据是
 * `cli.ts#writeOutput` 的 `brepSolid` 分支——那里 solid 来自独立快照表、`shape` 可能
 * 只有 mesh，故必须先三角化。本 op 的入参 Shape 由执行链产出时**已带当前显示 mesh**
 * （mesh 链由构造器填、brep 链由 `fromHandle` → `meshHandle` 填）。再走一遍
 * `solidToShape` 会**二次三角化**并换掉默认精度：`meshHandle` 缺省 segments=32
 * （`brep/handle-bridge.ts:125`），`solidToShape` 缺省 2π/64（`brep/brep-ops.ts:68`），
 * 两者产出的是**两份不同的 mesh**——违反「导出所用 mesh 必须是用户看到的 mesh」
 * （规则 1），与 `api/export-stl.ts` 拒绝走原生二次三角化是同一取舍。故只在 Shape
 * 自带的三角载荷缺席 / 为空时（例如只有 BREP 槽的跨库产物）才用 `solidToShape` 兜底。
 */

import type { Shape } from '../mesh/types'
import type { CompoundShape } from '../shape'
import type { BrepHandle } from '../brep/engine/types'
import type { UnitName } from '../units'
import { brepOf } from '../shape'
import { getBrepApi } from '../brep/handle-bridge'
import { solidToShape } from '../brep/brep-ops'
import { exportModelSync, type ExportEntry } from '../brep/export/export-model'
import { exportTreeOf, type ExportMemberNode } from './internal/export-members'
import { assertHostFor } from './internal/l3-bridge'

/** `cad.export3mf` 选项。 */
export interface Export3mfOptions {
  /**
   * 文件里声明的长度单位（缺省 `'mm'`）。语义与库面 `ExportOptions.unit` 一致：
   * 实现负责把坐标换算到该刻度，并与 `<model unit>` 成对写出（§10.3 规则 3）；
   * `yard` 无 3MF 枚举值，库面成对回落到 mm（§10.3 规则 2）。
   */
  unit?: UnitName
}

/** 节点自带的三角载荷（非空才算数）。 */
function ownMeshOf(node: ExportMemberNode): { positions: Float32Array; indices: Uint32Array } | undefined {
  const positions = node.shape?.positions
  const indices = node.shape?.indices
  if (!positions || !indices) return undefined
  if (positions.length === 0 || indices.length === 0) return undefined
  return { positions, indices }
}

/**
 * 一个成员树节点 → 3mf 条目：递归携带 children（装配层级 → `<components>`）。
 * 只产出带非空 `mesh` 的节点，或带 children 的容器（无 mesh 的节点会被写出器静默
 * 跳过，故容器节点若无 mesh 仅以 `<components>` 表达层级，符合 3MF Core 规范）。
 */
function entryOfNode(node: ExportMemberNode): ExportEntry {
  let mesh = ownMeshOf(node)
  if (!mesh) {
    // 兜底：Shape 只有 BREP 槽（跨库产物）时现场三角化一次；引擎身份中立。
    const handle = brepOf(node.shape) as BrepHandle | undefined
    if (handle) {
      const tri = solidToShape(getBrepApi(), handle)
      if (tri.indices.length > 0) mesh = { positions: tri.positions, indices: tri.indices }
    }
  }
  const entry: ExportEntry = {}
  if (node.name !== undefined) entry.name = node.name
  if (node.color !== undefined) entry.color = node.color
  if (node.transform) entry.transform = node.transform
  if (mesh) entry.mesh = mesh
  if (node.children?.length) entry.children = node.children.map(entryOfNode)
  return entry
}

/**
 * 导出 3MF（ZIP 容器字节）。
 * @group 导出
 * @inputs 1
 * @async false
 * @qual ok
 * @name export3mf
 * @note 薄壳 op：条目构造后一律交库面 `exportModelSync(entries,'3mf',{unit})` 序列化，
 *       故同一入参下脚本面字节与库面**逐字节一致**（同一真源）。返回 **ZIP 字节**
 *       （`Uint8Array`），由宿主写入 `.3mf` 文件——内核不 import fs。`unit` 只声明单位
 *       （写 `<model unit>`），坐标随之换算，两者同源（缺省 mm）。
 *       入参可为单件 Shape 或装配 compound；compound 逐成员导出并带上成员名与
 *       `memberColors`（basematerials）。条目**只交 mesh**：无 mesh 的条目会被写出器
 *       静默跳过、产出「ZIP 合法但对象为空」的假成功，故三角数为 0 的成员视为不可导出，
 *       全体不可导出时显式报 E_EXPORT_3MF_EMPTY。
 *       **宿主门**：仅 `'node'` 宿主可执行；browser / weapp / 未声明宿主报
 *       E_HOST_UNSUPPORTED（门在读取载荷之前）。无引擎门——写出器是纯 XML + ZIP，
 *       与引擎身份无关。
 * @returns Uint8Array 3MF（ZIP）字节。
 * @param shape - 目标几何（单件 Shape 或装配 compound）。type:Shape|CompoundShape required:true
 * @param options.unit - 文件里声明的长度单位，缺省 mm（坐标随之换算）。type:UnitName
 * @example
 * const bytes = cad.export3mf(part0)
 * const asmBytes = cad.export3mf(asm1)
 */
export function export3mf(shape: Shape | CompoundShape, options?: Export3mfOptions): Uint8Array {
  // 宿主门在实现体最前：非 node 宿主先报 E_HOST_UNSUPPORTED，不读取载荷、不产字节。
  assertHostFor('export3mf', ['node'])
  const entries = exportTreeOf(shape)
    .map(entryOfNode)
    .filter((e) => e.mesh !== undefined || (e.children?.length ?? 0) > 0)
  if (entries.length === 0) {
    throw new Error('E_EXPORT_3MF_EMPTY: export3mf input has no exportable member (empty assembly or members without triangles)')
  }
  const buffer = exportModelSync(entries, '3mf', options?.unit === undefined ? undefined : { unit: options.unit })
  const bytes = new Uint8Array(buffer)
  if (bytes.length === 0) {
    throw new Error('E_EXPORT_3MF_EMPTY: 3MF writer produced no bytes')
  }
  return bytes
}
