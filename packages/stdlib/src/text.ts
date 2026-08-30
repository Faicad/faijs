/**
 * stdlib text — 文字创建库函数（text）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape } from '@faicad/faijs-core/mesh/types'
import { cad } from '@faicad/faijs-core/mesh'
import { solidToShape } from '@faicad/faijs-core/brep/brep-ops'
import { textToSolid } from '@faicad/faijs-core/brep/text/text-to-solid'
import { ensureDefaultFont } from '@faicad/faijs-core/brep/text/fontRegistry'
import { getSolidBoundingBox } from '@faicad/faijs-core/brep/brep-utils'
import { containsCjk, loadSystemCjkFont } from '@faicad/faijs-core/primitives/text/cjk'
import { getBackends } from '@faicad/faijs-core/runtime-state'
import { fromBrep } from '@faicad/faijs-core/shape'
import { defineOp } from '@faicad/faijs-core/sdk'
import { assertPositiveNumber } from './assert'
import type { BrepEngineApi } from '@faicad/faijs-core/brep/engine/primitives'

/**
 * Validate text parameters: `text` must be a non-empty string, and `size` and
 * `depth` must be positive numbers.
 * @param params - the raw text operation parameters.
 */
export function assertTextParams(params: Record<string, unknown>): void {
  if (typeof params.text !== 'string' || params.text.trim() === '') {
    throw new Error(`[stdlib/text] text must be a non-empty string, got ${JSON.stringify(params.text)}`)
  }
  assertPositiveNumber(params.size, 'text.size')
  assertPositiveNumber(params.depth, 'text.depth')
}

/**
 * BREP 路径：opentype.js → OCCT wire/face → extrude → center + fromBrep 登记。
 *
 * 与 mesh 路径一样，当文本包含 CJK 字符但没有 CJK 字体时，
 * 将 CJK 字符替换为 '?' 以实现优雅降级。
 */
async function textBrep(params: Record<string, unknown>): Promise<Shape> {
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
 * @param inputOrParams.depth - 挤出深度（mm）。type:number required:true
 * @param inputOrParams.font - 字体。type:string 默认 默认字体
 * @note font 语义未定（当前只有默认字体），⚠️ 暂不要传。兼容 `cad.text(part0, {...})` 带输入形态（输入被忽略），正常写 `cad.text({...})` 即可。
 * @example
 * const t = await cad.text({ text: 'Hello', size: 20, depth: 5 })
  */
export const text = defineOp({
  mesh: async (inputOrParams: unknown, maybeParams?: Record<string, unknown>) => {
    const params = textParamsOf(inputOrParams, maybeParams)
    assertTextParams(params)
    return cad.text({ text: params.text as string, size: params.size as number, depth: params.depth as number })
  },
  brep: async (inputOrParams: unknown, maybeParams?: Record<string, unknown>) => {
    const params = textParamsOf(inputOrParams, maybeParams)
    assertTextParams(params)
    return textBrep(params)
  },
})
