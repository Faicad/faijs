/**
 * allocate-id — 变量名自动推导服务（Phase 3 命名规则，A13 消灭）
 *
 * 设计文档：docs/plans/2026-08-27-faijs-language-normalization-design.md §4.7
 * 实施文档：docs/plans/2026-08-27-faijs-language-normalization-implementation.md §5.4
 *
 * `derivePartName` 是命名服务（宿主契约唯一形态，B2 修正）：输入只含语法事实
 * （callee/inputCount/outputCount）+ 当前代码文本（内部扫描已用 partN）
 * + 符号表查询（readonly 标注），输出 behavior（reuse/new）+ names。
 * 调用方不传任何函数元数据，也不传 IR 语句（IR 剥离红线）。
 * allocateSplitIds 被 outputCount 吸收。
 *
 * 版本号 _vM 语义取消：模型号 N 在单次脚本内单调递增（partN 新名）。
 */

import type { StatementIR } from './types'
import { asPartName, type PartName } from '../identity'
import { getFunctionSymbol } from './symbol-table'

const PART_RE = /^part(\d+)$/
/** 代码文本中出现的 partN 标识符（词法扫描，不 parse——允许部分/生成中代码） */
const PART_TOKEN_RE = /\bpart(\d+)\b/g

/** 从语句 outputs 中提取最大模型号（PartName 均为 partN 新名；旧名兼容已删，决策 2）。 */
export function getMaxModelNum(statements: StatementIR[]): number {
  let max = -1
  for (const stmt of statements) {
    for (const outId of stmt.outputs) {
      const m = PART_RE.exec(outId)
      if (m) {
        const n = parseInt(m[1], 10)
        if (n > max) max = n
      }
    }
  }
  return max
}

export interface DerivePartNameInput {
  callee: string
  /** 语法事实：位置输入数 */
  inputCount: number
  /** 语法事实：输出数（含解构键数） */
  outputCount: number
  /** 当前代码文本：内部扫描已用 partN，取下一个模型号（不 parse，允许生成中代码） */
  code: string
}

export interface DerivePartNameResult {
  behavior: 'reuse' | 'new'
  /** behavior='new' 时分配的名字（长度=outputCount）；'reuse' 时为空 */
  names: PartName[]
}

/**
 * 变量名自动推导（设计文档 §4.7 R0–R5）。
 * 输入只含语法事实 + 代码文本 + 符号表查询，调用方不传任何函数元数据。
 * 未知 callee（不在符号表）→ 默认消费语义，走 R2/R3。
 */
export function derivePartName(input: DerivePartNameInput): DerivePartNameResult {
  const { callee, inputCount, outputCount, code } = input

  // R0：无赋值语句 → 无名字
  if (outputCount === 0) return { behavior: 'new', names: [] }

  const info = getFunctionSymbol(callee)

  // R1：callee 在符号表且全部 shape 入参位置都被标 readonly → 新名（copy/group/assembly）
  //   group/assembly 无位置输入（members 走 readonlyPaths），inputCount=0 时也视为"无消费性输入"→ 新名
  const allInputsReadonly = info !== undefined && isAllInputsReadonly(info, inputCount)
  if (allInputsReadonly) {
    return { behavior: 'new', names: nextPartNames(code, outputCount) }
  }

  // R2：单入单出（消费性）→ 复用 inputs[0]
  if (inputCount === 1 && outputCount === 1) return { behavior: 'reuse', names: [] }

  // R4：多入多出且数量相等（Shape[] 批处理）→ 禁用（决策 4）
  if (inputCount > 1 && outputCount > 1 && inputCount === outputCount) {
    throw new Error(
      `[derivePartName] "${callee}" has equal multi-input/multi-output counts ` +
      `(${inputCount}→${outputCount}); Shape[] batch ops are disabled (design decision R4)`,
    )
  }

  // R3：其余（创建类、入出数量不同）→ 新名，每输出一个 partN
  return { behavior: 'new', names: nextPartNames(code, outputCount) }
}

function isAllInputsReadonly(info: { readonlyPositions?: number[] }, inputCount: number): boolean {
  if (inputCount === 0) return true            // 无位置输入（group/assembly：members 走 readonlyPaths）→ 新名
  const pos = info.readonlyPositions ?? []
  for (let i = 0; i < inputCount; i++) if (!pos.includes(i)) return false
  return true
}

/** 从代码文本扫描已用 partN，分配下一段新名（getMaxPartNum 不对外提供，B2 决策）。 */
function nextPartNames(code: string, count: number): PartName[] {
  let max = -1
  for (const m of code.matchAll(PART_TOKEN_RE)) {
    const n = parseInt(m[1], 10)
    if (n > max) max = n
  }
  const base = max + 1
  return Array.from({ length: count }, (_, i) => asPartName(`part${base + i}`))
}
