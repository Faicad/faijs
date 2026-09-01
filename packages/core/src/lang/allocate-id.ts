/**
 * allocate-id — 变量名自动推导服务（keep-syntax 设计 §4：命名与保留解耦，总是新名）
 *
 * 设计文档：docs/plans/2026-08-28-keep-syntax-design.md §4
 * 前置文档：docs/plans/2026-08-27-faijs-language-normalization-design.md §4.7
 *
 * `derivePartName` 是命名服务（宿主契约唯一形态，B2 修正）：输入只含语法事实
 * （inputCount/outputCount）+ 当前代码文本（内部扫描已用 partN）。
 * 调用方不传任何函数元数据，也不传 IR 语句（IR 剥离红线）。
 * allocateSplitIds 被 outputCount 吸收。
 *
 * 命名规则（keep-syntax §4.2）：
 * - R0：无赋值语句 → 无名字
 * - R4：多入多出且数量相等（Shape[] 批处理）→ 保持禁用（独立决策）
 * - 唯一规则：一律分配新名（R1/R2 复用名已删——复用名是一条会持续产生 bug 的复杂源）
 *
 * 命名不再含版本后缀：模型号 N 在单次脚本内单调递增（partN 新名）。
 */

import type { StatementIR } from './types'
import { asPartName, type PartName } from '../identity'

const PART_RE = /^part(\d+)$/
/** 代码文本中出现的 partN 标识符（词法扫描，不 parse——允许部分/生成中代码） */
const PART_TOKEN_RE = /\bpart(\d+)\b/g

/**
 * Extract the largest model number across statement outputs (PartNames are all
 * fresh partN names; legacy-name compatibility was removed, decision 2).
 * @param statements - the IR statements to scan.
 * @returns the maximum part model number found, or -1 when no output matches.
 */
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

/**
 * The syntax-fact inputs to part-name derivation: positional input/output
 * counts plus the current code text for scanning used partN names.
 */
export interface DerivePartNameInput {
  /** 语法事实：位置输入数 */
  inputCount: number
  /** 语法事实：输出数（含解构键数） */
  outputCount: number
  /** 当前代码文本：内部扫描已用 partN，取下一个模型号（不 parse，允许生成中代码） */
  code: string
  /** 可选：排除区间（如函数体 [start, end)），扫描 partN 时跳过——
   *  函数体内的 partN 不污染顶层命名（§7.1，FunctionDefIR.bodyRange 来源）。 */
  excludeRanges?: Array<{ start: number; end: number }>
}

/**
 * The result of part-name derivation: always behavior `'new'` with one fresh
 * name per output.
 */
export interface DerivePartNameResult {
  /** 恒为 'new'（keep-syntax §4：复用名已删；保留字段供宿主平滑迁移） */
  behavior: 'new'
  /** 分配的名字（长度=outputCount） */
  names: PartName[]
}

/**
 * 变量名自动推导（keep-syntax 设计 §4.2）：命名与「入参是否被保留」的静态知识
 * 完全解耦——无论 callee 是否保留入参，输出都获得新名。
 * 输入只含语法事实 + 代码文本，调用方不传任何函数元数据。
 */
/**
 * Derive variable names (keep-syntax design §4.2): naming is fully decoupled
 * from whether the callee preserves its inputs — outputs always receive fresh
 * names. The input carries only syntax facts plus code text; the caller must
 * not pass any function metadata.
 * @param input - the syntax-fact input: input/output counts and code text.
 * @returns the derived result with one fresh name per output.
 */
export function derivePartName(input: DerivePartNameInput): DerivePartNameResult {
  const { inputCount, outputCount, code, excludeRanges } = input

  // R0：无赋值语句 → 无名字
  if (outputCount === 0) return { behavior: 'new', names: [] }

  // R4：多入多出且数量相等（Shape[] 批处理）→ 禁用（独立决策，与复用无关）
  if (inputCount > 1 && outputCount > 1 && inputCount === outputCount) {
    throw new Error(
      `[derivePartName] equal multi-input/multi-output counts ` +
      `(${inputCount}→${outputCount}); Shape[] batch ops are disabled (design decision R4)`,
    )
  }

  // 唯一规则：一律分配新名（每输出一个 partN）
  return { behavior: 'new', names: nextPartNames(code, outputCount, excludeRanges) }
}

/** 从代码文本扫描已用 partN，分配下一段新名（getMaxPartNum 不对外提供，B2 决策）。
 *  @param excludeRanges 可选排除区间：区间内的 partN 不参与计数（函数体 partN 不污染顶层命名，§7.1）。 */
function nextPartNames(code: string, count: number, excludeRanges?: Array<{ start: number; end: number }>): PartName[] {
  let max = -1
  for (const m of code.matchAll(PART_TOKEN_RE)) {
    const idx = m.index ?? 0
    if (excludeRanges?.some((r) => idx >= r.start && idx < r.end)) continue
    const n = parseInt(m[1], 10)
    if (n > max) max = n
  }
  const base = max + 1
  return Array.from({ length: count }, (_, i) => asPartName(`part${base + i}`))
}
