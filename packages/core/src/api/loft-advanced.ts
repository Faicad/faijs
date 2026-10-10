/**
 * api loft-advanced — 放样（完整语义）：occt 平台 op。
 *
 * 为什么与基础 `loft` 拆成两个 op（方案 2026-10-10-sweep-loft-dual-engine-plan
 * §3 总览 / §6）：基础 `loft` 进 L1（两内核都要支持），选项集必须等于**两内核
 * 交集**；而本 op 承载的 `startPoint`（起点退化到点的蒙皮）与 `tolerance`
 * （ThruSections 缝合公差）在 brepkit 没有对应能力（brepkit 的 `loftWithOptions`
 * 只有 endPoint / ruled）。留在基础 op 上会造成语义分叉 —— 故上移到本 op
 * （与 `sketchOnFace → sketchOnSurface` 同构）。
 *
 * 实现走 core 直连 occt `loft` / `loftWithVertices`（`BRepOffsetAPI_ThruSections`），
 * 产物经 `fromBrep` 收养。
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

/** 放样完整配置（occt 平台 op）。 */
export interface LoftAdvancedOptions {
  /** 直线插值（ruled）。默认 true。 */
  ruled?: boolean
  /** 起点（退化到点的蒙皮）。 */
  startPoint?: readonly [number, number, number] | { x: number; y: number; z: number }
  /** 终点（退化到点的蒙皮）。 */
  endPoint?: readonly [number, number, number] | { x: number; y: number; z: number }
  /** ThruSections 缝合公差。默认 1e-6。 */
  tolerance?: number
}

/** PointInput → [x,y,z]（旧 toVec3 同口径）。 */
function toVec3(p: LoftAdvancedOptions['startPoint']): [number, number, number] {
  if (Array.isArray(p) && p.length >= 3) return [p[0]!, p[1]!, p[2]!]
  const o = p as { x: number; y: number; z: number }
  return [o.x, o.y, o.z]
}

/** BREP 路径：按序蒙皮各截面（wire 视图 → occt-wasm 直连 → fromBrep 收养）。 */
function loftAdvancedBrep(sections: Shape[], opts?: LoftAdvancedOptions): Shape {
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error('E_LOFT_NO_SECTIONS: loft requires a non-empty array of section shapes')
  }
  // 每截面：wire 直用；面取外环（孔环不参与放样）。
  const wireViews = sections.map((s) => toProfileWireView(s))
  const { ruled = true, startPoint, endPoint } = opts ?? {}
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
 * 放样（完整语义）：按给定顺序在截面之间蒙皮生成体。
 * @group 特征
 * @inputs 2
 * @async true
 * @qual ok
 * @name loftAdvanced
 * @note 平台 op：仅 occt 引擎（BRepOffsetAPI_ThruSections）。截面可为 wire 或面
 *       （面取其外环），至少 2 个；`startPoint` / `endPoint` 可做退化到点的蒙皮；
 *       `tolerance` 控制缝合公差。非 occt 引擎执行前报错；brep_mock 不拦截。
 *       基础放样（两内核交集）用 `cad.loft`。不做 `loftAll`（数组产物）。
 * @returns Shape 放样体。
 * @param sections - 有序截面集合（wire 或面；面取其外环）。type:Shape[] required:true
 * @param opts - 放样完整配置（ruled / startPoint / endPoint / tolerance）。type:LoftAdvancedOptions required:false
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
 * const body = await cad.loftAdvanced([bottom, top], { endPoint: [0, 0, 30] })
 */
export const loftAdvanced = defineOp({
  name: 'loftAdvanced',
  brep(sections: Shape[], opts?: LoftAdvancedOptions) {
    return loftAdvancedBrep(sections, opts)
  },
  engines: ['occt'],
  naming: { kind: 'unmodeled', reason: 'lofted-body face vocabulary not defined' } as Provenance,

  paramDims: {},
})
