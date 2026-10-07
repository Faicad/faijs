/**
 * compat-op — lift an arbitrary brepjs-shaped function into a faijs statement
 * op, built **on top of** defineOp (single implementation entry, v1).
 *
 * compatOp is NOT a second implementation path parallel to defineOp: every
 * shared mechanism is owned by defineOp — dispatch (dispatchPath + capability
 * routing), the Result boundary (runImpl + unwrapResult), product wrapping
 * (wrapBrepOne / wrapByKeys), `DUAL_OP_META` mounting and
 * `assertLibConforms` validation. compatOp only does two things:
 *   - spec pass-through: `CompatSpec` is a combinatorial inheritance of
 *     `DualOpOptions` (single source of truth, fields auto-sync — §3.1);
 *   - adapter construction: a brepjs-shaped bridge feeding the brep impl — the
 *     two bridging steps that cannot be shared (all reuse shared
 *     infrastructure, §3.2):
 *       1. call + unwrap — callBrepjs through the shared unwrapResult
 *          (`err` throws an OpError carrying the op name + BrepError code);
 *          async library fns are awaited first, so `Promise<Result<…>>` —
 *          the shape every kernel-awaiting library returns — unwraps too;
 *       2. adoptOut — outward adoption: top-level handle / `outputs`-declared
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
import { adoptEntity, callBrepjs } from './l3-bridge'
import { unwrapResult } from './result-unwrap'
import type { Shape } from '../../mesh/types'

/** compatOp's static spec: combinatorial inheritance (single source of truth). */
export interface CompatSpec extends Omit<DualOpOptions, 'mesh' | 'brep'> {
  /** Op name (error messages + metadata; required, unlike defineOp's optional name). */
  name: string

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
 * Build the brep-only adapter: pass inputs through → call the vendor function
 * through the shared unwrap → adopt the product (with the caller's `segments`,
 * 裁决 1/§5.2). The adapter never dispatches and never mounts metadata —
 * those are defineOp's.
 *
 * @param fn   the brepjs-shaped function (dual-form normalization inside, D11).
 * @param spec the static op spec (name + options pass-through).
 * @returns a `BrepImpl` compatible with defineOp's brep-only decl.
 */
function buildAdapter(fn: (...args: unknown[]) => unknown, spec: CompatSpec): BrepImpl<unknown[]> {
  return async (...args: unknown[]): Promise<BrepProduct> => {
    // faijs-native 库消费 core Shape：输入原样直传，保留 BREP 槽。
    const effective = args
    // Async library fns are supported: a library that awaits its kernel (every
    // `@faicad/faijs-gears` factory does — `await getGearKernel()`) returns
    // `Promise<Result<…>>`, and the shared unwrap is a sync leaf that only
    // recognizes settled Result records. Awaiting a non-promise product is a
    // no-op, so sync libraries are unaffected.
    const value = unwrapOrThrow(await callBrepjs(fn as never, effective), spec.name)
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
 * only the brepjs bridging (input pass-through / call / adopt); every other mechanism
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
  const { outputs, capabilities, engines, schema, slotMap, naming } = spec
  // `outputs` flows through defineOp's own wrapping path: the adapter adopts
  // per declared field, then defineOp wraps — isShape passthrough, so no
  // double wrapping (§3.2).
  return defineOp({
    brep: buildAdapter(fn, spec),
    name: spec.name,
    capabilities,
    // D11 透传：平台 op（compat 实现调 occt-only 方法）在生成物里声明 engines。
    // engines 与 capabilities 可并存（2026-09-24 撤销 D11-7 互斥），此处两条独立透传。
    engines,
    outputs,
    schema,
    slotMap,
    naming,
  }) as unknown as ((...args: unknown[]) => Promise<Shape>) & MetaCarrier
}