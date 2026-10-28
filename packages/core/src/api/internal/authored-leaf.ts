/**
 * authored-leaf — 「作者叶子网格」标记的读写（方案 2026-10-28-boolean-operand-validation v2 §4）
 *
 * 复刻 CGAL 的校验边界：**只有 PolySet→Nef 这一跳**做网格闭合性校验，Nef→Nef 不
 * 再校验。faijs 没有 Nef，每一步都产出带 mesh 的 Shape，所以必须显式标记哪些 mesh
 * 是「作者写出来的叶子网格」（polyhedron / import / 挤出产物 / 3D 原语），
 * 布尔产物一律不标记——否则会被误判（issue591 group B：两个闭合楔形 union 后顶棱
 * 被 4 面共用，OpenSCAD 保留它，faijs 若一并校验就会把整棵树丢空）。
 *
 * 失败方向是 **fail-safe**：标记丢失（跨 worker 序列化 / structuredClone 都会丢
 * Symbol 键）⇒ 视作未标记 ⇒ **不校验** ⇒ 保持现状，绝不会凭空丢掉合法操作数。
 */

import { AUTHORED_LEAF } from '../../mesh/types'

/**
 * ext（OpenSCAD 库）里的**作者叶子** op 白名单：其产物是 PolySet 级网格，
 * OpenSCAD 在转 Nef 时会校验闭合性。
 *
 * 用**白名单**而非黑名单：不在名单里的 op 都是「吃几何再派生」
 * （`hull`/`minkowski`/`resize`/`projection`/`offset`/2D 布尔），对应 CGAL 的 Nef
 * 阶段，不校验；将来新接入的 ext op 默认也不校验（fail-safe）。
 */
export const EXT_LEAF_OPS: ReadonlySet<string> = new Set([
  'load', // import()
  'polyhedron',
  'twistExtrude', // linear_extrude
  'revolve', // rotate_extrude
  'surface',
  'surfaceInterp',
  'text',
  'sphere',
  'cylinder',
  'cone',
])

/**
 * 给一个产物打上「作者叶子网格」标记。
 *
 * @param shape - 刚由叶子 op 产出的 Shape（非 Shape 值静默忽略）。
 */
export function markAuthoredLeaf(shape: unknown): void {
  if (shape === null || typeof shape !== 'object') return
  ;(shape as Record<symbol, unknown>)[AUTHORED_LEAF] = true
}

/**
 * 判定一个 Shape 是不是「作者叶子网格」（需要参与闭合性校验）。
 *
 * @param shape - 待判定的值（任意，非对象一律 false）。
 * @returns true 表示这是叶子网格，布尔运算应对它做闭合性校验。
 */
export function isAuthoredLeaf(shape: unknown): boolean {
  if (shape === null || typeof shape !== 'object') return false
  return (shape as Record<symbol, unknown>)[AUTHORED_LEAF] === true
}
