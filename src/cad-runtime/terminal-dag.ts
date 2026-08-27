/**
 * terminal-dag — DAG 叶子终端判定（纯函数）
 *
 * 设计文档：docs/plans/2026-08-27-restore-dag-terminal-detection.md §4.1
 *
 * 核心语义（用户 2026-08-27 澄清，最简）：
 * - 一个变量是否进终端 = 它「是否被消费」。被消费 → 不进终端。
 * - "被消费" = 存在一条**独占**语句 T（T.op ∉ NON_CONSUMING_OPS），其 index > 该变量
 *   最后一条赋值语句 P，且 T 的 inputs/refs 里包含该变量名（shape 出现在右侧）。
 * - NON_CONSUMING_OPS = {group, assembly, copy}：这三类语句**不消费**其右侧引用
 *   （group/assembly 不消费成员，copy 不消费源），在"消费方"判定中直接跳过（不计数）。
 *
 * 判定单位是 PartName（不涉及 StmtId），与 partN 命名天然兼容。
 */

import type { PartScript, TerminalShape } from '../lang/types'
import type { PartName } from '../identity'

/** 不消费其右侧引用的语句类型（group/assembly 不消费成员，copy 不消费源）。 */
const NON_CONSUMING_OPS = new Set(['group', 'assembly', 'copy'])

/**
 * 计算 DAG 叶子终端集合。
 *
 * 遍历每个 shape 变量名（含 compound 变量），"最后写者 P + 其后无独占语句消费该变量"
 * 即终端。
 *
 * @param script 已解析的 PartScript（statements 含 outputs/refs）
 * @param shapeVarNames 所有 shape-typed 顶层变量名集合（含 compound 变量名）
 * @returns 终端列表（TerminalShape[]），去重
 */
export function computeLeafTerminals(
  script: PartScript,
  shapeVarNames: Set<PartName>,
): TerminalShape[] {
  const statements = script.statements
  const terminals: TerminalShape[] = []
  const seen = new Set<string>()

  // 1. 预计算每个变量名 → 最后一条 outputs 含该名的语句下标
  const lastProducer = new Map<string, number>()
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]
    if (!stmt.hasAssignment) continue // void op 无 outputs
    for (const out of stmt.outputs) {
      lastProducer.set(out, i)
    }
  }

  // 2. 遍历每个 shape 变量名（含 compound 变量）
  for (const partName of shapeVarNames) {
    if (seen.has(partName)) continue
    seen.add(partName)

    const producerIdx = lastProducer.get(partName)
    // 无生产者（如手工注入的变量）→ 视为终端
    if (producerIdx === undefined) {
      terminals.push({ id: partName })
      continue
    }

    // 检查 producer 之后是否有独占语句消费该变量
    // refs 由 parser 收集（inputs + args 中的 $param/$geom.of + group/assembly members）；
    // 直接构造的语句可能没有 refs，回退到 inputs
    let consumed = false
    for (let i = producerIdx + 1; i < statements.length; i++) {
      const stmt = statements[i]
      if (NON_CONSUMING_OPS.has(stmt.op)) continue // group/assembly/copy 不消费

      const refs = stmt.refs ?? stmt.inputs ?? []
      if (refs.includes(partName)) {
        consumed = true
        break
      }
    }

    if (!consumed) {
      terminals.push({ id: partName })
    }
  }

  return terminals
}

/**
 * 判断一个 op 是否为"不消费"语句（NON_CONSUMING_OPS）。
 * 供 runtime 判断语句是否消费其右侧引用时使用。
 */
export function isNonConsumingOp(op: string): boolean {
  return NON_CONSUMING_OPS.has(op)
}
