/**
 * faijs-extra svgExtrude — SVG 挤出创建库函数（creator 函数，无输入）
 *
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape, Vec3 } from '../../mesh/types'
import type { AssetResolver } from '../../cad-runtime/ports'
import { svgExtrude as meshSvgExtrude } from '../mesh/primitives'
import { parseSvgNaturalSize } from '../../primitives/parse-svg-size'
import { svgToSolid } from '../../brep/svg/svg-to-solid'
import { solidToShape } from '../../brep/brep-ops'
import { getBrepApi } from '../../brep/handle-bridge'
import { resolveSvgArg } from '../../api/internal/svg-asset-resolver'
import { getBackends } from '../../runtime-state'
import { placeOnFace } from '../../brep/text/face-place'
import { fromBrep } from '../../shape'
import { defineOp } from '../../sdk'
import type { Provenance } from '../../topology/naming/lineage'
import { assertNonZeroNumber } from '../../api/assert'

/**
 * Validate svgExtrude parameters: `svg` is required and `depth` a finite number
 * (may be negative — a negative depth extrudes along -Z, i.e. a "concave" pocket
 * on the chosen face, the same mechanism as a sketch's negative-direction
 * extrusion).
 * @param params - the raw svgExtrude operation parameters.
 */
export function assertSvgExtrudeParams(params: Record<string, unknown>): void {
  if (params.svg === undefined || params.svg === null || params.svg === '') {
    throw new Error(`[extra/svgExtrude] svg is required, got ${JSON.stringify(params.svg)}`)
  }
  assertNonZeroNumber(params.depth, 'svgExtrude.depth')
}

/** BREP 路径：SVG path 解析 → OCCT wire/face → extrude + 贴面 + fromBrep 登记。 */
function svgExtrudeBrep(params: Record<string, unknown>, svgText: string): Shape {
  const kernel = getBrepApi()

  const solidHandle = svgToSolid(kernel, svgText, {
    depth: params.depth as number,
    targetLongSide: (params.targetLongSide as number | undefined) ?? 20,
  })

  // 面上放置（`faceCenter` 给定 = 用户先选了一张面）：居中 → 旋到法向 → 平移到面心，
  // 并沿法向推 `depth/2`（轮廓体厚度居中，不推则一半陷在面里）。与 `text` 共用
  // `placeOnFace`，同一张面、同一段轮廓，两个入口朝向一致。
  if (params.faceCenter !== undefined && params.faceCenter !== null) {
    const faceCenter = params.faceCenter as Vec3
    const faceNormal = (params.faceNormal as Vec3 | undefined) ?? [0, 0, 1]
    const placed = placeOnFace(kernel, solidHandle, faceCenter, faceNormal, (params.depth as number) / 2)
    return fromBrep(solidToShape(kernel, placed), { solid: placed })
  }

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
 * @param params.depth - 挤出深度（mm）；允许负值，负值=沿 -Z 负向拉伸（凹陷口袋，与草图负向拉伸同逻辑）。type:number required:true
 * @param params.targetLongSide - 长边目标尺寸（mm）。type:number 默认 20
 * @param params.faceCenter - 面心（给了就贴在该面上：轮廓中心落此处、厚度朝面外）。type:[x,y,z]
 * @param params.faceNormal - 面外法向（与 faceCenter 配套；缺省 [0,0,1]）。type:[x,y,z]
 * @note faceCenter 只有 BREP 实现：mesh 几何上传 faceCenter 会显式报错（不静默忽略）。不给 faceCenter 时保持历史行为（XY 居中、Y 底部对齐原点）。
 * @example
 * const s = cad.svgExtrude({ svg: 'logo.svg', depth: 5, targetLongSide: 20 })
 * @example
 * const s = cad.svgExtrude({ svg: 'logo.svg', depth: 5, targetLongSide: 20, faceCenter: [0, 0, 15], faceNormal: [0, 0, 1] })
  */
export const svgExtrude = defineOp({
  mesh: async (params: Record<string, unknown>) => {
    assertSvgExtrudeParams(params)
    // 面上放置只有 BREP 实现（`placeOnFace` 走内核 transform/translate）。mesh 几何上
    // 静默忽略 faceCenter 等于"选了一张面，轮廓却还躺在世界原点" —— 必须报错（与
    // `text` 对 faceCenter 的 mesh 拒绝同一口径）。
    if (params.faceCenter !== undefined && params.faceCenter !== null) {
      throw new Error('[extra/svgExtrude] faceCenter requires BREP geometry (input is mesh)')
    }
    const svgText = await resolveSvgArg(params.svg, { assets: getBackends().assets as AssetResolver | undefined })
    // mesh 路径：与 BREP 路径一致，内部解析 SVG 自然尺寸后缩放
    const { naturalWidth, naturalHeight } = parseSvgNaturalSize(svgText)
    return meshSvgExtrude({
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
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [] } } as Provenance,

  paramDims: { depth: 'length', targetLongSide: 'length', faceCenter: 'length', faceNormal: 'plain' },
})
