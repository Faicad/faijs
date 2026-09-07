/**
 * host-arg — 宿主友好位置参数类型（IR 屏蔽层）
 *
 * 宿主（3d_editor 等）只接触 `HostArg`，不 import 任何 IR 类型。
 *
 * IR→Host 方向（`argIRToHost`）：只认 `$` 前缀标记键（`$ref`/`$param`/`$call`/`$expr`），
 * 不认 `kind`，因此 parser 从 `.fai.js` 源码产生的字面量对象不会被误判。
 *
 * Host→IR 方向（`hostArgToIR`）：按 `kind` 字段 + 形状守卫判定。
 *
 * **保留字规则（确定性裁决）**：普通对象若 `kind` 字段的值 ∈ `HOST_REF_KINDS`
 * 且完整匹配对应变体形状，一律按引用处理。即：字面量参数对象中禁止出现
 * 这 4 个 `kind` 值。此约束写入 JSDoc 与 `docs/api-contract.md`。
 *
 * 注意：`HostRef` 在结构上是 `JsonValue` 的子类型，因此 `HostArg` 在 TS 层面
 * 约等于 `JsonValue`，判别依赖运行时守卫而非类型系统——这是有意为之。
 */

import type { JsonValue } from './types'

// ── 内联 IR 守卫（原 types.ts 的 IR 类型已删除，守卫逻辑内联于此） ──

/** IR marker: variable reference `{$ref: string}` (legacy IR form, still recognized by argIRToHost). */
interface IRVarRef { $ref: string }
/** IR marker: parameter reference `{$param: string}`. */
interface IRParamRef { $param: string }
/** IR marker: nested call `{$call: { callee, args, namespace? }}`. */
interface IRCallRef { $call: { callee: string; args: unknown[]; namespace?: string } }
/** IR marker: runtime expression `{$expr: { text, refs, params }}`. */
interface IRExprRef { $expr: { text: string; refs: string[]; params: string[] } }

/** Union of legacy IR marker shapes (used by argIRToHost for backward-compatible conversion). */
type ArgIR = JsonValue | IRVarRef | IRParamRef | IRCallRef | IRExprRef

function isIRVarRef(arg: unknown): arg is IRVarRef {
  return arg !== null && typeof arg === 'object' && !Array.isArray(arg) && '$ref' in arg
}
function isIRParamRef(arg: unknown): arg is IRParamRef {
  return arg !== null && typeof arg === 'object' && !Array.isArray(arg) && '$param' in arg
}
function isIRCallRef(arg: unknown): arg is IRCallRef {
  return arg !== null && typeof arg === 'object' && !Array.isArray(arg) && '$call' in arg
}
function isIRExprRef(arg: unknown): arg is IRExprRef {
  return arg !== null && typeof arg === 'object' && !Array.isArray(arg) && '$expr' in arg
}

// ── 宿主友好位置参数类型 ──

/** Variable reference: a reference to a declared shape variable (e.g. `part0`). */
export interface HostVarRef {
  kind: 'var-ref'
  name: string
}

/** Parameter reference: a reference to a script parameter (e.g. `hole_diameter`). */
export interface HostParamRef {
  kind: 'param-ref'
  name: string
}

/** Nested call reference: a `cad.<callee>(...)` or `<ns>.<callee>(...)` embedded in args. */
export interface HostCallRef {
  kind: 'call-ref'
  callee: string
  args: HostArg[]
  /** Calling namespace (e.g. `mech.helper(...)` → 'mech'; absent = 'cad'). */
  namespace?: string
}

/** Runtime expression reference: an expression that could not be statically folded. */
export interface HostExprRef {
  kind: 'expr-ref'
  text: string
  refs: string[]
  params: string[]
}

/** Union of all host-visible reference shapes. */
export type HostRef = HostVarRef | HostParamRef | HostCallRef | HostExprRef

/**
 * A host-friendly argument value: either a JSON literal or a host reference shape.
 *
 * **Discrimination relies on runtime guards** (`isHostRef` etc.), not the TS type system —
 * `HostRef` is structurally a subtype of `JsonValue`. This is intentional.
 * Literal parameter objects must not use `kind` values from `HOST_REF_KINDS`.
 */
export type HostArg = JsonValue | HostRef

/** The set of `kind` values that identify host reference shapes (reserved words). */
export const HOST_REF_KINDS = ['var-ref', 'param-ref', 'call-ref', 'expr-ref'] as const
/** The `kind` string literal type derived from {@link HOST_REF_KINDS}. */
export type HostRefKind = (typeof HOST_REF_KINDS)[number]

// ── 辅助：普通对象检测 ──

/**
 * Check whether a value is a non-null, non-array plain object.
 * @param a - the value to test.
 * @returns true when the value is a plain object (not null, not array).
 */
function isPlainObject(a: unknown): a is Record<string, unknown> {
  return a !== null && typeof a === 'object' && !Array.isArray(a)
}

/**
 * Map all values of a plain object through a transform function (shallow key copy).
 * @param obj - the plain object to map.
 * @param fn - the transform function applied to each value.
 * @returns a new object with the same keys and transformed values.
 */
function mapValues<T, U>(obj: Record<string, T>, fn: (v: T) => U): Record<string, U> {
  const out: Record<string, U> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = fn(v)
  }
  return out
}

// ── 守卫 ──

/**
 * Type guard: is the value a `HostVarRef`?
 *
 * Checks `kind === 'var-ref'` and `name: string`. This is the Host→IR direction guard.
 * @param a - the argument value to test.
 * @returns true when the value is a `HostVarRef`.
 */
export function isHostVarRef(a: HostArg): a is HostVarRef {
  return isPlainObject(a) && a.kind === 'var-ref' && typeof a.name === 'string'
}

/**
 * Type guard: is the value a `HostParamRef`?
 * @param a - the argument value to test.
 * @returns true when the value is a `HostParamRef`.
 */
export function isHostParamRef(a: HostArg): a is HostParamRef {
  return isPlainObject(a) && a.kind === 'param-ref' && typeof a.name === 'string'
}

/**
 * Type guard: is the value a `HostCallRef`?
 * @param a - the argument value to test.
 * @returns true when the value is a `HostCallRef`.
 */
export function isHostCallRef(a: HostArg): a is HostCallRef {
  return (
    isPlainObject(a) &&
    a.kind === 'call-ref' &&
    typeof a.callee === 'string' &&
    Array.isArray(a.args)
  )
}

/**
 * Type guard: is the value a `HostExprRef`?
 * @param a - the argument value to test.
 * @returns true when the value is a `HostExprRef`.
 */
export function isHostExprRef(a: HostArg): a is HostExprRef {
  return (
    isPlainObject(a) &&
    a.kind === 'expr-ref' &&
    typeof a.text === 'string' &&
    Array.isArray(a.refs) &&
    Array.isArray(a.params)
  )
}

/**
 * Type guard: is the value any host reference shape?
 * @param a - the argument value to test.
 * @returns true when the value is one of `HostVarRef`/`HostParamRef`/`HostCallRef`/`HostExprRef`.
 */
export function isHostRef(a: HostArg): a is HostRef {
  return isHostVarRef(a) || isHostParamRef(a) || isHostCallRef(a) || isHostExprRef(a)
}

// ── 递归双向转换（core 内部，不导出） ──

/**
 * Convert a legacy IR marker argument (`$`-prefixed) to a `HostArg` (host-friendly).
 *
 * Recursively transforms arrays and plain objects. Recognizes `$`-prefixed
 * marker keys only — `kind` fields are not checked in this direction.
 * @param arg - the IR argument to convert.
 * @returns the host-friendly argument.
 */
export function argIRToHost(arg: unknown): HostArg {
  if (isIRVarRef(arg)) return { kind: 'var-ref', name: arg.$ref }
  if (isIRParamRef(arg)) return { kind: 'param-ref', name: arg.$param }
  if (isIRCallRef(arg)) {
    const { callee, args, namespace } = arg.$call
    return {
      kind: 'call-ref',
      callee,
      args: args.map(argIRToHost) as HostArg[],
      ...(namespace !== undefined ? { namespace } : {}),
    }
  }
  if (isIRExprRef(arg)) {
    return {
      kind: 'expr-ref',
      text: arg.$expr.text,
      refs: [...arg.$expr.refs],
      params: [...arg.$expr.params],
    }
  }
  if (Array.isArray(arg)) return arg.map(argIRToHost) as unknown as HostArg
  if (isPlainObject(arg)) return mapValues(arg, argIRToHost) as unknown as HostArg
  return arg as HostArg
}

/**
 * Convert a `HostArg` (host-friendly) back to a legacy IR marker (`$`-prefixed).
 *
 * Uses `kind`-based guards to identify reference shapes. Literal objects
 * that don't match any reference kind are recursively transformed as plain data.
 * @param arg - the host-friendly argument.
 * @returns the IR marker argument.
 */
export function hostArgToIR(arg: HostArg): ArgIR {
  if (isHostVarRef(arg)) return { $ref: arg.name }
  if (isHostParamRef(arg)) return { $param: arg.name }
  if (isHostCallRef(arg)) {
    return {
      $call: {
        callee: arg.callee,
        args: arg.args.map(hostArgToIR) as unknown[],
        ...(arg.namespace !== undefined ? { namespace: arg.namespace } : {}),
      },
    }
  }
  if (isHostExprRef(arg)) {
    return {
      $expr: {
        text: arg.text,
        refs: [...arg.refs],
        params: [...arg.params],
      },
    }
  }
  if (Array.isArray(arg)) return arg.map(hostArgToIR) as unknown as ArgIR
  if (isPlainObject(arg)) return mapValues(arg as Record<string, HostArg>, hostArgToIR) as unknown as ArgIR
  return arg
}

// ── 导出辅助函数 ──

/**
 * Render a `HostArg` to a human-readable display string (for timeline labels, read-only fields).
 *
 * - Primitives → `String(arg)`
 * - Arrays → `[a, b, …]` (recursive)
 * - var-ref/param-ref → `name`
 * - call-ref → `callee(a, b, …)` (recursive)
 * - expr-ref → `text`
 * - Plain objects → `JSON.stringify`
 * @param arg - the host argument to display.
 * @returns a human-readable string representation.
 */
export function hostArgToDisplay(arg: HostArg): string {
  if (isHostVarRef(arg) || isHostParamRef(arg)) return arg.name
  if (isHostCallRef(arg)) {
    const inner = arg.args.map(hostArgToDisplay).join(', ')
    return `${arg.callee}(${inner})`
  }
  if (isHostExprRef(arg)) return arg.text
  if (Array.isArray(arg)) return `[${arg.map(hostArgToDisplay).join(', ')}]`
  if (isPlainObject(arg)) return JSON.stringify(arg)
  return String(arg)
}

/**
 * Extract the literal value from a `HostArg`, returning `null` for reference shapes.
 * @param arg - the host argument.
 * @returns the literal value if `arg` is not a reference, otherwise `null`.
 */
export function hostArgToLiteral(arg: HostArg): JsonValue | null {
  if (isHostRef(arg)) return null
  return arg
}
