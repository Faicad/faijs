/**
 * stdlib svgExtrude — SVG 挤出创建库函数（creator op，无输入）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 *
 * 从 src/ops/svgExtrude.ts 迁出并改写为 stdlib 形态：
 * `(params, exec) => Promise<Shape>`，resolvePath 静态判定 brep/mesh，
 * 产物经 solid() 构造器创建，solid 经 exec.setSolid 挂身份槽。
 */

import type { Shape } from '../mesh/types'
import { cad } from '../mesh'
import { parseSvgNaturalSize } from '../primitives/parse-svg-size'
import { svgToSolid } from '../brep/svg/svg-to-solid'
import { solidToShape } from '../brep/brep-ops'
import { resolveSvgArg } from '../ops/svg-asset-resolver'
import { solid } from './shape'
import { resolvePath } from './internal/resolve-path'
import type { ExecContext, ExecContextImpl } from '../cad-runtime/exec-context'

/** BREP 实现标记（resolvePath 判定用；svgExtrude 有 OCCT 精确构造） */
const brepImpl = svgToSolid

/** BREP 路径：SVG path 解析 → OCCT wire/face → extrude + 身份槽挂 solid。 */
function svgExtrudeBrep(params: Record<string, unknown>, exec: ExecContext, svgText: string): Shape {
  const kernel = exec.kernels.occt
  if (!kernel) throw new Error('[stdlib/svgExtrude] no OCCT kernel')

  const solidHandle = svgToSolid(kernel, svgText, {
    depth: params.depth as number,
    targetLongSide: (params.targetLongSide as number | undefined) ?? 20,
  })

  const shape = solid(solidToShape(kernel, solidHandle))
  exec.setSolid(shape, solidHandle)
  return shape
}

export async function svgExtrude(params: Record<string, unknown>, exec: ExecContext): Promise<Shape> {
  // 解析 SVG 资产引用（AssetRef → SVG 文本）；两条路径都需要
  const svgText = await resolveSvgArg(params.svg, (exec as ExecContextImpl).ports)

  const path = resolvePath(exec, [], brepImpl)
  if (path === 'brep') return svgExtrudeBrep(params, exec, svgText)

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
