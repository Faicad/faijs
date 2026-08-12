/**
 * SVG 挤出操作分派器
 *
 * BREP 路径：用 SVG path 解析 → OCCT wire/face → extrude
 * Mesh 路径：用 THREE.SVGLoader → ExtrudeGeometry
 *
 * 分派模式与 text.ts 一致：canUseBrep 时走 BREP，否则走 mesh（静态判定，非运行时回退）。
 */

import type { Shape } from '../../cad-core/types'
import { cad } from '../../cad-core'
import { parseSvgNaturalSize } from '../../primitives/parse-svg-size'
import { svgToSolid } from '../svg/svgBlueprints'
import { solidToShape } from '../brep-ops'
import { resolveSvgArg } from './svg-asset-resolver'
import type { OpContext } from './types'
import { canUseBrep } from './types'

/**
 * 执行 SVG 挤出操作
 */
export async function executeSvgExtrude(ctx: OpContext): Promise<Shape> {
  const { args, ports } = ctx

  // 解析 SVG 资产引用（AssetRef → SVG 文本）
  const svgText = await resolveSvgArg(args.svg, ports)

  // 链不活跃 → mesh 路径（链已在前面静态断掉，正常继续）
  if (!canUseBrep(ctx)) {
    // mesh 路径：与 BREP 路径一致，内部解析 SVG 自然尺寸后缩放
    const { naturalWidth, naturalHeight } = parseSvgNaturalSize(svgText)
    return cad.svgExtrude({
      svg: svgText,
      depth: args.depth as number,
      targetLongSide: (args.targetLongSide as number | undefined) ?? 20,
      naturalWidth,
      naturalHeight,
    })
  }

  // 链活跃 → BREP 路径（直接执行，不包 try-catch！异常 = 未预期错误，冒泡上报）
  return executeSvgExtrudeBrep(ctx, svgText)
}

/**
 * BREP 路径：用 SVG path 解析 → OCCT wire/face → extrude
 */
async function executeSvgExtrudeBrep(ctx: OpContext, svgText: string): Promise<Shape> {
  const { stmt, args, brepChain } = ctx
  if (!brepChain?.kernel) throw new Error('[executeSvgExtrude] no kernel')

  const kernel = brepChain.kernel
  const depth = args.depth as number
  const targetLongSide = (args.targetLongSide as number | undefined) ?? 20

  const solid = svgToSolid(kernel, svgText, { depth, targetLongSide })

  brepChain.solidCache.set(stmt.id, solid)
  return solidToShape(kernel, solid)
}
