/**
 * api loft — 放样（基础）：多截面按序蒙皮生成体。**两内核都支持**。
 *
 * 为什么不是 occt-only（方案 2026-10-10-sweep-loft-dual-engine-plan §3 总览 / §5）：
 * 基础放样（等顶点数的有序截面蒙皮）两个内核都能做 —— occt 走原生 `loft`
 * （`BRepOffsetAPI_ThruSections`），brepkit 走 `loft` / `loftSmooth` /
 * `loftWithOptions`；差异（brepkit 只吃 face）由适配器消化，op 层只看到中立名
 * `BrepEngineApi#loft`。
 *
 * ⚠️ brepkit 的后端要求各截面**顶点数一致**，不一致时执行前报
 * `E_LOFT_SECTION_MISMATCH`（不静默降级、不换引擎）。`startPoint`（起点退化）与
 * `tolerance` 只有 occt 有 → 归 `cad.loftAdvanced`。
 */

import type { Shape } from '../mesh/types'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrep } from '../shape'
import { solidToShape } from '../brep/brep-ops'
import { toProfileWireView } from './internal/profile-wire'

/** 放样配置（基础 = 两内核交集）。 */
export interface LoftOptions {
  /** 直线插值（ruled）。默认 true。 */
  ruled?: boolean
  /** 终点（退化到点的蒙皮）。 */
  endPoint?: readonly [number, number, number] | { x: number; y: number; z: number }
}

/** PointInput → BrepVec3（旧 toVec3 同口径）。 */
function toVec3(p: NonNullable<LoftOptions['endPoint']>): { x: number; y: number; z: number } {
  if (Array.isArray(p) && p.length >= 3) return { x: p[0]!, y: p[1]!, z: p[2]! }
  const o = p as { x: number; y: number; z: number }
  return { x: o.x, y: o.y, z: o.z }
}

/** BREP 路径：按序蒙皮各截面（wire 视图 → L1 中立名 → fromBrep 收养）。 */
function loftBrep(sections: Shape[], opts?: LoftOptions): Shape {
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error('E_LOFT_NO_SECTIONS: loft requires a non-empty array of section shapes')
  }
  // 每截面：wire 直用；面取外环（孔环不参与放样）。
  const wireViews = sections.map((s) => toProfileWireView(s))
  const { ruled = true, endPoint } = opts ?? {}
  const kernel = getBrepApi()
  try {
    const h = kernel.loft(
      wireViews.map((w) => w.wrapped),
      ruled,
      endPoint !== undefined ? toVec3(endPoint) : undefined,
    )
    return fromBrep(solidToShape(kernel, h), { solid: h })
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    throw new Error(`E_LOFT_FAILED: loft failed: ${raw}`, { cause: e })
  } finally {
    // 面→外环产出的 wire 是 arena 新句柄（曲线借用不 release）
    for (const w of wireViews) {
      if (!w.borrowed) {
        try { kernel.release(w.wrapped) } catch { /* 已释放 */ }
      }
    }
  }
}

/**
 * 放样：按给定顺序在截面之间蒙皮生成体。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name loft
 * @note 基础 op：**occt 与 brepkit 两内核都支持**（occt `BRepOffsetAPI_ThruSections`；
 *       brepkit `loft` / `loftSmooth` / `loftWithOptions`）。截面可为 wire 或面
 *       （面取其外环），至少 2 个；`endPoint` 可做终点退化到点的蒙皮。选项集 =
 *       两内核交集 = `{ ruled, endPoint }` —— `startPoint` 与 `tolerance` 只有 occt
 *       有，用 `cad.loftAdvanced`。brepkit 链要求各截面顶点数一致。
 * @returns Shape 放样体。
 * @param sections - 有序截面集合（wire 或面；面取其外环）。type:Shape[] required:true
 * @param opts - 放样配置（ruled / endPoint）。type:LoftOptions required:false
 * @example
 * const bottom = cad.profile({ contours: [{ segments: [
 *   { kind: 'line', x1: -5, y1: -5, x2: 5, y2: -5 },
 *   { kind: 'line', x1: 5, y1: -5, x2: 5, y2: 5 },
 *   { kind: 'line', x1: 5, y1: 5, x2: -5, y2: 5 },
 *   { kind: 'line', x1: -5, y1: 5, x2: -5, y2: -5 },
 * ] }] })
 * const top = cad.translate(cad.profile({ contours: [{ segments: [
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
  naming: { kind: 'unmodeled', reason: 'lofted-body face vocabulary not defined' } as Provenance,
})
