/**
 * ref-params.ts — 递归把 op 参数里的 TopoRef 替换为解析后的 {ordinal/handle}
 * （移植 brepjs refResolveFns.resolveRefParams，§3.6）
 *
 * 区别于 brepjs「仅单输入自动解析」：faijs 的 TopoRef 自带 origin（§2.2），
 * 多输入布尔也能按 origin 定位到对应输入 Shape 的命名槽，因此可支持多输入。
 *
 * 解析失败抛 TopoRefError（三态错误码），纳入 args 校验——不静默留原值。
 */

import { TopoRefError, type TopoRef } from './types'
import { resolveTopoRef, type ResolutionContext } from './resolver'

/** 按 TopoRef.origin 取解析上下文的查找函数（调用方把输入 Shape 的命名槽登记进来）。 */
export type ContextLookup = (origin: string) => ResolutionContext | undefined

/**
 * 结构判定：是否 TopoRef 四类之一。
 *
 * @param v - the value to test.
 * @returns true when the value is one of the four TopoRef kinds.
 */
export function isTopoRef(v: unknown): v is TopoRef {
  if (typeof v !== 'object' || v === null) return false
  const kind = (v as { kind?: unknown }).kind
  return kind === 'face' || kind === 'edge' || kind === 'vertex' || kind === 'derived-face'
}

/** 可递归的普通对象（非 TopoRef、非数组、非类实例）。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value) as object | null
  return proto === Object.prototype || proto === null
}

/**
 * 递归解析一个值（TopoRef → {ordinal, handle}；数组/嵌套对象下钻）。
 *
 * @param value - the value to resolve (may contain TopoRefs anywhere).
 * @param lookup - maps a TopoRef origin to its resolution context.
 * @returns the value with TopoRefs replaced by {ordinal, handle}.
 */
export function resolveTopoValue(value: unknown, lookup: ContextLookup): unknown {
  if (isTopoRef(value)) {
    const origin = originOf(value)
    const ctx = lookup(origin)
    if (!ctx) {
      // origin 没有对应输入 Shape 的命名槽 → 无法定位（引用错误，抛错而非静默）
      throw new TopoRefError(
        'E_TOPO_NOT_FOUND',
        value.kind,
        `topo ref origin "${origin}" has no input shape in this op`,
      )
    }
    return resolveTopoRef(value, ctx)
  }
  if (Array.isArray(value)) return value.map((v) => resolveTopoValue(v, lookup))
  if (isPlainObject(value)) {
    const nested: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) nested[k] = resolveTopoValue(v, lookup)
    return nested
  }
  return value
}

/**
 * 取 TopoRef 的 origin（§2.2）：
 * - face：ref.origin（单一链根）；
 * - edge/vertex/derived-face：无单一 origin 字段，取 faces/between[0].origin
 *   （faijs 扩展，多输入定位用）。
 *
 * @param ref - the TopoRef.
 * @returns the origin string used for context lookup.
 */
export function originOf(ref: TopoRef): string {
  if (ref.kind === 'edge' || ref.kind === 'vertex') {
    return ref.faces[0]?.origin ?? ''
  }
  if (ref.kind === 'derived-face') {
    return ref.between[0]?.origin ?? ''
  }
  return ref.origin
}

/**
 * 递归把 op 参数里的 TopoRef 替换为解析后的 {ordinal, handle}。
 *
 * 参数对象原样返回一个新对象；不改变原对象。解析失败抛 TopoRefError。
 *
 * @param params - the op's parameter table (user args; TopoRefs inside are resolved).
 * @param lookup - maps a TopoRef origin to its resolution context.
 * @returns the resolved parameter table.
 */
export function resolveTopoArgs(
  params: Readonly<Record<string, unknown>>,
  lookup: ContextLookup,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    out[key] = resolveTopoValue(value, lookup)
  }
  return out
}
