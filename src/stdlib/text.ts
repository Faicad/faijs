/**
 * stdlib text — 文字创建库函数（text）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 *
 * 从 src/ops/text.ts 迁出并改写为 stdlib 形态：
 * `(params, exec) => Promise<Shape>`，resolvePath 静态判定 brep/mesh，
 * 产物经 solid() 构造器创建，solid 经 exec.setSolid 挂身份槽。
 */

import type { Shape } from '../mesh/types'
import { cad } from '../mesh'
import { solidToShape } from '../brep/brep-ops'
import { textToSolid } from '../brep/text/text-to-solid'
import { ensureDefaultFont } from '../brep/text/fontRegistry'
import { getSolidBoundingBox } from '../brep/brep-utils'
import { containsCjk, loadSystemCjkFont } from '../primitives/text/cjk'
import { solid } from './shape'
import { resolvePath } from './internal/resolve-path'
import { assertPositiveNumber } from './assert'
import type { ExecContext } from '../cad-runtime/exec-context'

/** BREP 实现标记（resolvePath 判定用；text 有 OCCT 精确构造） */
const brepImpl = textToSolid

/** text: text 必填非空字符串；size/depth 必填 > 0。 */
export function assertTextParams(params: Record<string, unknown>): void {
  if (typeof params.text !== 'string' || params.text.trim() === '') {
    throw new Error(`[stdlib/text] text must be a non-empty string, got ${JSON.stringify(params.text)}`)
  }
  assertPositiveNumber(params.size, 'text.size')
  assertPositiveNumber(params.depth, 'text.depth')
}

/**
 * BREP 路径：opentype.js → OCCT wire/face → extrude → center + 身份槽挂 solid。
 *
 * 与 mesh 路径一样，当文本包含 CJK 字符但没有 CJK 字体时，
 * 将 CJK 字符替换为 '?' 以实现优雅降级。
 */
async function textBrep(params: Record<string, unknown>, exec: ExecContext): Promise<Shape> {
  const kernel = exec.kernels.occt
  if (!kernel) throw new Error('[stdlib/text] no OCCT kernel')

  await ensureDefaultFont()

  const text = params.text as string
  const size = params.size as number
  const depth = params.depth as number

  // 如果文本包含 CJK 字符，检查是否有 CJK 字体
  let renderText = text
  if (containsCjk(text)) {
    const cjkResult = await loadSystemCjkFont()
    if (!cjkResult) {
      // 无 CJK 字体：将 CJK 字符替换为 '?' 以实现优雅降级
      renderText = text.replace(/[\u4E00-\u9FFF\u3400-\u4DBF\u2F800-\u2FA1F\u3000-\u303F\uFF00-\uFFEF]/g, '?')
    }
  }

  // 将文字转换为 OCCT solid
  const rawSolid = textToSolid(kernel, renderText, {
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

  const shape = solid(solidToShape(kernel, centeredSolid))
  exec.setSolid(shape, centeredSolid)
  return shape
}

export async function text(...rest: unknown[]): Promise<Shape> {
  const exec = rest.pop() as ExecContext
  const params = (rest.pop() ?? {}) as Record<string, unknown>
  assertTextParams(params)
  const path = resolvePath(exec, [], brepImpl)
  if (path === 'brep') return textBrep(params, exec)
  return solid(await cad.text({ text: params.text as string, size: params.size as number, depth: params.depth as number }))
}
