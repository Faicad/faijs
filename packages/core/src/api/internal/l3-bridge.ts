/**
 * L3 bridge — faijs Shape ⇄ vendored brepjs shape（生成层共用，E5 模板）
 *
 * 设计文档：docs/plans/2026-09-02-faijs-api-surface-completion.md §E5
 *
 * 桥接事实（2026-09-02 实测）：
 * - faijs 的 brep slot（`brepOf(shape)` → `slot.solid`）运行时是 occt-wasm 的
 *   shape 句柄（number，见 `brep/engine/types.ts` 的 `BrepHandle` 注释）；
 * - vendored brepjs 的 `ShapeHandle.wrapped`（`core/disposal.ts`）运行时也是
 *   同一 occt-wasm 实例的 shape 句柄 —— D10 单实例（`api/occt-kernel-bridge.ts`）
 *   保证两者共享同一 wasm，句柄空间一致，**零拷贝互操作**。
 *
 * 因此投影一个 brepjs op 只需三件事：
 *   1. faijs Shape → brepjs 输入：`createBorrowedHandle(brepOf(s))`（借入，不转移所有权）；
 *   2. 调 vendored 函数（Result 语义由各 op 处理：`ok` 取值 / `err` 抛错）；
 *   3. brepjs 产物 → faijs Shape：取 `.wrapped`（owned handle）→ `fromHandle()`
 *      （meshHandle + 身份槽登记，所有权转入 faijs）。
 *
 * 依赖约束（同 `brep/handle-bridge.ts`）：只允许 import runtime-state / shape /
 * handle-bridge / vendored disposal 的类型与借入工具，保持 dist/sdk.js 零 heavy 依赖。
 */

import type { Shape } from '../../mesh/types'
import { brepOf } from '../../shape'
import { fromHandle } from '../../brep/handle-bridge'
import type { BrepHandle } from '../../brep/engine/types'
import { createBorrowedHandle } from '../../vendored/brepjs/core/disposal.js'
import type { ShapeHandle } from '../../vendored/brepjs/core/disposal.js'

/**
 * Borrow a faijs Shape's OCCT handle as a vendored brepjs shape handle.
 *
 * No ownership transfer: the brepjs-side borrow is a no-op-dispose view of the
 * same occt-wasm shape, valid while the faijs Shape owns it. Pass the result to
 * vendored functions that take `Shapeable<T>` / `AnyShape`.
 *
 * @param s - the faijs Shape whose brep slot is borrowed.
 * @returns a vendored brepjs ShapeHandle view of the same occt shape.
 * @throws when the Shape has no live BREP slot (mesh-only input on a brep op).
 */
export function borrowBrepjsShape(s: Shape): ShapeHandle {
  const solid = brepOf(s) as BrepHandle | undefined
  if (solid === undefined) {
    throw new Error(
      '[faijs/l3-bridge] E_BREP_ONLY_INPUT: operation requires a BREP-backed shape ' +
        '(mesh-only input cannot run on the brep path)',
    )
  }
  return createBorrowedHandle(solid as never)
}

/**
 * Adopt a vendored brepjs product into a faijs Shape.
 *
 * Unwraps the owned occt handle (`.wrapped`) and registers it into faijs'
 * identity slot via `fromHandle` — ownership transfers to faijs, and the brepjs
 * wrapper must not dispose it afterwards (projected ops return it directly).
 *
 * @param product - a vendored brepjs shape (ShapeHandle / AnyShape family).
 * @returns the faijs Shape wrapping the same occt solid.
 */
export function adoptBrepjsProduct(product: unknown): Shape {
  if (product === null || typeof product !== 'object' || !('wrapped' in product)) {
    throw new Error('[faijs/l3-bridge] E_BAD_PRODUCT: expected a shape handle from the vendored engine')
  }
  const wrapped = (product as { wrapped: unknown }).wrapped as BrepHandle
  return fromHandle(wrapped)
}

/**
 * Call a vendored brepjs function with a rebuilt positional argument list.
 *
 * Generated wrappers build `__args` positionally (borrowing geometry inputs,
 * passing value params through); a plain `fn(...args: unknown[])` spread fails
 * TS2556 against brepjs' fixed-arity signatures, so the call goes through this
 * rest-typed bridge that preserves the function's own `ReturnType` (so a
 * `Result` return keeps `.ok`/`.value` for the generated unwrap code).
 *
 * @param fn   the vendored brepjs function.
 * @param args the rebuilt positional argument list (borrowed handles + value params).
 * @returns whatever the vendored function returns (typed via ReturnType).
 */
export function callBrepjs<F extends (...a: never[]) => unknown>(fn: F, args: unknown[]): ReturnType<F> {
  return fn(...(args as never[])) as ReturnType<F>
}
