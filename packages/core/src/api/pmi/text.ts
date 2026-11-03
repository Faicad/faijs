/**
 * api/pmi/text — 螺纹孔标注的显示文本（单一真源）
 *
 * 用户契约（2026-10-31）：螺纹孔的**底孔（原始几何）**与**螺纹（后加工攻丝）**
 * 是同一个整体，显示时必须同时出现。本模块是该文本的唯一生成点，
 * 宿主（3D 编辑器 / 看图 / 图纸）一律调用它，避免各端各写一套格式。
 *
 * 文本**不是数据**：`PmiThreadHole.thread` / `.pilot` 的结构字段才是真源，
 * 这里只做呈现。因此不参与身份判定、可随时改格式。
 *
 * 设计文档：docs/plans/2026-10-31-faijs-pmi-thread-and-technotes-design.md §3.2
 */

import type { PmiThreadHole, PmiThreadSpec } from './types'

/** 数值呈现：去掉浮点尾巴（6.0 → '6'、5.25 → '5.25'）。 */
function num(v: number): string {
  return String(Math.round(v * 1000) / 1000)
}

/**
 * 螺纹规格文本：优先用 `specLabel`，缺省按标准与公称直径合成。
 *
 * 细牙/非标规格**由 `specLabel` 表达**（'M8×1'、'1/4"-20'）——`pitch` 是数据字段，
 * 不自动拼进文本：粗牙标准叫法就是 'M6'，拼上 '×1' 反而不规范。
 *
 * 管螺纹**必须**由 `specLabel` 给出（'PT1/8'）：它的规格号是 1/8" 这个**代号**，
 * 与基准平面大径（9.728）没有换算关系，拿大径合成只会得到 'G9.728' 这种
 * 既不规范也查不到的写法，所以 pipe 缺省时只如实给直径数值。
 *
 * @param spec - the thread spec.
 * @returns e.g. 'M6' / 'M8×1' / 'PT1/8'.
 */
export function formatThreadSpec(spec: PmiThreadSpec): string {
  return spec.specLabel
    ?? (spec.standard === 'metric'
      ? `M${num(spec.nominalDiameter)}`
      : num(spec.nominalDiameter))
}

/**
 * 螺纹孔标注的完整显示文本——**底孔 + 螺纹一起呈现**。
 *
 * 例：
 * - 攻丝孔：`'4×M6-6H ↓14（底孔 Φ5 ↓16，攻丝）'`
 * - 无公差等级：`'M6 ↓14（底孔 Φ5 ↓16，攻丝）'`
 * - 建模螺纹：`'M6 ↓14（实体螺纹）'`
 *
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name formatThreadHole
 * @returns string 单行显示文本。
 * @param item - the thread-hole annotation. type:PmiThreadHole required:true
 * @example
 * const text = cad.formatThreadHole(cad.pmiThreads(part0)[0])
 */
export function formatThreadHole(item: PmiThreadHole): string {
  const countPrefix = item.count !== undefined && item.count > 1 ? `${item.count}×` : ''
  const tol = item.thread.toleranceClass ? `-${item.thread.toleranceClass}` : ''
  const handed = item.thread.handedness === 'left' ? ' LH' : ''
  const threadPart = `${countPrefix}${formatThreadSpec(item.thread)}${tol}${depthText(item.thread.depth)}${handed}`

  if (item.process === 'modeled') {
    return `${threadPart}（实体螺纹）`
  }
  const pilotPart = `底孔 Φ${num(item.pilot.diameter)}${depthText(item.pilot.depth)}`
  return `${threadPart}（${pilotPart}，攻丝）`
}

/**
 * 深度文本：`↓14`；`0` 表示通孔，写作 `通`（图纸惯例）。
 *
 * @param depth - 深度 mm（0 = 通孔）。
 * @returns the depth fragment with a leading space, or empty for through holes' depth.
 */
function depthText(depth: number): string {
  return depth > 0 ? ` ↓${num(depth)}` : ' 通'
}
