/**
 * B4 — mock 库 fixture：BREP 版（B4）
 *
 * 设计文档：docs/plans/2026-08-29-faijs-module-runtime-plan.md §7.3 B4 / §4.4 / §4.5
 *
 * 模拟第三方库模块（`import * as mech from 'mech-lib'` 的目标）：
 * - 带 `contractVersion`（= CONTRACT_VERSION，registerLib 校验通过）
 * - 函数从 faijs SDK（@faicad/faijs/sdk）构造 Shape
 * - 本文件是 **BREP 版**：产物经 `fromHandle` 登记 BREP 槽（hasBrep === true），
 *   可与内置 op 走精确 BREP 布尔 / 精确 STEP 导出
 *
 * 与真实库的差异：真实库（如 brepjs adapter）在模块加载期注入内核并调
 * `kernel.meshShape`/`makeXxx` 造句柄；这里直接用 `fromHandle` 消费内核
 * 已造好的句柄（测试里经 runtime auto 模式初始化内核并取 box solid 句柄）。
 */

import { solid, fromHandle, CONTRACT_VERSION, getBackends, type SolidShape } from '@faicad/faijs-core/sdk'

export const contractVersion = CONTRACT_VERSION

/**
 * 取 faijs 当前 OCCT 内核并造一个 box solid 句柄（BREP 版 mock 的核心能力演示）。
 * 真实场景由 brepjs 等外部库造句柄 → fromHandle 登记；这里内联造一个，
 * 验证 SDK 桥接（B1）从库函数可达。
 */
function boxSolidHandle(size: number): unknown {
  const kernel = getBackends().kernel.occt as
    | { makeBox(x: number, y: number, z: number): unknown }
    | null
    | undefined
  if (!kernel || typeof kernel.makeBox !== 'function') {
    throw new Error('[mock-mech-brep] OCCT kernel not available (run in auto/brep mode)')
  }
  return kernel.makeBox(size, size, size)
}

/** 立方体（BREP 版，含 BREP 槽）。 */
export function makeHeadstock(params: { size: number }): SolidShape {
  const handle = boxSolidHandle(params.size)
  return fromHandle(handle)
}

/** 无参演示函数：调用方负责在 auto 模式（内核就绪）下调用。 */
export function makeBox(): SolidShape {
  return makeHeadstock({ size: 10 })
}

/** 纯 mesh 版函数保留（证明同一库内可混用 mesh/BREP 产物）。 */
export function makeBall(_params: { radius: number }): SolidShape {
  return solid({
    positions: new Float32Array(0),
    indices: new Uint32Array(0),
  })
}
