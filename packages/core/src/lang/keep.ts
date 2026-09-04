/**
 * keep — 统一内外 keep 机制的语义集中点（L0 零依赖）
 *
 * 设计文档：docs/plans/2026-08-28-keep-syntax-design.md §2 / §6 / §7
 *
 * keep 机制的两面：
 * - 调用点声明：`cad.op(input, { keep: [a, b], keepHidden: true })`（UI / AI / 用户）
 * - 函数体声明：`exec.keep(...shapes)` / `exec.keepHidden(...shapes)`（库作者）
 *
 * 优先级：调用点 > 函数体（resolveKeep 先铺函数体声明，再用调用点覆盖写入）。
 *
 * 本文件是 keep 语义的唯一集中点：parseUserKeep / withoutKeepDirectives /
 * resolveKeep / validateKeepDirectives。消费方：compile（发射剥离）、
 * module-executor（statementKey）、terminal-dag（消费判定）、runtime.check（校验）。
 *
 * L0 边界：仅依赖 ./types 与 ../identity，零运行时依赖。
 */

import type { ArgIR, CallRefIR, StatementIR, VarRefIR, ExprIR } from './types'
import { isVarRef, isCallRef, isExprRef, statementInputs } from './types'
import { asPartName, type PartName } from '../identity'

// ── 数据结构（设计契约 §6） ──

/** 函数体 `exec.keep` / `exec.keepHidden` 的运行时登记记录（ModuleExecutor 持有）。 */
export interface InternalKeepRecord {
  /** 被声明保留的变量名集合 */
  kept: Set<PartName>
  /** kept 变量的 hidden 状态（未列出的 kept 变量 = 可见） */
  hidden: Map<PartName, boolean>
}

/** keep 合并结果（terminal-dag 消费判定 + hidden 计算）。 */
export interface KeepResolution {
  kept: Set<PartName>
  /** 仅对 kept 中的变量有条目；未列出者 = 可见 */
  hidden: Map<PartName, boolean>
}

/** 调用点 keep 指令解析结果。 */
export interface UserKeep {
  targets: PartName[]
  /** 逐条目 hidden（{shape, hidden:true} 形态） */
  hidden: Map<PartName, boolean>
  /** 语句级 hidden 默认（keepHidden: true），默认 false */
  statementDefault: boolean
}

// ── 剥离 ──

/**
 * 剥离调用点 keep 指令（`keep` / `keepHidden` 两键）。
 *
 * 编译发射与 statementKey 必须剥离（设计 §7.1/§7.2）：keep 透传给库函数会
 * 挤占 params 槽 / 被当 Shape 传入（union/split 的 `...rest`）。
 */
/**
 * Strip the call-site keep directives (`keep` / `keepHidden` keys). Both
 * compile emission and statement-key computation must strip them (design
 * §7.1/§7.2): passing keep through would crowd the params slot or be treated as
 * a Shape argument (union/split `...rest`).
 * @param args - the statement's args object, or undefined.
 * @returns the args with the keep and keepHidden keys removed.
 */
export function withoutKeepDirectives(
  args: Record<string, ArgIR> | undefined,
): Record<string, ArgIR> {
  if (!args) return {}
  const { keep: _keep, keepHidden: _keepHidden, ...rest } = args
  return rest
}

/** 判定 ArgIR 是否为"纯对象"位置实参（非 IR 变体、非数组的普通对象）。 */
function isPlainObjectArg(arg: ArgIR): boolean {
  return (
    arg !== null &&
    typeof arg === 'object' &&
    !Array.isArray(arg) &&
    !isVarRef(arg) &&
    !isCallRef(arg) &&
    !isExprRef(arg) &&
    !('$param' in (arg as object))
  )
}

/**
 * 剥离位置实参槽中的 keep 指令（true-JS-subset 方案 §4.1）：keep/keepHidden 键
 * 存在于尾随纯对象位置实参（选项槽）中，发射/序列化前从该对象剥离。
 * 与 withoutKeepDirectives 同语义，只是载体从 args 记录变为 positional 尾随对象。
 * @param positional - the statement's positional argument slot.
 * @returns a copy of the positional slot with keep/keepHidden removed from the trailing plain object.
 */
export function withoutKeepDirectivesFromPositional(positional: ArgIR[]): ArgIR[] {
  const last = positional[positional.length - 1]
  if (!isPlainObjectArg(last)) return positional
  const obj = last as unknown as Record<string, ArgIR>
  const stripped = Object.fromEntries(
    Object.entries(obj).filter(([k]) => k !== 'keep' && k !== 'keepHidden'),
  )
  return [...positional.slice(0, -1), stripped as unknown as ArgIR]
}

// ── 解析 ──

/**
 * 解析单条 keep 条目 → { target, hidden }；形态非法返回 undefined（validate 负责报错）。
 * hidden 为三态：undefined = 未指定（交由语句级 keepHidden 默认）；true/false = 显式指定。
 */
function parseKeepEntry(entry: unknown): { target: PartName; hidden?: boolean } | undefined {
  if (typeof entry === 'string') {
    return { target: asPartName(entry) }
  }
  if (isVarRef(entry as ArgIR)) {
    return { target: asPartName((entry as VarRefIR).$ref) }
  }
  if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
    const obj = entry as Record<string, unknown>
    const shape = obj.shape
    if (typeof shape === 'string') {
      return { target: asPartName(shape), hidden: obj.hidden === true }
    }
    if (shape !== null && typeof shape === 'object' && isVarRef(shape as ArgIR)) {
      return { target: asPartName((shape as VarRefIR).$ref), hidden: obj.hidden === true }
    }
  }
  return undefined
}

/**
 * 解析调用点 keep / keepHidden 指令（IR 形态 → 目标与 hidden）。
 *
 * 两种条目形态等价（设计 §2.3）：标识符 `keep:[a,b]`（parser 产出 VarRefIR）
 * 与字符串字面量 `keep:['a']`（parser 产出 string）。
 * hidden 三态：仅 `{shape, hidden}` 显式条目写入；普通条目不写
 * （hidden 由语句级 keepHidden 兜底，设计 §2.4 `?? statementDefault`）。
 */
/**
 * Parse the call-site keep / keepHidden directives (IR shape into targets and
 * hidden states). Identifier and string-literal entry forms are equivalent;
 * hidden is three-valued, with only explicit `{shape, hidden}` entries written.
 * @param stmt - the statement whose args hold the keep directives.
 * @returns the parsed user keep targets and hidden defaults.
 */
export function parseUserKeep(stmt: StatementIR): UserKeep {
  const targets: PartName[] = []
  const hidden = new Map<PartName, boolean>()
  let statementDefault = false

  const args = stmt.args ?? {}
  const keepArg = args.keep
  if (Array.isArray(keepArg)) {
    for (const entry of keepArg) {
      const parsed = parseKeepEntry(entry)
      if (!parsed) continue
      targets.push(parsed.target)
      if (parsed.hidden !== undefined) hidden.set(parsed.target, parsed.hidden)
    }
  }

  const keepHiddenArg = args.keepHidden
  if (typeof keepHiddenArg === 'boolean') statementDefault = keepHiddenArg

  return { targets, hidden, statementDefault }
}

// ── 合并（设计契约 §2.4） ──

/**
 * 合并函数体声明与调用点声明。
 *
 * 优先级体现为两步顺序：先铺函数体声明（internal），再用调用点声明覆盖写入。
 * 调用点条目的 hidden = 逐条目 hidden ?? statementDefault（D1：默认可见）。
 */
/**
 * Merge function-body declarations with call-site declarations. Precedence is a
 * two-step order: function-body declarations (internal) are laid down first,
 * then call-site declarations overwrite them.
 * @param stmt - the statement whose call-site keep directives to merge.
 * @param internal - the function-body keep registration, if any.
 * @returns the merged keep resolution with kept variables and hidden states.
 */
export function resolveKeep(
  stmt: StatementIR,
  internal?: InternalKeepRecord,
): KeepResolution {
  const kept = new Set(internal?.kept ?? [])
  const hidden = new Map(internal?.hidden ?? [])

  const user = parseUserKeep(stmt)
  for (const v of user.targets) {
    kept.add(v)
    hidden.set(v, user.hidden.get(v) ?? user.statementDefault)
  }

  return { kept, hidden }
}

// ── 静态校验（设计 §7.4，check 用，纯静态、第三方同样适用） ──

/**
 * 校验语句的 keep / keepHidden 指令（纯静态，不依赖第三方签名）。
 * 返回错误消息列表（空 = 合法）：
 * - `keep` 必须是数组；条目必须是变量引用（字符串或标识符）或 `{shape, hidden}` 对象
 * - 引用目标必须是本语句 inputs 之一，或出现在 args 中（VarRefIR）
 * - `keepHidden` 必须是 boolean
 */
/**
 * Validate a statement's keep / keepHidden directives (purely static, does not
 * depend on third-party signatures). Returns a list of error messages, empty
 * when the directives are legal.
 * @param stmt - the statement whose keep directives to validate.
 * @returns an array of error messages, empty when valid.
 */
export function validateKeepDirectives(stmt: StatementIR): string[] {
  const errors: string[] = []
  const args = stmt.args ?? {}

  if ('keep' in args) {
    const keepArg = args.keep
    if (!Array.isArray(keepArg)) {
      errors.push(`statement "${stmt.id}": keep must be an array of variable references`)
    } else {
      // 合法引用目标：positional 中的 VarRefIR/ExprIR refs + args（除 keep/keepHidden 两键）中的引用
      const referable = new Set<string>(statementInputs(stmt).map(String))
      const scan = (value: unknown): void => {
        if (value === null || typeof value !== 'object') return
        if (isVarRef(value as ArgIR)) {
          referable.add(String((value as VarRefIR).$ref))
          return
        }
        if (isExprRef(value as ArgIR)) {
          // ExprIR refs（引用变量）也是合法 keep 目标；params 是参数（自身是输入）无需加入
          for (const r of (value as ExprIR).$expr.refs) referable.add(String(r))
          return
        }
        if (isCallRef(value as CallRefIR)) {
          for (const a of (value as CallRefIR).$call.args) scan(a)
          return
        }
        if (Array.isArray(value)) {
          for (const item of value) scan(item)
          return
        }
        for (const v of Object.values(value as Record<string, unknown>)) scan(v)
      }
      for (const parg of stmt.positional) scan(parg)
      for (const [k, v] of Object.entries(args)) {
        if (k === 'keep' || k === 'keepHidden') continue
        scan(v)
      }
      for (const entry of keepArg) {
        const parsed = parseKeepEntry(entry)
        if (!parsed) {
          errors.push(
            `statement "${stmt.id}": keep entries must be variable references or {shape, hidden} objects`,
          )
          continue
        }
        if (!referable.has(String(parsed.target))) {
          errors.push(
            `statement "${stmt.id}": keep target "${String(parsed.target)}" is not an input or argument variable of this statement`,
          )
        }
      }
    }
  }

  if ('keepHidden' in args && typeof args.keepHidden !== 'boolean') {
    errors.push(`statement "${stmt.id}": keepHidden must be a boolean`)
  }

  return errors
}
