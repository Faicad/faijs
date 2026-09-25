/**
 * profile-wire — 「截面 Shape → 扫掠/放样所需的 wire 视图」的唯一步径（Phase 4）
 *
 * `sweep` / `loft` 共用：脚本面最常见的截面来源是 `cad.sketch(...)`（产出 **face**），
 * 而 vendored 的 `sweep` / `loft` 只吃 wire ⇒ 需要「面 → 外环 wire」输入适配。
 * 两处口径必须逐字一致，故收在此叶子模块（一份实现，不允许第二个判定点）。
 *
 * 判定用 faijs 侧判别位（Phase 3 落地的 `kind:'curve'`），不查内核拓扑类型：
 * - 1D 截面（`cad.wire` / `cad.helix` / `cad.sketch({as:'wire'})`）→ 直接借入；
 * - 2D 截面（`cad.sketch` 的面）→ 取**外环**（孔环不参与扫掠/放样，与 vendored
 *   `asSketch` 的单 wire 口径一致）。
 *
 * 所有权：
 * - `borrowBrepjsShape` 产出零拷贝**借用**视图（不转移所有权，faijs Shape 仍持有）；
 * - `outerWire` 产出 arena 新 wire，生命周期交回 vendored finalizer —— **不得**
 *   `unregisterFromCleanup`（那是**收养**路径的 R1 规矩，此处不是收养）。
 */

import type { Shape } from '../../mesh/types'
import { isCurveShape } from '../../shape'
import type { ShapeHandle } from '@faicad/faijs-brepjs/core/disposal.js'
import { outerWire as vendoredOuterWire } from '@faicad/faijs-brepjs/topology/faceFns.js'
import { borrowBrepjsShape } from './l3-bridge'

/**
 * 截面 Shape → brepjs wire 视图（面取其外环）。
 *
 * @param section - 截面几何（1D wire 或 2D 面）。
 * @returns 借入/新建的 brepjs wire 视图，可直接喂给 vendored sweep / loft。
 */
export function toProfileWireView(section: Shape): ShapeHandle {
  const view = borrowBrepjsShape(section)
  if (isCurveShape(section)) return view
  return vendoredOuterWire(view as never) as unknown as ShapeHandle
}
