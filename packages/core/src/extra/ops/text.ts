/**
 * faijs-extra text — 文字创建库函数（text）
 *
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape, Vec3 } from '../../mesh/types'
import { text as meshText } from '../mesh/primitives'
import { solidToShape } from '../../brep/brep-ops'
import { getBrepApi } from '../../brep/handle-bridge'
import { textToSolid } from '../../brep/text/text-to-solid'
import { placeOnFace } from '../../brep/text/face-place'
import { ensureDefaultFont } from '../../brep/text/fontRegistry'
import { getSolidBoundingBox } from '../../brep/brep-utils'
import { containsCjk, loadSystemCjkFont } from '../../primitives/text/cjk-font'
import { fromBrep } from '../../shape'
import { defineOp } from '../../sdk'
import type { Provenance } from '../../topology/naming/lineage'
import { assertNumber, assertPositiveNumber } from '../../api/assert'

/**
 * Validate text parameters: `text` must be a non-empty string, `size` must be a
 * positive number, and `depth` a finite number (may be negative — a negative
 * depth extrudes along -Z, i.e. a "concave" pocket on the chosen face, the same
 * mechanism as a sketch's negative-direction extrusion).
 * @param params - the raw text operation parameters.
 */
export function assertTextParams(params: Record<string, unknown>): void {
  if (typeof params.text !== 'string' || params.text.trim() === '') {
    throw new Error(`[extra/text] text must be a non-empty string, got ${JSON.stringify(params.text)}`)
  }
  assertPositiveNumber(params.size, 'text.size')
  assertNumber(params.depth, 'text.depth')
}

/**
 * BREP 路径：opentype.js → OCCT wire/face → extrude → center + fromBrep 登记。
 *
 * 与 mesh 路径一样，当文本包含 CJK 字符但没有 CJK 字体时，
 * 将 CJK 字符替换为 '?' 以实现优雅降级。
 */
async function textBrep(params: Record<string, unknown>): Promise<Shape> {
  const kernel = getBrepApi()

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

  // 面上放置（`faceCenter` 给定 = 用户先选了一张面）：居中 → 旋到法向 → 平移到面心。
  // 沿法向额外推 `depth/2`：轮廓体的厚度是**居中**的（z∈[-d/2,+d/2]），不推的话
  // 一半陷在面里 —— 而「在面上写字」的语义是整块凸出在面外（底面贴面）。
  // 对齐与刻字共用 `placeOnFace`，所以同一个面、同一段文字，两个工具的朝向一致。
  if (params.faceCenter !== undefined && params.faceCenter !== null) {
    const faceCenter = params.faceCenter as Vec3
    const faceNormal = (params.faceNormal as Vec3 | undefined) ?? [0, 0, 1]
    const placed = placeOnFace(kernel, rawSolid, faceCenter, faceNormal, depth / 2)
    return fromBrep(solidToShape(kernel, placed), { solid: placed })
  }

  // 无面（历史行为）：Center the solid to match mesh path behavior:
  // X/Z centered at origin, Y bottom aligned to 0
  const bbox = getSolidBoundingBox(kernel, rawSolid)
  const cx = (bbox.min[0] + bbox.max[0]) / 2
  const cz = (bbox.min[2] + bbox.max[2]) / 2
  const centeredSolid = kernel.translate(rawSolid, -cx, -bbox.min[1], -cz)
  kernel.release(rawSolid)

  return fromBrep(solidToShape(kernel, centeredSolid), { solid: centeredSolid })
}

/** 兼容两种调用形态：`cad.text({ text, size, depth })`（创建类）与
 * `cad.text(part0, { text, size, depth })`（历史 fixture 带输入参数，输入被忽略）。 */
function textParamsOf(inputOrParams: unknown, maybeParams?: Record<string, unknown>): Record<string, unknown> {
  return (maybeParams ?? inputOrParams ?? {}) as Record<string, unknown>
}

/**
 * 生成文字零件（文字轮廓挤出，X/Z 居中、Y 底部对齐原点）。
 * @group 创建
 * @inputs 0
 * @async true
 * @qual warn
 * @name text
 * @returns Shape 文字几何，生成独立零件。
 * @param maybeParams - 兼容形态的补充参数（正常不传）。type:Record<string, unknown> required:false
 * @param inputOrParams.text - 要生成的文字。type:string required:true
 * @param inputOrParams.size - 字号（mm）。type:number required:true
 * @param inputOrParams.depth - 挤出深度（mm）；允许负值，负值=沿 -Z 负向拉伸（凹陷口袋，与草图负向拉伸同逻辑）。type:number required:true
 * @param inputOrParams.font - 字体。type:string 默认 默认字体
 * @param inputOrParams.faceCenter - 面心（给了就贴在该面上：文字中心落此处、厚度朝面外）。type:[x,y,z]
 * @param inputOrParams.faceNormal - 面外法向（与 faceCenter 配套；缺省 [0,0,1]）。type:[x,y,z]
 * @note font 语义未定（当前只有默认字体），⚠️ 暂不要传。兼容 `cad.text(part0, {...})` 带输入形态（输入被忽略），正常写 `cad.text({...})` 即可。
 * @note faceCenter 只有 BREP 实现：mesh 几何上传 faceCenter 会显式报错（不静默忽略）。不给 faceCenter 时保持历史行为（X 居中、Y 底部对齐原点）。
 * @example
 * const t = cad.text({ text: 'Hello', size: 20, depth: 5 })
 * @example
 * const t = cad.text({ text: 'Hello', size: 20, depth: 5, faceCenter: [0, 0, 15], faceNormal: [0, 0, 1] })
  */
export const text = defineOp({
  mesh: async (inputOrParams: unknown, maybeParams?: Record<string, unknown>) => {
    const params = textParamsOf(inputOrParams, maybeParams)
    assertTextParams(params)
    // 面上放置只有 BREP 实现（`placeOnFace` 走内核 transform/translate）。mesh 几何上
    // 静默忽略 faceCenter 等于"选了一张面，文字却还躺在世界原点" —— 必须报错（与
    // `engrave` 对 DXF 的 mesh 拒绝同一口径）。
    if (params.faceCenter !== undefined && params.faceCenter !== null) {
      throw new Error('[extra/text] faceCenter requires BREP geometry (input is mesh)')
    }
    return meshText({ text: params.text as string, size: params.size as number, depth: params.depth as number })
  },
  brep: async (inputOrParams: unknown, maybeParams?: Record<string, unknown>) => {
    const params = textParamsOf(inputOrParams, maybeParams)
    assertTextParams(params)
    return textBrep(params)
  },
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [] } } as Provenance,

  paramDims: { size: 'length', depth: 'length', faceCenter: 'length', faceNormal: 'plain' },
})
