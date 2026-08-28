/**
 * terminal-dag — DAG 叶子终端判定（纯函数，符号表驱动）
 *
 * 设计文档：docs/plans/2026-08-27-restore-dag-terminal-detection.md §4.1
 *          docs/plans/2026-08-27-faijs-language-normalization-design.md §4.8
 * 实施文档：docs/plans/2026-08-27-faijs-language-normalization-implementation.md §5.5
 *
 * 核心语义（用户 2026-08-27 澄清，最简）：
 * - 一个变量是否进终端 = 它「是否被消费」。被消费 → 不进终端。
 * - "被消费" = 存在一条**独占**语句 T，其 index > 该变量最后一条赋值语句 P，
 *   且 `consumes(T, v)` 判定 T 消费了该变量（符号表驱动，B1 消灭 NON_CONSUMING_OPS）。
 *
 * 判定单位是 PartName（不涉及 StmtId），与 partN 命名天然兼容。
 */

import type { ScriptIR, TerminalShape, StatementIR, ArgIR } from '../lang/types'
import type { PartName } from '../identity'
import { getFunctionSymbol } from '../lang/symbol-table'
import { isVarRef, isCallRef } from '../lang/types'

/**
 * 判定语句 stmt 是否"消费"变量 v（替换 NON_CONSUMING_OPS 查表）。
 * 规则（设计文档 §4.8）：
 * - 未知 callee → 无 readonly 信息 → 右侧出现即消费（默认）
 * - 嵌套调用（CallRefIR）中的引用 = 只读查询，不消费
 * - 符号表标记的 readonly 位置/路径不消费（copy 的源、group/assembly 的 members）
 * - receiver（成员方法调用，如 add_constraint / do_assemble）是**原地修改** compound：
 *   它**不消费** receiver 变量，compound 仍作为终端显示。只有出现在右侧 args 中的
 *   普通 shape 引用才按 readonly 规则判定是否消费（设计 §4.8：仅函数调用的输入 shape 被消费）。
 */
export function consumes(stmt: StatementIR, v: PartName): boolean {
  // inputs：位置引用（符号表 readonlyPositions 命中的位置不消费）
  const idx = stmt.inputs.indexOf(v)
  if (idx >= 0) {
    const info = getFunctionSymbol(stmt.callee)
    if (!info?.readonlyPositions?.includes(idx)) return true
  }
  // args：递归扫描 VarRefIR（CallRefIR 内不消费；readonlyPaths 属性内不消费）
  let consumed = false
  const scan = (value: ArgIR, inCallRef: boolean, path: string[]): void => {
    if (consumed) return
    if (value === null || typeof value !== 'object') return
    if (isVarRef(value)) {
      if (value.$ref !== v) return
      if (inCallRef) return                       // 嵌套调用内 = 只读查询
      const info = getFunctionSymbol(stmt.callee)
      // readonlyPaths 匹配路径首段（如 members）
      if (info?.readonlyPaths?.includes(path[0] ?? '')) return
      consumed = true
      return
    }
    if (isCallRef(value)) {
      for (const a of value.$call.args) scan(a, true, path)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) scan(item as ArgIR, inCallRef, path)
      return
    }
    for (const [k, vv] of Object.entries(value)) scan(vv as ArgIR, inCallRef, [...path, k])
  }
  for (const [k, vv] of Object.entries(stmt.args)) scan(vv, false, [k])
  return consumed
}

/**
 * 计算 DAG 叶子终端集合。
 *
 * 遍历每个 shape 变量名（含 compound 变量），"最后写者 P + 其后无独占语句消费该变量"
 * 即终端（消费判定换 consumes，B1 消灭）。
 *
 * @param script 已解析的 ScriptIR（statements 含 outputs/refs）
 * @param shapeVarNames 所有 shape-typed 顶层变量名集合（含 compound 变量名）
 * @returns 终端列表（TerminalShape[]），去重
 */
export function computeLeafTerminals(
  script: ScriptIR,
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

    // 检查 producer 之后是否有语句消费该变量（符号表驱动 consumes）
    let consumed = false
    for (let i = producerIdx + 1; i < statements.length; i++) {
      const stmt = statements[i]
      if (consumes(stmt, partName)) {
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
