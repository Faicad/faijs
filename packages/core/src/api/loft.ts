/**
 * stdlib loft — 放样：多个截面之间蒙皮生成体（手写平台 op，Phase 4）
 *
 * @platform occt — 实现走 vendored `loft` → `BRepOffsetAPI_ThruSections`
 * （engine-method-map 里 `loft` / `loftAdvanced` 均为 occt-only）⇒ 平台 op：
 * defineOp 声明 `engines: ['occt']`（D11），不声明 capabilities（D11-7 互斥）。
 *
 * 为什么手写而不走生成投影：与 `api/sweep.ts` 同因——截面最常见来源是
 * `cad.sketch(...)`（产出 **face**），vendored `loft(wires, …)` 只吃 wire ⇒
 * 需要「面 → 外环」输入适配（`internal/profile-wire.ts` 的唯一步径）。
 * 数组入参本身已不是障碍（compat-op 的 `borrowDeep` 递归借入数组），
 * 障碍是输入形态适配，故仍按设计原则 6「手写 op 优先」落地。
 *
 * 只做单产物 `loft`；**不做** `loftAll`（返回 `Shape3D[]`，多产物一律用具名
 * `outputs`，设计原则 5 —— 数组产物不上脚本面）。
 */

import type { Shape } from '../mesh/types'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { loft as vendoredLoft, type LoftOptions } from '../vendored/brepjs/operations/loftFns.js'
import { adoptEntity, callBrepjs } from './internal/l3-bridge'
import { borrowDeep, unwrapOrThrow } from './internal/compat-op'
import { toProfileWireView } from './internal/profile-wire'

export type { LoftOptions }

/** BREP 路径：按序蒙皮各截面（borrow → vendored 调用 → Result 翻转 → 收养）。 */
function loftBrep(sections: Shape[], opts?: LoftOptions): Shape {
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error('E_LOFT_NO_SECTIONS: loft requires a non-empty array of section shapes')
  }
  // 每截面：wire 直用；面取外环（孔环不参与放样）。
  const wires = sections.map((s) => toProfileWireView(s))
  // startPoint / endPoint 是纯数值，borrowDeep 原样透传；保留此步是为对称与防未来
  // 选项里嵌 Shape（与 compatOp 同款深借入口径）。
  const config = (borrowDeep(opts ?? {}, 0) ?? {}) as LoftOptions
  const r = callBrepjs(vendoredLoft, [wires, config])
  return adoptEntity(unwrapOrThrow(r, 'loft'), 'loft') as Shape
}

/**
 * 放样：按给定顺序在截面之间蒙皮生成体。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name loft
 * @note 平台 op：仅 occt 引擎（BRepOffsetAPI_ThruSections）。截面可为 wire 或面
 *       （面取其外环），至少 2 个；`startPoint` / `endPoint` 可做退化到点的蒙皮。
 *       非 occt 引擎执行前报错；brep_mock 不拦截。不做 `loftAll`（数组产物）。
 * @returns Shape 放样体。
 * @param sections - 有序截面集合（wire 或面；面取其外环）。type:Shape[] required:true
 * @param opts - 放样配置（ruled / startPoint / endPoint / tolerance）。type:LoftOptions required:false
 * @example
 * const bottom = cad.sketch({ contours: [{ segments: [
 *   { kind: 'line', x1: -5, y1: -5, x2: 5, y2: -5 },
 *   { kind: 'line', x1: 5, y1: -5, x2: 5, y2: 5 },
 *   { kind: 'line', x1: 5, y1: 5, x2: -5, y2: 5 },
 *   { kind: 'line', x1: -5, y1: 5, x2: -5, y2: -5 },
 * ] }] })
 * const top = cad.translate(cad.sketch({ contours: [{ segments: [
 *   { kind: 'line', x1: -3, y1: -3, x2: 3, y2: -3 },
 *   { kind: 'line', x1: 3, y1: -3, x2: 3, y2: 3 },
 *   { kind: 'line', x1: 3, y1: 3, x2: -3, y2: 3 },
 *   { kind: 'line', x1: -3, y1: 3, x2: -3, y2: -3 },
 * ] }] }), [0, 0, 20])
 * const body = await cad.loft([bottom, top])
 */
export const loft = defineOp({
  name: 'loft',
  brep(sections: Shape[], opts?: LoftOptions) {
    return loftBrep(sections, opts)
  },
  engines: ['occt'],
  naming: { kind: 'unmodeled', reason: 'lofted-body face vocabulary not defined' } as Provenance,
})
