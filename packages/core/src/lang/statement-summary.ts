/**
 * statement-summary — 语句平铺摘要（宿主展示/编排用，非 IR 类型）
 *
 * 设计文档：3d_editor docs/plans/2026-08-28-ir-strip-source-code-generation-plan.md §4.2
 *
 * `analyzeCode(code)` 是宿主消费语句信息的唯一形态（IR 剥离后宿主禁止
 * import ScriptIR/StatementIR）。摘要只含展示/编排所需的标量字段：
 * Timeline 一行一节点、场景树分组推导、FeatureTree 识别、编辑回填定位。
 *
 * 实现直接复用 parser 输出做投影，不引入新解析逻辑（阶段 0 约束）。
 */

import type { StmtId, PartName } from '../identity'
import { parseScript } from './parser'

export interface StatementSummary {
  /** 语句 id（sN，parser 顺序分配） */
  id: StmtId
  /** 调用名（<ns>.<callee> 或成员方法名） */
  callee: string
  /** 调用命名空间（F2：`mech.makeHeadstock(...)` → 'mech'；缺省 cad 时为 undefined） */
  namespace?: string
  /** 命名空间对应的包名（F2：由顶层 import specifier 推导；cad 时为 undefined）。
   *  timeline「带包名」标识 / 宿主 getFeatureByOp(packageName, op) 的依据。 */
  packageName?: string
  /** 成员方法调用接收者变量（asm1.do_assemble() → 'asm1'） */
  receiver?: PartName
  /** 位置输入变量名 */
  inputs: PartName[]
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
    ...(s.namespace !== undefined
      ? { namespace: s.namespace, ...(nsToPkg.get(s.namespace) !== undefined ? { packageName: nsToPkg.get(s.namespace) } : {}) }
      : {}),
    ...(s.receiver !== undefined ? { receiver: s.receiver } : {}),
    inputs: [...s.inputs],
    outputs: [...s.outputs],
    ...(s.outputKeys !== undefined ? { outputKeys: [...s.outputKeys] } : {}),
    ...(s.refs !== undefined ? { refs: [...s.refs] } : {}),
    hasAssignment: s.hasAssignment ?? false,
    hasComputedArgs: s.hasComputedArgs ?? false,
    line: statementLines[i] ?? 0,
  }))
}
