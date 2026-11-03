/**
 * 布尔减「贴面减除」防护（方案 2026-11-03 L3：默认自动规避共面）。
 *
 * 机理：`cad.subtract(part, tool)` / `cad.boolean('cut', …)` 的 tool 表面与被减体
 * 表面**共面**时，两体在该处相交退化（零体积相交 / 面贴面），CSG/B-rep 内核把
 * 「贴面」残留成薄壳（copy1 round 8 实证：1px 残留四轮反复）。本模块对 `cut`
 * 操作**默认**检测共面，并在共面处给 tool 外扩 ε（`COINCIDENT_EPS = 0.01mm`），
 * 把「贴面」改成明确的「越出/侵入」——内核布尔不再处理共面退化，减除干净。
 *
 * 设计原则（用户裁定 2026-11-03）：**正确行为是默认，不是选项**。
 * - `cad.subtract` / `cad.boolean('cut')` 默认自动规避，无需用户配置；
 * - `cad.boolean('cut', { clearance: 0.1 })` 覆盖外扩量（制造级余量）；
 * - `cad.boolean('cut', { clearance: 0 })` 显式关闭（回到旧行为，诊断照常）。
 *
 * 算法（两段）：
 * 1. O(1) 包围盒粗筛：tool 与 base 的 bbox 在 x/y/z 三轴的交叠深度均 > ε ⇒ 必然
 *    侵入，跳过（绝大多数正常 subtract 零成本）；
 * 2. 对「bbox 面距离 < ε」的轴判定零体积相交：tool 底面贴 base 顶面、或 tool 顶面
 *    贴 base 底面（该轴无交叠）⇒ 在 tool 该侧加 ε 厚薄壳（`makeBoxFromCorners` +
 *    `fuse`），tool 该侧变为明确侵入 base，布尔减从「零体积」变成「ε 厚正体积」。
 *
 * 适用范围（2026-11-03 实测定论）：只修正零体积相交。「tool 已侵入 base、某面恰好
 * 贴 base 表面」的贴齐（槽底=板底、全厚贯穿孔）不处理——交叠为正体积，CSG 内核对
 * 共面边界处理正常（copy1 ⑤ 横带 / ⑦ 孔实证 raycheck 通过），外扩纯属多余且产生
 * 噪音。零体积相交的修正副作用：tool 位置本身有误（该轴未进入 base）时，自动修正
 * 保证「不残留、不静默失败」——挖出 ε 薄层（0.01mm），远小于任何图纸公差。
 *
 * 面演化/naming：修正后的 tool 是 fuse 产物，无 roleTable（调用方以空 Map 传入）。
 * 修正是罕见路径（仅零体积贴面触发）；正常 subtract 完全走原路径，零行为变化。
 */

import type { BrepHandle, BrepVec3, BrepBoundingBox } from '../../brep/engine/types'
import type { BrepEngineApi } from '../../brep/engine/primitives'

/** 共面自动外扩余量（mm）。与 `SEWING_TOLERANCE` / `DrillHoleCore` epsilon 同量级。 */
export const COINCIDENT_EPS = 0.01

/** 贴面减除防护选项（`cad.boolean('cut', …)` 支持；`cad.subtract` 纯默认）。 */
export interface CoincidentCutOptions {
  /**
   * 共面自动外扩余量（mm）。默认 `COINCIDENT_EPS`（0.01）；传 `0` 显式关闭自动
   * 规避（回到旧行为）；制造级场景可传 0.1 及以上。
   */
  clearance?: number
}

/** 轴→bbox 字段映射。 */
const MIN_KEY: Record<'x' | 'y' | 'z', keyof BrepBoundingBox> = { x: 'xmin', y: 'ymin', z: 'zmin' }
const MAX_KEY: Record<'x' | 'y' | 'z', keyof BrepBoundingBox> = { x: 'xmax', y: 'ymax', z: 'zmax' }
const AXES: readonly ('x' | 'y' | 'z')[] = ['x', 'y', 'z']

/** 一片 ε 厚薄壳（加在 tool 的某个 bbox 面外侧）。 */
export interface CoincidentShell {
  axis: 'x' | 'y' | 'z'
  /** 'min'：加在 tool 该轴 -axis 面外侧；'max'：加在 +axis 面外侧。 */
  side: 'min' | 'max'
  corner1: BrepVec3
  corner2: BrepVec3
}

/**
 * 检测 `(baseBox, toolBox)` 的零体积贴面轴，返回需要在 tool 哪些 bbox 面外侧补薄壳。
 *
 * 判定范围（2026-11-03 实测定论）：只修正**零体积相交**——
 * - tool 底面贴 base 顶面（tool 完全在 base 外 / 该轴无交叠）：`|tMin - bMax| < ε`
 * - tool 顶面贴 base 底面（同上，另一侧）：`|tMax - bMin| < ε`
 * 这两种情形布尔减交叠体积为零（或近乎为零），内核无体积可减 ⇒ 残留/静默失败。
 *
 * **不**修正「tool 已侵入 base、某面恰好贴 base 表面」（`|tMax - bMax| < ε` /
 * `|tMin - bMin| < ε`，如槽底=板底的沉槽、全厚贯穿孔）：交叠为正体积，CSG 内核
 * 对共面边界的处理正常（copy1 ⑤ 横带 / ⑦ 孔实证 raycheck 通过），外扩纯属多余。
 *
 * @param baseBox 被减体（base）的 bbox。
 * @param toolBox 刀具体（tool）的 bbox。
 * @param clearance 共面判定阈值（mm）：bbox 面距离 < 该值判为贴面；≤ 0 时不检测。
 * @returns 需要在 tool 上外扩的 ε 薄壳列表（空数组 = 无贴面，不需修正）。
 */
export function detectCoincidentShells(
  baseBox: BrepBoundingBox,
  toolBox: BrepBoundingBox,
  clearance: number,
): CoincidentShell[] {
  const shells: CoincidentShell[] = []
  for (const axis of AXES) {
    const bMin = baseBox[MIN_KEY[axis]]
    const bMax = baseBox[MAX_KEY[axis]]
    const tMin = toolBox[MIN_KEY[axis]]
    const tMax = toolBox[MAX_KEY[axis]]
    const others = AXES.filter((a) => a !== axis)
    const oA0 = others[0]!
    const oA1 = others[1]!

    // tool 底面（-axis 面）贴 base 顶面（+axis 面）⇒ tool 在该轴位于 base 外，零体积。
    if (Math.abs(tMin - bMax) < clearance) {
      const corner1: BrepVec3 = { x: 0, y: 0, z: 0 }
      const corner2: BrepVec3 = { x: 0, y: 0, z: 0 }
      corner1[axis] = tMin - clearance
      corner1[oA0] = toolBox[MIN_KEY[oA0]]
      corner1[oA1] = toolBox[MIN_KEY[oA1]]
      corner2[axis] = tMin
      corner2[oA0] = toolBox[MAX_KEY[oA0]]
      corner2[oA1] = toolBox[MAX_KEY[oA1]]
      shells.push({ axis, side: 'min', corner1, corner2 })
    }
    // tool 顶面（+axis 面）贴 base 底面（-axis 面）⇒ 同上，另一侧。
    if (Math.abs(tMax - bMin) < clearance) {
      const corner1: BrepVec3 = { x: 0, y: 0, z: 0 }
      const corner2: BrepVec3 = { x: 0, y: 0, z: 0 }
      corner1[axis] = tMax
      corner1[oA0] = toolBox[MIN_KEY[oA0]]
      corner1[oA1] = toolBox[MIN_KEY[oA1]]
      corner2[axis] = tMax + clearance
      corner2[oA0] = toolBox[MAX_KEY[oA0]]
      corner2[oA1] = toolBox[MAX_KEY[oA1]]
      shells.push({ axis, side: 'max', corner1, corner2 })
    }
  }
  return shells
}

/**
 * 贴面减除防护：检测 `(base, tool)` 共面并返回修正后的 tool（fuse 上 ε 薄壳）。
 *
 * @param kernel 当前 BREP 引擎（getBoundingBox / makeBoxFromCorners / fuse / release）。
 * @param base 被减体句柄（只读，不释放）。
 * @param tool 刀具体句柄（调用方输入，生命周期归链；修正产物为 fuse 结果，无 roleTable）。
 * @param clearance 共面判定阈值（mm）；≤ 0 时显式关闭（返回 undefined，零行为变化）。
 * @returns 修正后的 tool 句柄（调用方负责在布尔完成后 `release`）；未检测到共面
 *          （或 clearance ≤ 0）返回 `undefined`（原样使用 tool，零行为变化）。
 */
export function coincidentCutProtect(
  kernel: BrepEngineApi,
  base: BrepHandle,
  tool: BrepHandle,
  clearance: number,
): BrepHandle | undefined {
  if (clearance <= 0) return undefined
  const baseBox = kernel.getBoundingBox(base)
  const toolBox = kernel.getBoundingBox(tool)
  const shells = detectCoincidentShells(baseBox, toolBox, clearance)
  if (shells.length === 0) return undefined

  let acc: BrepHandle = tool
  const owned: BrepHandle[] = []
  for (const s of shells) {
    const shell = kernel.makeBoxFromCorners(s.corner1, s.corner2)
    owned.push(shell)
    const prev = acc
    const fused = kernel.fuse(prev, shell)
    if (prev !== tool) owned.push(prev) // tool 是调用方输入，生命周期归链，不释放
    acc = fused
  }
  for (const h of owned) {
    try { kernel.release(h) } catch { /* 已释放 */ }
  }
  return acc
}
