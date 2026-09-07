/**
 * compat-op — lift an arbitrary brepjs-shaped function into a faijs statement
 * op, built **on top of** defineOp (single implementation entry, v1).
 *
 * Design: docs/plans/2026-09-06-compatop-on-defineop.md §3
 *
 * compatOp is NOT a second implementation path parallel to defineOp: every
 * shared mechanism is owned by defineOp — dispatch (dispatchPath + capability
 * routing), the Result boundary (runImpl + unwrapResult), product wrapping
 * (wrapBrepOne / wrapByKeys), `DUAL_OP_META` mounting and
 * `assertLibConforms` validation. compatOp only does two things:
 *   - spec pass-through: `CompatSpec` is a combinatorial inheritance of
 *     `DualOpOptions` (single source of truth, fields auto-sync — §3.1);
 *   - adapter construction: a brepjs-shaped bridge feeding the brep impl — the
 *     three bridging steps that cannot be shared (all reuse shared
 *     infrastructure, §3.2):
 *       1. borrowDeep — inward borrow: deep walk, any faijs Shape →
 *          borrowBrepjsShape view (zero-copy; library-private handles pass
 *          through untouched);
 *       2. call + unwrap — callBrepjs through the shared unwrapResult
 *          (`err` throws an OpError carrying the op name + BrepError code);
 *       3. adoptOut — outward adoption: top-level handle / `outputs`-declared
 *          fields (single handle or handle array) → adoptEntity
 *          (unregister finalizer + fromHandle).
 *
 * The keep / keepHidden contract is untouched: compatOp neither blocks nor
 * rewrites it — any function running inside a DirectExecutor context can use
 * function-body declarations (C1), and call-site declarations override them
 * (`lang/keep.ts` resolveKeep). The decorated product therefore behaves like
 * any defineOp product: `keep`-safe, capability-aware, multi-output
 * (`DUAL_OP_META.outputs` visible).
 *
 * No self-invented fields: `CompatSpec` extends `Omit<DualOpOptions, 'mesh' |
 * 'brep'>` and declares nothing else; the only tweak is `name` tightened
 * (inherited field, not a new one).
 *
 * @module
 */

import {
  defineOp,
  DUAL_OP_META,
  type DualOpMeta,
  type DualOpOptions,
  type BrepImpl,
  type BrepProduct,
} from '../../define-op'
import { isShape } from '../../shape'
import { borrowBrepjsShape, adoptEntity, callBrepjs } from './l3-bridge'
import { unwrapResult } from './result-unwrap'
import type { Shape } from '../../mesh/types'

/** compatOp's static spec: combinatorial inheritance (single source of truth). */
export interface CompatSpec extends Omit<DualOpOptions, 'mesh' | 'brep'> {
  /** Op name (error messages + metadata; required, unlike defineOp's optional name). */
  name: string
}

const MAX_WALK_DEPTH = 4

/**
 * Inward bridging step: deep walk with faijs Shapes replaced by borrowed
 * brepjs views (zero-copy); everything else passes through.
 * Class instances are not traversed (defensive); library-private handles
 * pass through (§4.3.4 of the design).
 *
 * @param v - the value to borrow from (plain object, array, or primitive).
 * @param depth - current traversal depth (guard against deep recursion).
 * @returns the value with faijs Shapes replaced by borrowed views.
 */
export function borrowDeep(v: unknown, depth: number): unknown {
  if (depth > MAX_WALK_DEPTH || v === null || typeof v !== 'object') return v
  if (isShape(v)) return borrowBrepjsShape(v)
  if (Array.isArray(v)) return v.map((x) => borrowDeep(x, depth + 1))
  if (Object.getPrototypeOf(v) !== Object.prototype) return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) out[k] = borrowDeep(x, depth + 1)
  return out
}

/**
 * Statement-boundary unwrap — `err` becomes an execution error carrying the op
 * name and the `BrepError` code. Delegates to the shared
 * {@link unwrapResult} so the compat boundary and defineOp's Result boundary
 * share one leaf implementation (no drift).
 *
 * @param r - the Result-like value to unwrap.
 * @param name - the op name used in error messages.
 * @returns the unwrapped ok value.
 */
export function unwrapOrThrow(r: unknown, name: string): unknown {
  return unwrapResult(r, name)
}

/**
 * Bridging step: outward adoption — top-level handle or `outputs`-declared
 * fields → adoptEntity (unregister finalizer + fromHandle). `outputs` may also
 * name an array field of handles; every element is adopted individually.
 * Deduplication of already-adopted handles lives inside adoptEntity. A field
 * already being a faijs Shape passes through untouched (no double adoption).
 *
 * @param v - the library product.
 * @param spec - the compat spec (name + optional `outputs`).
 * @param segments - caller-provided `segments` (裁决 1,§5.2), forwarded so the
 *  adopted handles' tessellation honors it.
 * @returns the adopted record / Shape, or the plain data untouched.
 */
function adoptOut(v: unknown, spec: CompatSpec, segments?: number): unknown {
  if (isShape(v)) return v
  if (spec.outputs && typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const rec = v as Record<string, unknown>
    for (const f of spec.outputs) {
      const field = rec[f]
      rec[f] = Array.isArray(field)
        ? field.map((x) => adoptEntity(x, spec.name, segments))
        : adoptEntity(field, spec.name, segments)
    }
    return v
  }
  return adoptEntity(v, spec.name, segments)
}

/**
 * Read the caller-supplied tessellation density from a compat op's args.
 *
 * 裁决 1：faijs 的 `segments` 显式超集在 brepjs 投影侧也必须可选；这里从调用点
 * 的尾参 options（或任一 plain-object 实参）抓取 `segments`，在产出句柄被收编为
 * faijs Shape 时透传给 `fromHandle` 的三角化（§5.2 机制）。默认不传 = 由
 * handle-bridge 的 64 兜底。
 */
function readSegmentsFromArgs(args: unknown[]): number | undefined {
  for (let i = args.length - 1; i >= 0; i--) {
    const a = args[i]
    if (
      a !== null &&
      typeof a === 'object' &&
      !Array.isArray(a) &&
      Object.getPrototypeOf(a) === Object.prototype
    ) {
      const seg = (a as Record<string, unknown>).segments
      if (typeof seg === 'number' && Number.isFinite(seg)) return seg
    }
  }
  return undefined
}

/**
 * Build the brep-only adapter: borrow inputs → call the vendor function through
 * the shared unwrap → adopt the product (with the caller's `segments`,
 * 裁决 1/§5.2). The adapter never dispatches and never mounts metadata —
 * those are defineOp's.
 *
 * @param fn   the brepjs-shaped function (dual-form normalization inside, D11).
 * @param spec the static op spec (name + options pass-through).
 * @returns a `BrepImpl` compatible with defineOp's brep-only decl.
 */
function buildAdapter(fn: (...args: unknown[]) => unknown, spec: CompatSpec): BrepImpl<unknown[]> {
  return async (...args: unknown[]): Promise<BrepProduct> => {
    const borrowed = args.map((a) => borrowDeep(a, 0))
    const value = unwrapOrThrow(callBrepjs(fn as never, borrowed), spec.name)
    return adoptOut(value, spec, readSegmentsFromArgs(args)) as BrepProduct
  }
}

/** Carrier of the DualOpMeta mounted by defineOp (same shape as defineOp's). */
type MetaCarrier = { [DUAL_OP_META]?: DualOpMeta }

/**
 * Lift a brepjs-shaped function into a defineOp-decorated op facade (brep-only).
 *
 * The decorated product is identical to a defineOp product: same `DUAL_OP_META`
 * field set (kind 'dual-op', brep impl, name, capabilities, outputs, schema,
 * slotMap), same dispatch semantics, same Result boundary. The adapter carries
 * only the brepjs bridging (borrow / call / adopt); every other mechanism
 * belongs to defineOp.
 *
 * @param fn   the brepjs-shaped function.
 * @param spec the static spec (name required; capabilities/outputs/slotMap/
 *  schema pass through and take effect).
 * @returns the compat op facade, carrying dual-op metadata.
 */
export function compatOp(
  fn: (...args: unknown[]) => unknown,
  spec: CompatSpec,
): ((...args: unknown[]) => Promise<Shape>) & MetaCarrier {
  const { outputs, capabilities, schema, slotMap } = spec
  // `outputs` flows through defineOp's own wrapping path: the adapter adopts
  // per declared field, then defineOp wraps — isShape passthrough, so no
  // double wrapping (§3.2).
  return defineOp({
    brep: buildAdapter(fn, spec),
    name: spec.name,
    capabilities,
    outputs,
    schema,
    slotMap,
  }) as unknown as ((...args: unknown[]) => Promise<Shape>) & MetaCarrier
}