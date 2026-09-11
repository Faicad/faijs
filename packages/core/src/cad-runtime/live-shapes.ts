/**
 * live-shapes — 无 IR 存活判定（运行时终端 = 最后写者 + 下游无独占消费）
 *
 * 方案：docs/plans/2026-09-06-no-ir-dual-channel-runtime.md §4.4（D5 / P3）
 *
 * 取消 IR 前后，活跃性判断的算法不变，变的是两个输入源：
 * - 语句序列：`metadata.lines`（MetadataExtractor → StatementSummary[]，与现状
 *   analyzeCode 逐字相等，A-16 锁定）；
 * - 行内 keep 判定：`metadata.keep` 表（提取器已把 args 的 keep/keepHidden 键结构化）
 *   + `KeepRegistry`（DirectExecutor 执行期登记，替代 ModuleExecutor.internalKeep）。
 *
 * 候选集合 = ctx 中 shape/compound 键（与现状 allShapeVarNames 同源）；
 * lastProducer 由行级 outputs 反查（ctx 值天然是最后写者）；
 * 消费判定 = keep 驱动 consumes（C0/C3/C5 短路）；
 * 自由 JS 块做词法级引用扫描。
 *
 * 产出 TerminalShape[]，与已删除的 computeLeafTerminals 逐字段兼容（A-14 对拍）。
 */

import type { StatementSummary } from '../lang/statement-summary'
import type { UiMetadata, KeepEntry } from '../lang/metadata-extractor'
import type { PartName } from '../identity'
import { asPartName } from '../identity'
import type { HostArg } from '../lang/host-arg'
import { isHostVarRef, isHostCallRef, isHostExprRef } from '../lang/host-arg'
import type { TerminalShape } from '../lang/types'

/** 函数体 keep 登记（DirectExecutor 执行期登记；与 InternalKeepRecord 同构）。 */
export interface KeepRegistration {
  kept: Set<PartName>
  hidden: Map<PartName, boolean>
}

/** keep 来源视图：行内调用点（metadata.keep 表）+ 函数体执行期登记（KeepRegistry）。 */
export interface KeepView {
  /** 行内调用点 keep（lineNo → 条目；extractor 已归一 hidden） */
  lineEntries(lineNo: number): KeepEntry[] | undefined
  /** 函数体 exec.keep 登记（lineNo → 登记；DirectExecutor 提供） */
  functionBody(lineNo: number): KeepRegistration | undefined
}

/** computeLiveShapes 的输入（与运行时视图解耦：值/名字由调用方提供）。 */
export interface LiveShapesInput {
  lines: StatementSummary[]
  blocks: UiMetadata['blocks']
  keep: KeepView
  /** 候选 shape/compound 变量名（ctx 键 ∩ 结构判定；与 allShapeVarNames 同源） */
  shapeVarNames: Set<PartName>
  /** 块单元产出：shape 名 → 块起始行（DirectExecutor 执行块前后 ctx diff 登记） */
  blockOutputs?: Map<string, number>
  /**
   * 原地写回登记（P25 §3.7.4 规则 2）：裸调用行 → 写回目标变量名。
   * DirectExecutor 执行期登记（修改类裸调用 `fai_drill(part0)` 把结果写回首参）；
   * lastProducer 叠加时把该变量的最后写者锚到裸调用行——写回行之前的旧消费
   * 不误伤写回后的新值（producer 精确化，见方案 §3.7.4）。
   */
  inplaceWrites?: Map<number, string>
  /** 显式 return 终端（metadata.terminalShapes，非空优先——与现状一致） */
  explicitTerminals?: TerminalShape[]
}

/**
 * 判定 statement 是否消费变量 v（keep 驱动，C0 → C3 → C5 短路）。
 * 输入是 StatementSummary（HostArg 引用形态）。
 * @param line - 消费检查目标语句（行级摘要）。
 * @param v - 被检查的候选 shape/compound 变量。
 * @param keep - keep 来源视图（行内 + 函数体登记）。
 * @param shapeVarNames - 存活候选名集合（C3 非几何输出判定用）。
 * @returns true 表示该语句消费 v（v 不得作为终端存活）。
 */
export function lineConsumes(
  line: StatementSummary,
  v: PartName,
  keep: KeepView,
  shapeVarNames: Set<PartName>,
): boolean {
  // C0/C1：keep 声明胜出——被声明的变量不被本语句消费
  const fnKeep = keep.functionBody(line.line)
  if (fnKeep && fnKeep.kept.has(v)) return false
  const lineKeep = keep.lineEntries(line.line)
  if (lineKeep?.some((e) => e.target === String(v))) return false

  // C4（P25 §3.7 规则 1）：无赋值裸调用默认不消费——无论自赋值还是只读，
  // 没有赋值绑定的语句不构成对输入的消费。覆盖 projectView(part)/fai_drill(part0)/
  // volume(part) 等裸调用；修改类裸调用的写回经 inplaceWrites 登记（producer 精确化）。
  if (!line.hasAssignment) return false

  // C3：本语句有赋值且所有输出都是非几何 → 纯数据/测量/查询语句，不消费任何输入
  if (
    line.hasAssignment &&
    line.outputs.length > 0 &&
    shapeVarNames.size > 0 &&
    line.outputs.every((o) => !shapeVarNames.has(o))
  ) {
    return false
  }

  // C5：默认消费——positional 顶层 var-ref / expr-ref refs；嵌套 call-ref 内只读。
  // receiver 不消费（成员方法调用对 compound 的消费经 C5 扫描其 args）。
  let consumed = false
  const scan = (value: HostArg, inCallRef: boolean): void => {
    if (consumed) return
    if (value === null || typeof value !== 'object') return
    if (isHostVarRef(value)) {
      if (value.name !== String(v)) return
      if (inCallRef) return // 嵌套调用内 = 只读查询
      consumed = true
      return
    }
    if (isHostExprRef(value)) {
      if (inCallRef) return
      if (value.refs.includes(String(v))) consumed = true
      return
    }
    if (isHostCallRef(value)) {
      for (const a of value.args) scan(a, true)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) scan(item as HostArg, inCallRef)
      return
    }
    for (const vv of Object.values(value as Record<string, unknown>)) scan(vv as HostArg, inCallRef)
  }
  for (const parg of line.positional ?? []) scan(parg, false)
  for (const vv of Object.values(line.args ?? {})) scan(vv, false)
  return consumed
}

/**
 * 块单元词法级引用扫描（§4.3）：块源码文本中出现外部 shape 名 → 保守判为消费。
 * 只扫 range.start 行号 > producerIdx 的块（producer 之前的块不可能消费新值）。
 * @param blocks - 块元数据数组（UiMetadata.blocks）。
 * @param v - 被消费的变量名。
 * @param producerLine - 最后写者的行号。
 * @returns true 如果有 producer 之后的块词法消费了该变量。
 */
export function blockConsumes(
  blocks: UiMetadata['blocks'],
  v: string,
  producerLine: number,
): boolean {
  for (const b of blocks) {
    if (b.lineNo <= producerLine) continue
    if (wordBoundaryMatch(b.source, v)) return true
  }
  return false
}

function wordBoundaryMatch(text: string, name: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${esc}\\b`).test(text)
}

/**
 * 存活判定主算法（§4.4）：候选 = shapeVarNames（ctx 键 ∩ 结构判定）；
 * lastProducer = 单次正向遍历 + Map 覆盖写；逐个候选查 producer 之后是否有语句消费。
 *
 * hidden（D2）：最后一次保留声明胜出——函数体登记先铺，行内调用点按行号序覆盖。
 *
 * @param input - 存活判定输入（lines/blocks/keep 视图/shapeVarNames/块产出/显式终端）。
 * @returns TerminalShape[]（{ id } ∪ hidden），与原 computeLeafTerminals 形态兼容。
 */
export function computeLiveShapes(input: LiveShapesInput): TerminalShape[] {
  const { lines, blocks, keep, shapeVarNames, blockOutputs, inplaceWrites } = input

  // 显式 return 终端优先（与现状一致）
  const explicit = input.explicitTerminals ?? []
  if (explicit.length > 0) return explicit

  // 0. hidden：最后一次保留声明胜出
  //    先铺函数体登记（KeepView.functionBody），再按行号顺序用行级调用点覆盖
  //    （Map 按插入序 = 行号序 → 调用点 > 函数体）。
  const hiddenOf = new Map<PartName, boolean>()
  for (const line of lines) {
    const fn = keep.functionBody(line.line)
    if (fn) {
      for (const v of fn.kept) {
        hiddenOf.set(v, fn.hidden.get(v) ?? false)
      }
    }
  }
  for (const line of lines) {
    const entries = keep.lineEntries(line.line)
    if (entries) {
      for (const e of entries) {
        hiddenOf.set(asPartName(e.target), e.hidden)
      }
    }
  }

  // 1. lastProducer：单次正向遍历 + Map 覆盖写
  const lastProducer = new Map<string, number>()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.hasAssignment) continue
    for (const out of line.outputs) lastProducer.set(String(out), i)
  }
  // P25 §3.7.4：原地写回登记（DirectExecutor 执行期；行号 → 写回变量名）。
  // 修改类裸调用（fai_drill(part0) 等）把结果写回首参——把该变量的最后写者锚到
  // 裸调用行（producer 精确化）：写回行之前的旧消费只作用于旧值，不误伤新值。
  if (inplaceWrites && inplaceWrites.size > 0) {
    const lineIdxOf = new Map<number, number>()
    lines.forEach((l, i) => {
      if (!lineIdxOf.has(l.line)) lineIdxOf.set(l.line, i)
    })
    for (const [lineNo, name] of inplaceWrites) {
      const idx = lineIdxOf.get(lineNo)
      if (idx !== undefined) lastProducer.set(name, idx)
    }
  }

  // 2. 逐个候选名判定
  const terminals: TerminalShape[] = []
  const seen = new Set<string>()
  for (const partName of shapeVarNames) {
    if (seen.has(String(partName))) continue
    seen.add(String(partName))
    const s = String(partName)

    // producerIdx：取 lines 中最后写者 与 blockOutputs（块内写者）的较大者。
    // 块在 lines 之后执行时，块是最后写者——用块的行号作锚点。
    const lineIdx = lastProducer.get(s)
    const blockIdx = blockOutputs?.get(s) !== undefined
      ? blockIdxOf(lines, blockOutputs.get(s)!)
      : undefined
    let producerIdx: number | undefined
    if (lineIdx !== undefined && blockIdx !== undefined) {
      producerIdx = blockIdx > lineIdx ? blockIdx : lineIdx
    } else {
      producerIdx = lineIdx ?? blockIdx
    }
    if (producerIdx === undefined) {
      // 无生产者（如宿主手工注入 / 跨文件引用）→ 直接终端
      terminals.push(makeTerminal(partName, hiddenOf))
      continue
    }

    let consumed = false
    for (let i = producerIdx + 1; i < lines.length; i++) {
      if (lineConsumes(lines[i], partName, keep, shapeVarNames)) {
        consumed = true
        break
      }
    }
    if (!consumed && blocks.length > 0) {
      if (blockConsumes(blocks, s, producerLineOf(lines, producerIdx, blockOutputs, s))) consumed = true
    }
    if (!consumed) terminals.push(makeTerminal(partName, hiddenOf))
  }
  return terminals
}

/** producer 行号（lines 下标 → 行号；块产出用块起始行）。
 * 当 blockIdx == lines.length（块行号 > 所有 lines 行号）时，返回块行号本身
 * （从 blockOutputs 反查），确保 blockConsumes 跳过该块（producer 块自身的引用
 * 是对旧值的消费，不应取消新值的终端资格）。 */
function producerLineOf(lines: StatementSummary[], idx: number, blockOutputs?: Map<string, number>, name?: string): number {
  if (idx >= lines.length && blockOutputs && name !== undefined) {
    const blockLine = blockOutputs.get(name)
    if (blockLine !== undefined) return blockLine
  }
  return lines[idx]?.line ?? 0
}

/** 块起始行 → lines 中第一个 >= 该行的下标（块产出候选的锚点）。 */
function blockIdxOf(lines: StatementSummary[], blockLine: number): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].line >= blockLine) return i
  }
  return lines.length
}

/** 组装终端条目（hidden 缺省 undefined → 可见）。 */
function makeTerminal(id: PartName, hiddenOf: Map<PartName, boolean>): TerminalShape {
  const hidden = hiddenOf.get(id)
  return hidden ? { id, hidden: true } : { id }
}

// ── 便捷构造（测试 / runtime 装配用） ──

/**
 * 空 keep 视图（无行内 keep、无函数体登记）。
 * @returns 恒返回 undefined 的 KeepView。
 */
export function emptyKeepView(): KeepView {
  return { lineEntries: () => undefined, functionBody: () => undefined }
}

/**
 * 由 UiMetadata.keep 表构造 KeepView（行内条目；函数体登记由调用方补充）。
 * @param meta - 含 keep 表的元数据（行号 → 行内 keep 条目）。
 * @returns KeepView（lineEntries 查 meta.keep；functionBody 恒空）。
 */
export function keepViewFromMetadata(meta: Pick<UiMetadata, 'keep'>): KeepView {
  return {
    lineEntries: (lineNo) => meta.keep.get(lineNo),
    functionBody: () => undefined,
  }
}
