/**
 * stdlib loft — 放样：多个截面之间蒙皮生成体（手写平台 op，Phase 4 → G5 core 直连）
 *
 * @platform occt — 实现走 core 直连 `occt-wasm loft` / `loftWithVertices`
 * （BRepOffsetAPI_ThruSections；engine-method-map 里 `loft` 为 occt-only）⇒ 平台 op：
 * defineOp 声明 `engines: ['occt']`（D11）。
 *
 * 为什么手写而不走生成投影：与 `api/sweep.ts` 同因——截面最常见来源是
 * `cad.sketch(...)`（产出 **face**），内核 `loft(wires, …)` 只吃 wire ⇒
 * 需要「面 → 外环」输入适配（`internal/profile-wire.ts` 的唯一步径）。
 *
 * core-decouple G5：vendored `loft`（brepjs）替换为 occt-wasm 原生直连，
 * 产物经 `fromBrep` 收养（替代 l3-bridge adoptEntity）。
 */

import type { Shape } from '../mesh/types'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrep } from '../shape'
import { solidToShape } from '../brep/brep-ops'
import { getOcctKernel } from '../occt-kernel/occtKernel'
import { toProfileWireView } from './internal/profile-wire'
import type { BrepHandle } from '../brep/engine/types'

/** 放样配置（与 vendored LoftOptions 同形；本文件自持，去 brepjs 依赖）。 */
export interface LoftOptions {
  /** 直线插值（ruled）。默认 true。 */
  ruled?: boolean
  /** 起点（退化到点的蒙皮）。 */
  startPoint?: readonly [number, number, number] | { x: number; y: number; z: number }
  /** 终点（退化到点的蒙皮）。 */
  endPoint?: readonly [number, number, number] | { x: number; y: number; z: number }
  /** ThruSections 缝合公差。默认 1e-6。 */
  tolerance?: number
}

/** PointInput → [x,y,z]（vendored toVec3 同口径）。 */
function toVec3(p: LoftOptions['startPoint']): [number, number, number] {
  if (Array.isArray(p) && p.length >= 3) return [p[0]!, p[1]!, p[2]!]
  const o = p as { x: number; y: number; z: number }
  return [o.x, o.y, o.z]
}

/** BREP 路径：按序蒙皮各截面（wire 视图 → occt-wasm 直连 → fromBrep 收养）。 */
function loftBrep(sections: Shape[], opts?: LoftOptions): Shape {
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error('E_LOFT_NO_SECTIONS: loft requires a non-empty array of section shapes')
  }
  // 每截面：wire 直用；面取外环（孔环不参与放样）。
  const wireViews = sections.map((s) => toProfileWireView(s))
  const { ruled = true, startPoint, endPoint, tolerance = 1e-6 } = opts ?? {}
  const kernel = getBrepApi()
  const k = getOcctKernel()
  const wireHandles = wireViews.map((w) => w.wrapped as never)

  try {
    let h: unknown
    if (startPoint !== undefined || endPoint !== undefined) {
      const startVertex = startPoint !== undefined ? k.makeVertex(...toVec3(startPoint)) : undefined
      const endVertex = endPoint !== undefined ? k.makeVertex(...toVec3(endPoint)) : undefined
      try {
        h = k.loftWithVertices(wireHandles, true, ruled, startVertex as never, endVertex as never)
      } finally {
        if (startVertex !== undefined) k.release(startVertex)
        if (endVertex !== undefined) k.release(endVertex)
      }
    } else {
      h = k.loft(wireHandles, true, ruled)
    }
    return fromBrep(solidToShape(kernel, h as BrepHandle), { solid: h as BrepHandle })
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    throw new Error(`E_LOFT_FAILED: loft failed: ${raw}`)
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
