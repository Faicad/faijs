/**
 * stdlib svgExtrude — SVG 挤出创建库函数（creator 函数，无输入）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape } from '@faicad/faijs-core/mesh/types'
import type { AssetResolver } from '@faicad/faijs-core/cad-runtime/ports'
import { cad } from '@faicad/faijs-core/mesh'
import { parseSvgNaturalSize } from '@faicad/faijs-core/primitives/parse-svg-size'
import { svgToSolid } from '@faicad/faijs-core/brep/svg/svg-to-solid'
import { solidToShape } from '@faicad/faijs-core/brep/brep-ops'
import { resolveSvgArg } from './internal/svg-asset-resolver'
import { getBackends } from '@faicad/faijs-core/runtime-state'
import { solid, fromBrep } from '@faicad/faijs-core/shape'
import { dispatchPath } from '@faicad/faijs-core/cad-runtime/backend-dispatch'
import { assertPositiveNumber } from './assert'

/** BREP 实现标记（dispatchPath 判定用；svgExtrude 有 OCCT 精确构造） */
const brepImpl = svgToSolid

/** svgExtrude: svg 必填；depth 必填 > 0。 */
export function assertSvgExtrudeParams(params: Record<string, unknown>): void {
  if (params.svg === undefined || params.svg === null || params.svg === '') {
    throw new Error(`[stdlib/svgExtrude] svg is required, got ${JSON.stringify(params.svg)}`)
  }
  assertPositiveNumber(params.depth, 'svgExtrude.depth')
}

/** BREP 路径：SVG path 解析 → OCCT wire/face → extrude + fromBrep 登记。 */
function svgExtrudeBrep(params: Record<string, unknown>, svgText: string): Shape {
  const kernel = getBackends().kernel.occt as import('occt-wasm').OcctKernel | null
  if (!kernel) throw new Error('[stdlib/svgExtrude] no OCCT kernel')

  const solidHandle = svgToSolid(kernel, svgText, {
    depth: params.depth as number,
    targetLongSide: (params.targetLongSide as number | undefined) ?? 20,
  })

  return fromBrep(solidToShape(kernel, solidHandle), { solid: solidHandle })
}

export async function svgExtrude(params: Record<string, unknown>): Promise<Shape> {
  assertSvgExtrudeParams(params)
  // 解析 SVG 资产引用（AssetRef → SVG 文本）；两条路径都需要
  const svgText = await resolveSvgArg(params.svg, { assets: getBackends().assets as AssetResolver | undefined })

  const path = dispatchPath([], brepImpl)
  if (path === 'brep') return svgExtrudeBrep(params, svgText)

  // mesh 路径：与 BREP 路径一致，内部解析 SVG 自然尺寸后缩放
  const { naturalWidth, naturalHeight } = parseSvgNaturalSize(svgText)
  return solid(await cad.svgExtrude({
    svg: svgText,
    depth: params.depth as number,
    targetLongSide: (params.targetLongSide as number | undefined) ?? 20,
    naturalWidth,
    naturalHeight,
  }))
}
