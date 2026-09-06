/**
 * statement-summary — 语句平铺摘要（宿主展示/编排用，非 IR 类型）
 *
 * See docs/syntax-design.md §3 (statement model ↔ StatementSummary mapping).
 *
 * `analyzeCode(code)` 是宿主消费语句信息的唯一形态（IR 剥离后宿主禁止
 * import ScriptIR/StatementIR）。摘要只含展示/编排所需的标量字段：
 * Timeline 一行一节点、场景树分组推导、FeatureTree 识别、编辑回填定位。
 *
 * 无 IR 双通道方案（2026-09-06）后实现换 MetadataExtractor：lines 面直接
 * 产出 StatementSummary 原样（无投影层），与现状 parseScript 投影逐字相等
 * （A-16 对拍），仅 id = `'s' + lineNo` 语义变化（append 场景稳定，宿主按
 * 字符串使用不破裂）。
 */

import type { StmtId, PartName } from '../identity'
import type { HostArg } from './host-arg'
import { extractMetadata } from './metadata-extractor'

/**
 * A flat scalar projection of one statement for host display and orchestration
 * (a non-IR type). Timeline rows, scene tree grouping, feature-tree
 * recognition, and edit-backfill navigation all consume this summary.
 */
export interface StatementSummary {
  /** 语句 id（'s' + lineNo；append 场景行号稳定） */
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
 *
 * 实现：MetadataExtractor.lines 直接产出（无投影层），与现状 parseScript
 * 投影逐字相等（A-16 对拍），id 语义 = `'s' + lineNo`。
 *
 * @param code - the faijs source text to parse and summarize.
 * @returns a flat statement summary for every parsed statement.
 * @throws ParseError — 含行号
 */
export function analyzeCode(code: string): StatementSummary[] {
  return extractMetadata(code).lines
}
