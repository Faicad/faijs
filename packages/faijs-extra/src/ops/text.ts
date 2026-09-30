/**
 * stdlib text — 文字创建库函数（text）
 *
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape } from '@faicad/faijs/mesh/types'
import { text as meshText } from '../mesh/primitives'
import { defineOp } from '@faicad/faijs/sdk'
import type { Provenance } from '@faicad/faijs/topology/naming/lineage'
import { assertPositiveNumber } from '@faicad/faijs/api/assert'
import { textBrep } from './text-brep'

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
 * BREP 路径：委托给 three-free 的 `textBrep`（opentype.js → OCCT wire/face →
 * extrude → center + fromBrep 登记）。CJK 降级逻辑见 `./text-brep`。
 */

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
    return meshText({ text: params.text as string, size: params.size as number, depth: params.depth as number })
  },
  brep: async (inputOrParams: unknown, maybeParams?: Record<string, unknown>) => {
    const params = textParamsOf(inputOrParams, maybeParams)
    assertTextParams(params)
    return textBrep(params as Record<string, unknown>)
  },
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [] } } as Provenance,
})
