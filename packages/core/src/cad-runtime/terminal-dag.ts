/**
 * terminal-dag — DAG 叶子终端判定（keep 驱动，C0/C1/C3/C5）
 *
 *
 * 核心语义（keep 统一机制）：
 * - 一个变量是否进终端 = 它「是否被消费」。被消费 → 不进终端。
 * - "被消费" = 存在一条语句 T（位于该变量最后一条赋值语句 P 之后）判定 T 消费了该变量。
 *
 * 单条语句 T 对变量 v 的消费判定（短路）：
 * - C0/C1：v ∈ resolveKeep(T).kept（调用点 keep 或函数体 exec.keep 声明）→ 不消费。
 *   声明层是「有人表态」：用户/库作者显式声明保留。
 * - C3：T 有赋值且所有输出都是非几何（outputs 均不在 shapeVarNames）→ 不消费任何输入。
 *   推断层客观默认：faijs 执行模型是纯函数链，「返回非几何的函数不可能把几何吞进结果」
 *   ——零签名知识，第三方测量/查询函数的输入不被误吃（R9）。
 * - C5：默认消费（drill/transform/未声明保留的第三方几何函数）。
 * - 嵌套调用（CallRefIR）中的引用 = 只读查询，不消费（既有规则，与 C3 同精神）。
 * - receiver（成员方法调用，add_constraint/do_assemble）不消费 receiver 变量。
 *
 * hidden（D1/D2）：「最后一次保留声明胜出」——按语句顺序遍历，
 * 后声明的保留条目压过先前的（union 的 keepHidden 被 group 的 keep 覆盖为可见）。
 *
 * 判定单位是 PartName（不涉及 StmtId），与 partN 命名天然兼容。
 */

import type { ScriptIR, TerminalShape, StatementIR, ArgIR } from '../lang/types'
import type { PartName } from '../identity'
import { isVarRef, isCallRef, isExprRef, statementInputs } from '../lang/types'
import { resolveKeep, type InternalKeepRecord } from '../lang/keep'

/**
 * DAG 运行时视图（设计契约 §6）：terminal-dag 从运行时读取函数体 keep 登记。
 * 省略 view → 纯静态判定（C0 + C3 + C5，无 C1 函数体声明信息）。
 */
export interface DagRuntimeView {
  /** 变量当前值（运行时；纯静态场景无值） */
  value(name: PartName): unknown
  /** 函数体 exec.keep 登记（ModuleExecutor.internalKeep，缓存命中时保留上一轮记录） */
  internalKeep(stmt: StatementIR): InternalKeepRecord | undefined
}

/**
 * Determine whether statement stmt "consumes" variable v (keep driven, using
 * the C0 → C3 → C5 short-circuit flow).
 * @param stmt - the statement under test.
 * @param v - the variable name (PartName).
 * @param view - the runtime view; when omitted a purely static pass with no
 * function-body declaration info is used.
 * @param shapeVarNames - the set of all shape-typed top-level variable names,
 * the basis for the C3 decision.
 * @returns true when the statement consumes the variable.
 */
export function consumes(
  stmt: StatementIR,
  v: PartName,
  view?: DagRuntimeView,
  shapeVarNames?: Set<PartName>,
): boolean {
  // C0: keep declarations win — a kept variable is not consumed by this statement
  const resolved = resolveKeep(stmt, view?.internalKeep(stmt))
  if (resolved.kept.has(v)) return false

  // C3：本语句有赋值且所有输出都是非几何 → 纯数据/测量/查询语句，不消费任何输入
  if (
    stmt.hasAssignment &&
    stmt.outputs.length > 0 &&
    shapeVarNames !== undefined &&
    stmt.outputs.every((o) => !shapeVarNames.has(o))
  ) {
    return false
  }

  // C5：默认消费。positional 中的 VarRefIR（原 inputs 语义，§4.5.1）
  if (statementInputs(stmt).includes(v)) return true

  // positional 非变量元素 + args：递归扫描（ExprIR refs 按 C5 消费；CallRefIR 内
  // 不消费 = 只读查询）。args 是尾随对象投影（真源 positional），重复扫描幂等；
  // 手工构造 IR 可能只填 args。
  let consumed = false
  const scan = (value: ArgIR, inCallRef: boolean): void => {
    if (consumed) return
    if (value === null || typeof value !== 'object') return
    if (isVarRef(value)) {
      if (value.$ref !== v) return
      if (inCallRef) return                       // 嵌套调用内 = 只读查询
      consumed = true
      return
    }
    if (isExprRef(value)) {
      if (inCallRef) return                       // 嵌套调用内 = 只读查询
      if (value.$expr.refs.includes(String(v))) consumed = true
      return
    }
    if (isCallRef(value)) {
      for (const a of value.$call.args) scan(a, true)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) scan(item as ArgIR, inCallRef)
      return
    }
    for (const vv of Object.values(value)) scan(vv as ArgIR, inCallRef)
  }
  for (const parg of stmt.positional ?? []) scan(parg, false)
  for (const vv of Object.values(stmt.args ?? {})) scan(vv, false)
  return consumed
}

/**
 * 计算 DAG 叶子终端集合（keep 驱动）。
 *
 * 遍历每个 shape 变量名（含 compound 变量）：
 * - 「最后写者 P + 其后无语句消费该变量」→ 终端；
 * - 被 keep 声明保留的变量不被声明语句消费（C0/C1 在 consumes 内短路）。
 *
 * hidden（D2）：按语句顺序应用「最后一次保留声明胜出」；未声明保留的终端可见
 * （hidden 为 undefined）。
 *
 * @param script 已解析的 ScriptIR（statements 含 outputs/refs）
 * @param shapeVarNames 所有 shape-typed 顶层变量名集合（含 compound 变量名）
 * @param view 运行时视图（省略 → 纯静态判定，供纯静态单测/工具）
 * @returns 终端列表（TerminalShape[]），去重
 */
export function computeLeafTerminals(
  script: ScriptIR,
  shapeVarNames: Set<PartName>,
  view?: DagRuntimeView,
): TerminalShape[] {
  const statements = script.statements
  const terminals: TerminalShape[] = []
  const seen = new Set<string>()

  // 0. hidden 计算（D2：最后一次保留声明胜出）——按语句顺序遍历，
  //    每个 kept 变量的 hidden 被后续声明覆盖。
  const hiddenOf = new Map<PartName, boolean>()
  for (const stmt of statements) {
    const resolved = resolveKeep(stmt, view?.internalKeep(stmt))
    for (const v of resolved.kept) {
      hiddenOf.set(v, resolved.hidden.get(v) ?? false)
    }
  }

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
      terminals.push(makeTerminal(partName, hiddenOf))
      continue
    }

    // 检查 producer 之后是否有语句消费该变量（keep 驱动 consumes）
    let consumed = false
    for (let i = producerIdx + 1; i < statements.length; i++) {
      if (consumes(statements[i], partName, view, shapeVarNames)) {
        consumed = true
        break
      }
    }

    if (!consumed) {
      terminals.push(makeTerminal(partName, hiddenOf))
    }
  }

  return terminals
}

/**
 * 组装终端条目（设计 §6：hidden 缺省 undefined → 可见）。
 * 只有显式 hidden=true 才带 hidden 字段；可见（false/未声明）归一为 undefined，
 * 与宿主 `setNodeVisible(scopedId, !terminal.hidden)` 的消费语义一致。
 */
function makeTerminal(id: PartName, hiddenOf: Map<PartName, boolean>): TerminalShape {
  const hidden = hiddenOf.get(id)
  return hidden ? { id, hidden: true } : { id }
}
