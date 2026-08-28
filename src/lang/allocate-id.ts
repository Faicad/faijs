/**
 * allocate-id — 变量名自动推导服务（Phase 3 命名规则，A13 消灭）
 *
 * 设计文档：docs/plans/2026-08-27-faijs-language-normalization-design.md §4.7
 * 实施文档：docs/plans/2026-08-27-faijs-language-normalization-implementation.md §5.4
 *
 * `derivePartName` 是命名服务：输入只含语法事实（callee/inputCount/outputCount）
 * + 符号表查询（readonly 标注），输出 behavior（reuse/new）+ names。
 * 调用方不传任何函数元数据；op 白名单（isCreatorOp/isCloneOp/isBooleanOp）与
 * group/assembly 特判全部删除；allocateSplitIds 被 outputCount 吸收。
 *
 * 版本号 _vM 语义取消：模型号 N 在单次脚本内单调递增（partN 新名）。
 */

import type { CadStatement } from './types'
import { asPartName, type PartName } from '../identity'
import { getFunctionSymbol } from './symbol-table'

const PART_RE = /^part(\d+)$/

/** 从语句 outputs 中提取最大模型号（PartName 均为 partN 新名；旧名兼容已删，决策 2）。 */
export function getMaxModelNum(statements: CadStatement[]): number {
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
  /** 现有语句（取下一个 partN） */
  statements: CadStatement[]
}

export interface DerivePartNameResult {
  behavior: 'reuse' | 'new'
  /** behavior='new' 时分配的名字（长度=outputCount）；'reuse' 时为空 */
  names: PartName[]
}

/**
 * 变量名自动推导（设计文档 §4.7 R0–R5）。
 * 输入只含语法事实 + 符号表查询，调用方不传任何函数元数据。
 * 未知 callee（不在符号表）→ 默认消费语义，走 R2/R3。
 */
export function derivePartName(input: DerivePartNameInput): DerivePartNameResult {
  const { callee, inputCount, outputCount, statements } = input

  // R0：无赋值语句 → 无名字
  if (outputCount === 0) return { behavior: 'new', names: [] }

  const info = getFunctionSymbol(callee)

  // R1：callee 在符号表且全部 shape 入参位置都被标 readonly → 新名（copy/group/assembly）
  //   group/assembly 无位置输入（members 走 readonlyPaths），inputCount=0 时也视为"无消费性输入"→ 新名
  const allInputsReadonly = info !== undefined && isAllInputsReadonly(info, inputCount)
  if (allInputsReadonly) {
    return { behavior: 'new', names: nextPartNames(statements, outputCount) }
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
  return { behavior: 'new', names: nextPartNames(statements, outputCount) }
}

function isAllInputsReadonly(info: { readonlyPositions?: number[] }, inputCount: number): boolean {
  if (inputCount === 0) return true            // 无位置输入（group/assembly：members 走 readonlyPaths）→ 新名
  const pos = info.readonlyPositions ?? []
  for (let i = 0; i < inputCount; i++) if (!pos.includes(i)) return false
  return true
}

function nextPartNames(statements: CadStatement[], count: number): PartName[] {
  const base = getMaxModelNum(statements) + 1
  return Array.from({ length: count }, (_, i) => asPartName(`part${base + i}`))
}
