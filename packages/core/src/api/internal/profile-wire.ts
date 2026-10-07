/**
 * profile-wire — 「截面 Shape → 扫掠/放样所需的 wire 视图」的唯一步径（Phase 4→G5）
 *
 * `sweep` / `loft` 共用：脚本面最常见的截面来源是 `cad.profile(...)`（产出 **face**），
 * 而内核的 `sweep` / `loft` 只吃 wire ⇒ 需要「面 → 外环 wire」输入适配。
 * 两处口径必须逐字一致，故收在此叶子模块（一份实现，不允许第二个判定点）。
 *
 * 判定用 faijs 侧判别位（Phase 3 落地的 `kind:'curve'`），不查内核拓扑类型：
 * - 1D 截面（`cad.wire` / `cad.helix` / `cad.profile({as:'wire'})`）→ 借用原句柄；
 * - 2D 截面（`cad.profile` 的面）→ 取**外环**（孔环不参与扫掠/放样）。
 *
 * core-decouple G5 后：wire 视图为 `{ wrapped: BrepHandle, borrowed: boolean }`
 * （brepjs 形态保留，供 brep-operations 实现直读）。所有权：面→外环的 wire 是
 * arena 新句柄（borrowed=false），由调用方（loft/sweep）消费后 release；
 * 曲线借用（borrowed=true）不 release。
 */

import type { Shape } from '../../mesh/types'
import { brepOf, isCurveShape } from '../../shape'
import { getBrepApi } from '../../brep/handle-bridge'
import type { BrepHandle } from '../../brep/engine/types'

/** Wire view for sweep/loft sections: the BREP handle plus its ownership flag. */
export interface WireView {
  wrapped: BrepHandle
  /** true = 借用原 shape 句柄（勿 release）；false = 新建外环 wire（调用方 release）。 */
  borrowed: boolean
}

/** 截面 Shape → wire 视图（面取其外环）。
 *
 * @param section - Section shape (curve or face) to adapt.
 * @returns The wire view wrapping the handle and its ownership flag.
 */
export function toProfileWireView(section: Shape): WireView {
  const handle = brepOf(section) as BrepHandle
  if (isCurveShape(section)) return { wrapped: handle, borrowed: true }
  const kernel = getBrepApi()
  const faces = kernel.getSubShapes(handle, 'face')
  if (faces.length === 0) return { wrapped: handle, borrowed: true }
  const wires = kernel.getSubShapes(faces[0], 'wire')
  if (wires.length === 0) return { wrapped: handle, borrowed: true }
  return { wrapped: wires[0], borrowed: false }
}
