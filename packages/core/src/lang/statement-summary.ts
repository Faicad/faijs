/**
 * statement-summary — 语句平铺摘要（宿主展示/编排用，非 IR 类型）
 *
 * See docs/syntax-design.md §3 (statement model ↔ StatementIR mapping).
 *
 * `analyzeCode(code)` 是宿主消费语句信息的唯一形态（IR 剥离后宿主禁止
 * import ScriptIR/StatementIR）。摘要只含展示/编排所需的标量字段：
 * Timeline 一行一节点、场景树分组推导、FeatureTree 识别、编辑回填定位。
 *
 * 实现直接复用 parser 输出做投影，不引入新解析逻辑（阶段 0 约束）。
 *
 * §4.4 变更（2026-09-05 位置实参全形态编辑往返方案）：
 * - `positional` 改为 `HostArg[]`（IR 已脱壳，宿主不接触 IR 标记对象）
 * - 新增 `args: Record<string, HostArg>`（原 `positional`/`inputs` 之外的信息缺口）
 * - 删除 `positionalKinds`/`PositionalKind`/`classifyPositional`（冗余投影，
 *   宿主可用 `isHostRef` 等守卫自行裁决）
 * - 删除 `inputs`（`statementInputs` 的投影；宿主从 `positional` 中筛
 *   `isHostVarRef` 即可得到等价信息）
 */

import type { StmtId, PartName } from '../identity'
import type { ArgIR } from './types'
import type { HostArg } from './host-arg'
import { argIRToHost } from './host-arg'
import { parseScript } from './parser'

/**
 * A flat scalar projection of one statement for host display and orchestration
 * (a non-IR type). Timeline rows, scene tree grouping, feature-tree
 * recognition, and edit-backfill navigation all consume this summary.
 */
export interface StatementSummary {
  /** 语句 id（sN，parser 顺序分配） */
  id: StmtId
  /** 调用名（<ns>.<callee> 或成员方法名） */
  callee: string
  /** 调用命名空间（F2：`mech.makeHeadstock(...)` → 'mech'；缺省 cad 时为 undefined） */
  namespace?: string
  /** 本机函数调用（§3.4）：callee 是脚本内函数名，namespace/packageName 缺省。
   *  宿主据此渲染「本机函数」节点（只读编辑，函数体不透明）。 */
  local?: boolean
  /** 命名空间对应的包名（F2：由顶层 import specifier 推导；cad 时为 undefined）。
   *  timeline「带包名」标识 / 宿主 getFeatureByOp(packageName, op) 的依据。 */
  packageName?: string
  /** 成员方法调用接收者变量（asm1.do_assemble() → 'asm1'） */
  receiver?: PartName
  /**
   * 位置实参槽（HostArg 形态，IR 已脱壳）。
   * 每个元素是 HostArg——字面量原样；var-ref/param-ref/call-ref/expr-ref
   * 以 `{kind, ...}` 形态呈现。宿主用 `isHostVarRef` 等守卫判定形态。
   */
  positional: HostArg[]
  /**
   * 尾随选项对象（HostArg 形态，IR 已脱壳）。
   * 键值经 argIRToHost 映射；无选项对象时为 `{}`。
   */
  args: Record<string, HostArg>
  /** 产出变量名（split 解构 = 多个；void 语句 = []） */
  outputs: PartName[]
  /** 解构键（const {front: a, back: b} → ['front','back']） */
  outputKeys?: string[]
  /** 语句引用的变量名集合（parser 收集） */
  refs?: string[]
  /** 是否有赋值（const/let 声明 = true；裸重赋值/成员调用 = false） */
  hasAssignment: boolean
  /** 参数是否含计算表达式（F1：parser 折叠时置位）。
   *  true → 宿主编辑面板降级为只读/代码编辑，禁止表单写回（防表达式丢失）。 */
  hasComputedArgs: boolean
  /** 源码行号（1-based） */
  line: number
}

/**
 * 解析代码文本，返回语句平铺摘要（非 IR 类型）。
 * 与 parser 结果逐字段一致（阶段 0 测试兜底）。
 *
 * @param code - the faijs source text to parse and summarize.
 * @returns a flat statement summary for every parsed statement.
 * @throws ParseError — 含行号
 */
export function analyzeCode(code: string): StatementSummary[] {
  const { script, statementLines } = parseScript(code)
  // F2：命名空间绑定名 → 包名（summary.packageName 的推导来源；cad 无包名）
  const nsToPkg = new Map<string, string>()
  for (const imp of script.imports ?? []) {
    if (imp.kind === 'namespace') nsToPkg.set(imp.localName, imp.packageName)
  }
  return script.statements.map((s, i) => ({
    id: s.id,
    callee: s.callee,
    ...(s.local ? { local: true } : {}),
    ...(s.namespace !== undefined
      ? { namespace: s.namespace, ...(nsToPkg.get(s.namespace) !== undefined ? { packageName: nsToPkg.get(s.namespace) } : {}) }
      : {}),
    ...(s.receiver !== undefined ? { receiver: s.receiver } : {}),
    positional: (s.positional ?? []).map((a: ArgIR) => argIRToHost(a)),
    args: mapIRRecord(s.args),
    outputs: [...s.outputs],
    ...(s.outputKeys !== undefined ? { outputKeys: [...s.outputKeys] } : {}),
    ...(s.refs !== undefined ? { refs: [...s.refs] } : {}),
    hasAssignment: s.hasAssignment ?? false,
    hasComputedArgs: s.hasComputedArgs ?? false,
    line: statementLines[i] ?? 0,
  }))
}

/**
 * Map a record of ArgIR values to HostArg values (IR → Host 脱壳).
 */
function mapIRRecord(record: Record<string, ArgIR>): Record<string, HostArg> {
  const out: Record<string, HostArg> = {}
  for (const [k, v] of Object.entries(record)) {
    out[k] = argIRToHost(v)
  }
  return out
}

// ── 向后兼容：statementInputs 仍从 types 导出（parser 内部用）， ──
// ── 但宿主面不再有 inputs 字段，用 positional 中 isHostVarRef 筛选 ──
//
// 如需从 StatementSummary 获取等价 inputs：
//   import { isHostVarRef } from '@faicad/faijs'
//   const inputs = summary.positional.filter(isHostVarRef).map(p => p.name)
