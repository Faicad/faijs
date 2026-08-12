/**
 * 文字操作分派器
 *
 * BREP 路径：用 opentype.js → OCCT wire/face → extrude
 * Mesh 路径：用 THREE.js TextGeometry
 */

import type { Shape } from '../../cad-core/types'
import { cad } from '../../cad-core'
import { textToSolid } from '../text/textBlueprints'
import { ensureDefaultFont } from '../text/fontRegistry'
import { solidToShape } from '../brep-ops'
import type { OpContext } from './types'
import { canUseBrep } from './types'

/**
 * 执行文字操作
 */
export async function executeText(ctx: OpContext): Promise<Shape> {
  const { args } = ctx

  // 链不活跃 → mesh 路径（链已在前面静态断掉，正常继续）
  if (!canUseBrep(ctx)) {
    return cad.text({
    text: args.text as string,
    size: args.size as number,
    depth: args.depth as number,
  })
  }

  // 链活跃 → BREP 路径（直接执行，不包 try-catch！异常 = 未预期错误，冒泡上报）
  return executeTextBrep(ctx)
}

/**
 * BREP 路径：用 opentype.js → OCCT wire/face → extrude
 */
async function executeTextBrep(ctx: OpContext): Promise<Shape> {
  const { stmt, args, brepChain } = ctx
  if (!brepChain?.kernel) throw new Error('[executeText] no kernel')

  await ensureDefaultFont()

  const kernel = brepChain.kernel
  const text = args.text as string
  const size = args.size as number
  const depth = args.depth as number

  // 将文字转换为 OCCT solid
  const solid = textToSolid(kernel, text, {
    fontSize: size,
    depth,
  })

  brepChain.solidCache.set(stmt.id, solid)
  return solidToShape(kernel, solid)
}
