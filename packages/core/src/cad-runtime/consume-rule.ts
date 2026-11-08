/**
 * consume-rule — 语言级消费规则（R-A/R-B/R-C 的判定与账本）
 *
 * 规则（方案见 3d_editor docs/plans/2026-11-08-stream-preview-diff-frames-design.md §9）：
 * - R-A 消费点：变量 v 的最后写者之后，第一条 `lineConsumes` 为真的语句；
 * - R-B 禁止再引用：消费点之后再读 v = 语言错误 `E_USE_AFTER_CONSUME`；
 * - R-C 消费即释放：消费语句执行完，v 的派生缓存/句柄/ctx 键当场回收
 *   （释放动作不在本文件，见 runtime.releaseConsumedAt）。
 *
 * 本文件只做**判定与账本**，不碰 ctx / 内核：
 * - `collectCtxReads` 从**变换后**的单元体里抽 `__ctx.<name>` 读引用——
 *   这是"真正会执行的代码"，比再解析一遍源码更接近事实；
 * - `ConsumeTracker` 记"哪个变量在第几行被消费"。写者出现即开新世代
 *   （tombstone 清除）：`a = a.sub(b)` 之后 a 是新值，可以继续读。
 *
 * 为什么消费点 = 最后一次合法引用：规则一旦成立，释放点就不需要数据流分析/
 * 引用计数/别名追踪，`lineConsumes` 的判定口径（live-shapes.ts）成为唯一真源。
 */

import type { StatementSummary } from '../lang/statement-summary'
import type { KeepView } from './live-shapes'

/** 规则档位（缺省 warn：只收集不阻断，便于先扫语料再切 error）。 */
export type ConsumeRuleMode = 'off' | 'warn' | 'error'

/** 一条"消费后再引用"违规（三行号 + 变量名，端侧据此给 i18n 文案）。 */
export interface ConsumeViolation {
  /** 被违规引用的变量名 */
  name: string
  /** 该变量当前世代的生产行（宿主注入/import 绑定为 0） */
  producerLine: number
  /** 消费该变量（当前世代）的语句行 */
  consumeLine: number
  /** 违规引用所在行 */
  useLine: number
}

/** DirectExecutor 的消费规则入参（runtime 按 activeMeta 装配）。 */
export interface ConsumeRuleOptions {
  /** 档位（'off' 时调用方不应传本对象） */
  mode: Exclude<ConsumeRuleMode, 'off'>
  /** 本场景全部语句摘要（消费判定用；块/函数声明单元不在其中） */
  lines: StatementSummary[]
  /** keep 视图（R1 豁免的唯一来源） */
  keep: KeepView
  /** warn 档收集回调（error 档不调用——直接抛 ParseError） */
  onViolation?: (v: ConsumeViolation) => void
}

/** 变换后单元体里的 `__ctx.<name>` 引用（读 + 写都匹配）。 */
const CTX_REF_RE = /__ctx\.([A-Za-z_$][\w$]*)/g
/** 写位置 `__ctx.<name> =`（排除 `==` / `=>` 等比较）。 */
const CTX_WRITE_RE = /__ctx\.([A-Za-z_$][\w$]*)\s*=(?!=|>)/g

/**
 * 消费判定口径（**唯一**，2026-11-08 用户规定）：
 *
 * > `lineConsumes` 返回 true 表示该语句消费 v —— **v 就必须立刻释放，且不准再引用**。
 *
 * 因此本规则**不做** op 语义分类：布尔运算、`cad.assembly`（成员）、
 * `sheet.solidOf`、`cad.fai_drill` 等一视同仁，`lineConsumes` 判真即消费。
 * 谁输入不被销毁却又要继续用，正确写法是 `keep()`（唯一豁免路径），
 * 而不是在运行时维护"哪些 op 保留实参"的白名单。
 *
 * 这是"消费点 = 最后一次合法引用"的严格版本：释放点唯一确定，无需 last-use 分析。
 */

/**
 * 抽取单元体里的 `__ctx.<name>` **读**引用集合（写位置的赋值目标是写，不算读）。
 *
 * 口径边界：本机函数体经 `let { a, b } = __ctx` 整体注入，函数体内的读不以
 * `__ctx.<name>` 形式出现——首版不覆盖该路径（见方案 §9.9 的已知缺口）。
 *
 * @param body - DirectExecutor 变换后的单元体源码
 * @returns 读引用的变量名集合
 */
export function collectCtxReads(body: string): Set<string> {
  const reads = new Set<string>()
  if (!body) return reads
  // 先抹掉"纯写"的赋值目标（`__ctx.x =` → `__ctx.__W__`），再扫剩余 `__ctx.<name>`：
  // 这样 `a = a.subtract(b)`（自赋值）里的 a 仍算读，`a = <expr>`（纯覆盖）里的 a 不算读。
  const stripped = body.replace(/__ctx\.([A-Za-z_$][\w$]*)\s*=(?!=|>)/g, '__ctx.__W__')
  CTX_REF_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CTX_REF_RE.exec(stripped)) !== null) {
    if (m[1] !== '__W__') reads.add(m[1])
  }
  return reads
}

/**
 * 抽取单元体里的 `__ctx.<name> =` 写目标集合。
 * @param body - 变换后的单元体源码
 * @returns 写目标变量名集合
 */
export function collectCtxWrites(body: string): Set<string> {
  const writes = new Set<string>()
  if (!body) return writes
  CTX_WRITE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CTX_WRITE_RE.exec(body)) !== null) writes.add(m[1])
  return writes
}

/**
 * 违规的英文文案（ParseError message 统一英文；端侧用 i18n 键翻译，
 * 不在这里拼中文——项目红线：toast/文案必须走 i18n）。
 * @param v - 违规记录
 * @returns 单行诊断文案（含三行号与 keep 建议）
 */
export function describeViolation(v: ConsumeViolation): string {
  return (
    `"${v.name}" was already consumed at line ${v.consumeLine} ` +
    `(produced at line ${v.producerLine}), so it is released there and must not be ` +
    `referenced again (line ${v.useLine}); declare "${v.name}.keep()" if you need it later`
  )
}

/**
 * 消费账本：记录每个变量当前世代是否已被消费（tombstone）。
 *
 * 世代语义：任何写（`commitWrite`）都开新世代并清除 tombstone——`a = a.sub(b)`
 * 执行后 a 是新值，可以继续读。这与 `computeLiveShapes` 的"最后写者"口径一致。
 */
export class ConsumeTracker {
  /** name → 消费行（当前世代已被消费） */
  private consumedAt = new Map<string, number>()
  /** name → 生产行（当前世代最后写者；诊断用） */
  private producerAt = new Map<string, number>()
  private found: ConsumeViolation[] = []

  /** 清空全部账本（全量重跑 / dispose）。 */
  reset(): void {
    this.consumedAt.clear()
    this.producerAt.clear()
    this.found = []
  }

  /** 已收集的违规（warn 档回传给宿主 / 单测断言用）。 */
  get violations(): readonly ConsumeViolation[] {
    return this.found
  }

  /**
   * 该变量当前世代是否已被消费。
   * @param name - 变量名（ctx 键）
   * @returns 已消费返回 true
   */
  isConsumed(name: string): boolean {
    return this.consumedAt.has(name)
  }

  /**
   * 单元执行前的 R-B 检查：读到已消费变量 → 违规。
   *
   * 注意调用时机必须是**执行前**——本单元自己的读是输入，不是违规；
   * 消费由本单元产生的，走 `markConsumed`（执行后）。
   *
   * @param reads - 本单元读引用集合（`collectCtxReads`）
   * @param useLine - 本单元行号
   * @returns 本次新发现的违规（同时并入 `violations`）
   */
  preCheck(reads: Set<string>, useLine: number): ConsumeViolation[] {
    const fresh: ConsumeViolation[] = []
    for (const name of reads) {
      const consumeLine = this.consumedAt.get(name)
      if (consumeLine === undefined) continue
      const v: ConsumeViolation = {
        name,
        producerLine: this.producerAt.get(name) ?? 0,
        consumeLine,
        useLine,
      }
      fresh.push(v)
      this.found.push(v)
    }
    return fresh
  }

  /**
   * 登记一次写：开新世代（tombstone 清除）。
   * @param name - 被写入的变量名
   * @param line - 写入行
   */
  commitWrite(name: string, line: number): void {
    this.producerAt.set(name, line)
    this.consumedAt.delete(name)
  }

  /**
   * 登记一次消费（R-A）：语句执行完、其写入落定后调用。
   * 已有 tombstone 时保留首次消费行（同世代重复消费不应改写行号）。
   * @param name - 被消费的变量名
   * @param line - 消费语句行
   */
  markConsumed(name: string, line: number): void {
    if (!this.consumedAt.has(name)) this.consumedAt.set(name, line)
  }
}
