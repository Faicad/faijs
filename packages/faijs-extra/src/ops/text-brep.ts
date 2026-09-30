/**
 * text-brep — three-free BREP path for the stdlib `text` op.
 *
 * Extracted from `./text.ts` so consumers that only need the OCCT text solid
 * (e.g. the cq-compat node layer) can import it WITHOUT pulling in the mesh
 * path, which transitively drags `three/examples` (SVG/3D-text chain) into a
 * node build. Everything here uses only core's text kernel + font registry.
 */

import type { Shape } from '@faicad/faijs/mesh/types'
import { solidToShape } from '@faicad/faijs/brep/brep-ops'
import { textToSolid } from '@faicad/faijs/brep/text/text-to-solid'
import { ensureDefaultFont } from '@faicad/faijs/brep/text/fontRegistry'
import { getSolidBoundingBox } from '@faicad/faijs/brep/brep-utils'
import { containsCjk, loadSystemCjkFont } from '@faicad/faijs/primitives/text/cjk-font'
import { getBackends } from '@faicad/faijs/runtime-state'
import { fromBrep } from '@faicad/faijs/shape'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'

/**
 * BREP path: font → OCCT wire/face → extrude → center + fromBrep register.
 *
 * When the text contains CJK characters but no CJK font is available, the CJK
 * runes are replaced with '?' for graceful degradation (same as the full op).
 *
 * @param params - `{ text, size, depth }` (also accepts `Record<string, unknown>`).
 * @returns the extruded text solid, X/Z centered at origin, Y bottom at 0.
 */
export async function textBrep(params: Record<string, unknown>): Promise<Shape> {
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
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

  return fromBrep(solidToShape(kernel, centeredSolid), { solid: centeredSolid })
}
