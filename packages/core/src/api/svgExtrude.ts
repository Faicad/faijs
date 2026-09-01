/**
 * stdlib svgExtrude — SVG 挤出创建库函数（creator 函数，无输入）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape } from '../mesh/types'
import type { AssetResolver } from '../cad-runtime/ports'
import { cad } from '../mesh'
import { parseSvgNaturalSize } from '../primitives/parse-svg-size'
import { svgToSolid } from '../brep/svg/svg-to-solid'
import { solidToShape } from '../brep/brep-ops'
import { resolveSvgArg } from './internal/svg-asset-resolver'
import { getBackends } from '../runtime-state'
import { fromBrep } from '../shape'
import { defineOp } from '../sdk'
import { assertPositiveNumber } from './assert'
import type { BrepEngineApi } from '../brep/engine/primitives'

/**
 * Validate svgExtrude parameters: `svg` is required and `depth` must be a
 * positive number.
 * @param params - the raw svgExtrude operation parameters.
 */
export function assertSvgExtrudeParams(params: Record<string, unknown>): void {
  if (params.svg === undefined || params.svg === null || params.svg === '') {
    throw new Error(`[stdlib/svgExtrude] svg is required, got ${JSON.stringify(params.svg)}`)
  }
  assertPositiveNumber(params.depth, 'svgExtrude.depth')
}

/** BREP 路径：SVG path 解析 → OCCT wire/face → extrude + fromBrep 登记。 */
function svgExtrudeBrep(params: Record<string, unknown>, svgText: string): Shape {
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[stdlib/svgExtrude] no OCCT kernel')

  const solidHandle = svgToSolid(kernel, svgText, {
    depth: params.depth as number,
    targetLongSide: (params.targetLongSide as number | undefined) ?? 20,
  })

  return fromBrep(solidToShape(kernel, solidHandle), { solid: solidHandle })
}

/**
 * 从二维 SVG 轮廓挤出零件（拓扑操作）。
 * @group 创建
 * @inputs 0
 * @async true
 * @qual warn
 * @name svgExtrude
 * @note SVG 是外部资产，应优先用资产引用（`cad.asset(key)` 经 CallRefIR）而非整份 XML 内联拷贝。自然尺寸（viewBox）与缩放已显式成参数（mesh/BREP 两条路径都解析 viewBox 并传递 naturalWidth/naturalHeight），尺寸语义不再依赖两套实现各自推导。
 * @returns Shape SVG 挤出几何，生成独立零件。
 * @param params.svg - SVG 内容：资产 key（推荐）或整份 SVG 文本（兼容）。type:string required:true
 * @param params.depth - 挤出深度（mm）。type:number required:true
 * @param params.targetLongSide - 长边目标尺寸（mm）。type:number 默认 20
 * @example
 * const s = await cad.svgExtrude({ svg: 'logo.svg', depth: 5, targetLongSide: 20 })
  */
export const svgExtrude = defineOp({
  mesh: async (params: Record<string, unknown>) => {
    assertSvgExtrudeParams(params)
    const svgText = await resolveSvgArg(params.svg, { assets: getBackends().assets as AssetResolver | undefined })
    // mesh 路径：与 BREP 路径一致，内部解析 SVG 自然尺寸后缩放
    const { naturalWidth, naturalHeight } = parseSvgNaturalSize(svgText)
    return cad.svgExtrude({
      svg: svgText,
      depth: params.depth as number,
      targetLongSide: (params.targetLongSide as number | undefined) ?? 20,
      naturalWidth,
      naturalHeight,
    })
  },
  brep: async (params: Record<string, unknown>) => {
    assertSvgExtrudeParams(params)
    const svgText = await resolveSvgArg(params.svg, { assets: getBackends().assets as AssetResolver | undefined })
    return svgExtrudeBrep(params, svgText)
  },
})
