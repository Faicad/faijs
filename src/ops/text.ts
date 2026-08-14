/**
 * 文字操作分派器
 *
 * BREP 路径：用 opentype.js → OCCT wire/face → extrude → center
 * Mesh 路径：用 opentype.js → THREE.Shape → ExtrudeGeometry → center
 *
 * 两条路径使用同一字体（OpenSans Regular via fontRegistry），
 * 且都做相同的居中处理（X/Z 居中，Y 底部对齐到 0）。
 */

import type { Shape } from '../mesh/types'
import { cad } from '../mesh'
import { textToSolid } from '../brep/text/text-to-solid'
import { ensureDefaultFont } from '../brep/text/fontRegistry'
import { solidToShape } from '../brep/brep-ops'
import { getSolidBoundingBox } from '../brep/brep-utils'
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
  const rawSolid = textToSolid(kernel, text, {
    fontSize: size,
    depth,
  })

  // Center the solid to match mesh path behavior:
  // X/Z centered at origin, Y bottom aligned to 0
  const bbox = getSolidBoundingBox(kernel, rawSolid)
  const cx = (bbox.min[0] + bbox.max[0]) / 2
  const cz = (bbox.min[2] + bbox.max[2]) / 2
  const centeredSolid = kernel.translate(rawSolid, -cx, -bbox.min[1], -cz)
  kernel.release(rawSolid)

  brepChain.solidCache.set(stmt.id, centeredSolid)
  return solidToShape(kernel, centeredSolid)
}
