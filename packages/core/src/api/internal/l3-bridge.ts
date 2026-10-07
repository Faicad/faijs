/**
 * L3 bridge — faijs Shape ⇄ 库侧 brepjs-shaped shape（生成层共用，E5 模板）
 *
 * 桥接事实（2026-09-02 实测，2026-09-25 core-decouple wrapup 自有化）：
 * - faijs 的 brep slot（`brepOf(shape)` → `slot.solid`）运行时是 occt-wasm 的
 *   shape 句柄（number，见 `brep/engine/types.ts` 的 `BrepHandle` 注释）；
 * - 库侧（compatOp 投影的 brepjs-shaped 函数）消费的 ShapeHandle 是对象视图
 *   （`{ wrapped, disposed, delete, onDispose }`），其 `wrapped` 运行时也是
 *   同一 occt-wasm 实例的 shape 句柄 —— D10 单实例保证两者共享同一 wasm，
 *   句柄空间一致，**零拷贝互操作**。brepjs 子包删除后（裁决 9），本文件
 *   自带最小实现：句柄类型视图 / disposal 解除（no-op）。
 *
 * 因此投影一个库函数只需三件事：
 *   1. faijs Shape → 库输入：原样直传（faijs-native 库消费 core Shape）；
 *   2. 调库函数（Result 语义由各 op 处理：`ok` 取值 / `err` 抛错）；
 *   3. 库产物 → faijs Shape：取 `.wrapped`（owned handle）→ `fromHandle()`
 *      （meshHandle + 身份槽登记，所有权转入 faijs）。
 *
 * 依赖约束（同 `brep/handle-bridge.ts`）：只允许 import runtime-state / shape /
 * handle-bridge / occt-kernel 的类型与工具，保持 dist/sdk.js 零 heavy 依赖
 * （occt-kernel 的 getOcctKernel 为惰性访问，引擎装配前不触碰 wasm）。
 */

import type { Shape } from '../../mesh/types'
import { fromHandle } from '../../brep/handle-bridge'
import type { BrepHandle } from '../../brep/engine/types'
import { getBackends } from '../../runtime-state'
import { OpError } from './result-unwrap'

// ── brepjs 借用面最小自有化（core-decouple wrapup §4.3）──────────────────────
// 原实现：@faicad/faijs-brepjs/core/disposal.js（unregisterFromCleanup /
// ShapeHandle）。brepjs 子包删除后按同语义内联。

/** 库侧消费的 shape 句柄视图（borrowed：不拥有、不释放）。 */
export interface BorrowedShapeHandle {
  /** The raw kernel shape handle */
  readonly wrapped: unknown
  /** Manual dispose（borrowed 视图为 no-op） */
  [Symbol.dispose](): void
  /** Alias for Symbol.dispose */
  delete(): void
  /** Always false for a borrowed view */
  readonly disposed: boolean
  /** Borrowed views never dispose, so callbacks never fire（no-op）。 */
  onDispose(callback: () => void): void
}

/** brepjs 的 finalizer registry 已随子包删除——解除登记为 no-op。 */
function unregisterFromCleanup(_deletable: object): void {
  // no-op（原 brepjs core/disposal.ts#unregisterFromCleanup；registry 已不存在）
}

/**
 * Adopt a library-side product into a faijs Shape.
 *
 * Unwraps the owned occt handle (`.wrapped`) and registers it into faijs'
 * identity slot via `fromHandle` — ownership transfers to faijs, and the library
 * wrapper must not dispose it afterwards (projected ops return it directly).
 *
 * @param product - a library-side shape (ShapeHandle / AnyShape family).
 * @param segments - optional tessellation segments（投影侧 `segments?`，裁决 1；
 *   透传给 `fromHandle` 的三角化，默认 32 → 64 由 handle-bridge 兜底).
 * @returns the faijs Shape wrapping the same occt solid.
 */
export function adoptBrepjsProduct(product: unknown, segments?: number): Shape {
  if (product === null || typeof product !== 'object' || !('wrapped' in product)) {
    throw new Error('[faijs/l3-bridge] E_BAD_PRODUCT: expected a shape handle from the library engine')
  }
  // library `wrapped` may be an OcctHandle (`{id}`) or a raw numeric id;
  // faijs' kernel meshShape expects the numeric shape id (fromHandle).
  const wrappedAny = (product as { wrapped: unknown }).wrapped
  const rawId =
    typeof wrappedAny === 'object' && wrappedAny !== null && 'id' in wrappedAny
      ? (wrappedAny as { id: number }).id
      : (wrappedAny as number)
  const wrapped = rawId as BrepHandle
  return fromHandle(wrapped, segments === undefined ? undefined : { segments })
}

/**
 * Call a library function with a rebuilt positional argument list.
 *
 * Generated wrappers build `__args` positionally (geometry inputs pass through
 * untouched, value params pass through as-is); a plain `fn(...args: unknown[])` spread fails
 * TS2556 against fixed-arity signatures, so the call goes through this
 * rest-typed bridge that preserves the function's own `ReturnType` (so a
 * `Result` return keeps `.ok`/`.value` for the generated unwrap code).
 *
 * @param fn   the library function.
 * @param args the rebuilt positional argument list (geometry inputs + value params).
 * @returns whatever the function returns (typed via ReturnType).
 */
export function callBrepjs<F extends (...a: never[]) => unknown>(fn: F, args: unknown[]): ReturnType<F> {
  return fn(...(args as never[])) as ReturnType<F>
}

/**
 * Phase 6（narrowing plan D7）：brep 测量 op 的执行前引擎身份断言。
 *
 * 库面 query op 是普通函数（不走 dispatchPath），但部分依赖 occt-only 内核方法
 * （shapeType / linearCenterOfMass / distance / curvature / interference，L2 平台面，
 * D6 表）——在这些 op 的实现上声明 `engines: ['occt']`，函数体第一行即断言当前
 * 引擎身份，在触碰内核之前报出可定位错误（文案与 D11-4 同构），不补桩、不回退。
 *
 * @param opName - op 名（报错文案）。
 * @param engines - 允许执行的引擎 id 集合（arg-spec 条目的 `engines` 字段）。
 * @throws BrepUnsupportedError 当当前引擎不在 `engines` 内。
 */
export function assertEngineFor(opName: string, engines: readonly string[]): void {
  const current = getBackends().config.brepEngineId
  if (current === null || current === undefined || !engines.some((e) => e === current)) {
    const e = new Error(
      `E_BREP_UNSUPPORTED: op '${opName}' requires engine ${engines.join(' or ')} (current=${current ?? '<none>'})`,
    )
    e.name = 'BrepUnsupportedError'
    throw e
  }
}

// ─── adoption (compatOp step 5; R1 fix) ──────────────────────────────────────

/** Already-adopted handle dedup table: the same library handle adopted twice →
 *  the same faijs Shape (prevents double ownership / double dispose, R6). */
const adoptedMap = new WeakMap<object, Shape>()

/**
 * Adopt a library handle as a faijs Shape (compatOp step 5's only adoption
 * entry point).
 *
 * ① pure data (no `.wrapped`) → pass through unchanged (query/data functions);
 * ② sub-shape kinds (face/edge/wire/vertex/shell) → throw E_SUBSHAPE_BOUNDARY
 *    (v1 boundary rejection, R4; the brand is a compile-time phantom type —
 *    the runtime kind is read from the occt-wasm handle's own `type` field,
 *    same as the kernel getShapeType helpers);
 * ③ entities (solid/compound) → no-op unregisterFromCleanup（★ R1：brepjs
 *    finalizer registry 已随子包删除，无孤儿释放风险）→ adoptBrepjsProduct.
 *
 * @param product - the library result (handle or plain data record).
 * @param opName - the op name (error messages).
 * @param segments - optional tessellation segments (compat `segments?`).
 * @returns the adopted faijs Shape, or the plain data untouched.
 */
export function adoptEntity(product: unknown, opName: string, segments?: number): unknown {
  if (product === null || typeof product !== 'object' || !('wrapped' in product)) return product
  const h = product as BorrowedShapeHandle
  const prev = adoptedMap.get(h as object)
  if (prev) return prev
  const type = (h.wrapped as { type?: string }).type
  if (type !== undefined && type !== 'solid' && type !== 'compound') {
    throw new OpError(
      opName,
      'E_SUBSHAPE_BOUNDARY',
      `[faijs/op] ${opName}: E_SUBSHAPE_BOUNDARY: sub-shape handle ('${type}') ` +
        'must not cross the library boundary; return entity solids or plain data',
    )
  }
  unregisterFromCleanup(h as object) // ★ R1: no-op（brepjs registry 已删除）
  const s = adoptBrepjsProduct(h, segments) // fromHandle: tessellation + identity + BREP slots
  adoptedMap.set(h as object, s)
  return s
}
