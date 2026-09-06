/**
 * stdlib reconcile — 断链/混合时刻定向归约（P0-1b）
 *
 *
 * 用户纠正（2026-08-29）：brep→mesh 的归约不只在"mesh 与 brep 做布尔"的时刻发生，
 * 而是**任何 BREP 断链时刻**——BREP 输入进入 mesh-only 路径（如 knurl 滚花）即断链，
 * 必须先转 mesh。本文件提供各 mesh 路径入口共用的定向归约：
 *
 * - 触发：本次 op 的输入中既有 `hasBrep(s) === true`、又有 `false`（混合），
 *   或 mesh-only op 收到 BREP 输入（断链）。
 * - 处理对象：**只对 BREP 侧输入**（`brepOf(s)` 有句柄者）做归约（reconcileMesh），
 *   把 OCCT 逐面三角汤归约为合法 2-manifold 网格；mesh 侧输入**原样透传**。
 * - 非混合场景零变化：全 BREP → 走精确布尔，不碰归约；全 mesh → 原样透传。
 *   ⇒ 满足用户"不应该改变现有行为"的硬约束。
 *
 * 与红线不冲突：归约发生在 dispatchPath 静态判定为 'mesh' **之后**，是输入数据规整，
 * 不是运行时 try-catch 回退。
 */

import type { Shape } from '../mesh/types'
import { reconcileMesh } from '../mesh/reconcile'
import { hasBrep } from '../shape'

/**
 * 混合/断链时刻定向归约：仅对 BREP 侧输入做归约，mesh 侧原样透传。
 * 无 BREP 输入时返回原数组引用（零开销、零行为变化）。
 * @param inputs - the input shapes to reconcile.
 * @returns the input array as-is when no BREP input is present, otherwise a
 *   new array with BREP-side inputs converted to valid 2-manifold meshes.
 */
export function reconcileBrepInputs(inputs: Shape[]): Shape[] {
  let hasBrepSide = false
  for (const s of inputs) {
    if (hasBrep(s)) {
      hasBrepSide = true
      break
    }
  }
  if (!hasBrepSide) return inputs

  return inputs.map((s) => {
    if (!hasBrep(s)) return s
    const r = reconcileMesh(s.positions, s.indices)
    return { positions: r.positions, indices: r.indices }
  })
}
