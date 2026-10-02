/**
 * cadquery-selectors/borrow-bridge — compatOp 提升边界归一（等价搬运自 cq-compat）
 *
 * 原实现位于 `packages/cq-compat/src/workplane.ts` 的 `asBrepShape`，本文件为
 * 原样搬运（仅 import 路径改为 core 内部相对路径），零逻辑改动。
 */

import { fromHandle } from '../../sdk'
import { isShape } from '../../shape'
import type { Shape } from '../../mesh/types'

// ── compatOp 提升边界归一（GOTCHA：borrowDeep 把实参 Shape 换成借用视图）──
//
// 当 cq-compat 命名空间被 registerLib 提升（无 dual-op → autoLift=true）时，
// 每个裸导出函数的实参先经 borrowDeep：faijs Shape → 借用 brepjs 视图
// `{ wrapped, disposed, delete, onDispose }`（`isShape=false`、`brepOf=undefined`）。
// 直接调用（测试进程内）拿到的则是真实 Shape。两个形态都必须能消费：
//
//   asBrepShape(v) —
//   - 真实 Shape → 原样返回；
//   - 借用视图（有 `.wrapped`）→ 提取原始 OCCT 句柄，fromHandle 还原为真实
//     Shape（mesh 三角化 + BREP 身份槽登记，brepOf 可恢复），按视图对象缓存
//     （同句柄多次调用不重复三角化）；
//   - 其余 → 原样返回（调用方自行判空/报错）。
//
// 所有权：归一出的新 Shape 与原 part Shape 的 slot 指向同一 OCCT 句柄，但 slot
// 按 Shape 对象各自持有（fromBrep 写的是新 Shape 的 slot），无共享释放路径——
// 与 core fromHandle 收编模式同构，不引入双重释放。
// 视图 `.wrapped` 是 OcctWasmHandle 对象（{ id, type, __occtWasm }），内核只收
// 数字 id → 解包方式与 core fromHandle 一致。
const borrowedShapeCache = new WeakMap<object, Shape>()

/**
 * 把可能是借用视图的几何输入归一为真实 faijs Shape（见上方注释）。
 * @param v 真实 Shape、借用视图（`{ wrapped }`）或其他原样透传的输入。
 * @returns 真实 faijs `Shape`（借用视图经 `fromHandle` 还原并缓存）。
 */
export function asBrepShape(v: unknown): Shape {
  if (isShape(v)) return v as Shape
  if (v !== null && typeof v === 'object' && 'wrapped' in v) {
    const view = v as { wrapped: unknown }
    const hit = borrowedShapeCache.get(view)
    if (hit) return hit
    const wrappedAny = view.wrapped
    const handle =
      typeof wrappedAny === 'object' && wrappedAny !== null && 'id' in wrappedAny
        ? (wrappedAny as { id: number }).id
        : wrappedAny
    const s = fromHandle(handle) as Shape
    borrowedShapeCache.set(view, s)
    return s
  }
  return v as Shape
}