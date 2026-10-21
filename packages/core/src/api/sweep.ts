/**
 * api sweep — 扫掠（基础）：截面沿脊柱路径生成扫掠体。**两内核都支持**。
 *
 * 为什么不是 occt-only（方案 2026-10-10-sweep-loft-dual-engine-plan §3 总览 / §4）：
 * 基础扫掠（单截面沿路径，无过渡 / 引导线 / 缩放律）两个内核都能做 —— occt 走原生
 * `sweepPipeShell`（补两个默认开关 false），brepkit 走 `sweep(face, NURBS 路径)`；
 * 差异（brepkit 只吃 face、路径要 NURBS 四数组）由各自适配器消化，op 层只看到中立名
 * `BrepEngineApi#sweep`。完整控制面（transition / auxSpine / support / 解析式 law /
 * orientation）只有 occt 能做，整体归 `cad.sweepAdvanced`（与 `sketchOnFace →
 * sketchOnSurface` 同构）。
 *
 * occt 侧**不用** `simplePipe`：实测它对 8×8 方截面沿 +Z 扫 50 产出体积 2133.33，
 * 而 `sweepPipeShell` 为解析值 3200（`test/api/sweep-loft.test.ts` 的真值断言）。
 *
 * ⚠️ 两内核在非平面路径上的截面参考系算法不同（RMF 细节差异），复杂路径下产物
 * 可能有细微差别；需要确定性行为用 `cad.sweepAdvanced`（occt）。
 */

import type { Shape } from '../mesh/types'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrep } from '../shape'
import { solidToShape } from '../brep/brep-ops'
import { toProfileWireView } from './internal/profile-wire'
import { unifyOrientation, weldVertices } from '../mesh/reconcile'

/**
 * 扫掠产物的网格出口：**绕序必须一致**（相邻三角形以相反方向遍历共享边）。
 *
 * 为什么修在出口而不是渲染层（真机证据 2026-10-21）：
 * 截面 29×27 沿一条「第一段 16.3mm、拐角偏转 35.7°」的折线扫掠时，拐角内侧的
 * 截面会扫过自身（截面半宽 × cot(拐角/2) ≈ 41mm ≫ 段长）。侧壁平面的边界曲线
 * 因此自交，brepkit 的扇形三角化把凹/自交多边形拆成**交错的三角形**，其中一部分
 * 以相同方向遍历共享边。渲染层用 `FrontSide` 单面剔除 ⇒ 朝向反的那片被剔掉，
 * 表面裂开一个大洞（用户报的"破面、不像实心"）；STL 查看器通常双面渲染，
 * 所以导出看着正常 —— 两个现象同源。
 *
 * 这是**网格契约**，不属于某一个 op：任何 BREP 转 mesh 的出口都该满足它。
 * faijs 早就有 `mesh/reconcile.ts` 的 `unifyOrientation`（焊接 → 绕序传播），
 * 缺的只是把它接到这里。
 *
 * 这不是实体验证：自交几何本来就不可修复成有效实体（该不该拦是上游的判定），
 * 但网格必须能正确单面渲染 —— 否则用户看到的洞会被误读成渲染器缺陷。
 * @param s - BREP 派生的 shape（positions/indices 来自内核三角化）。
 * @returns the same shape with an orientation-unified mesh.
 */
function withConsistentWinding(s: Shape): Shape {
  // 只做「焊接 + 绕序统一」，**不做退化剔除**：这两步都不改变三角形数量与顺序，
  // 因此 `materialGroups` 的 (start,count) 仍然有效。退化三角形交给渲染层
  // 的 crease 派生去处理，不在这里偷偷重排面序。
  const welded = weldVertices(s.positions, s.indices)
  const unified = unifyOrientation(welded.positions, welded.indices)
  // **就地替换载荷，不要 `{...s}`**：BREP 句柄挂在 runtime slots 上、以 shape
  // **对象引用**为键（`shape.ts:480 brepOf`），换新对象会让 brepOf 返回 undefined，
  // 下游 getBoundingBox / getVolume 直接崩。
  s.positions = unified.positions
  s.indices = unified.indices
  return s
}

/** BREP 路径：截面沿脊柱扫掠（两引擎经 L1 中立名 `BrepEngineApi#sweep` 分派）。 */
function sweepBrep(profile: Shape, spine: Shape): Shape {
  if (!profile) throw new Error('E_SWEEP_NO_PROFILE: sweep requires a profile (section) shape')
  if (!spine) throw new Error('E_SWEEP_NO_SPINE: sweep requires a spine (path) shape')
  // 截面 / 脊柱：wire 直用；面取外环（孔环不参与扫掠）。
  const profileWire = toProfileWireView(profile)
  const spineWire = toProfileWireView(spine)
  const kernel = getBrepApi()
  try {
    const h = kernel.sweep(profileWire.wrapped, spineWire.wrapped)
    return withConsistentWinding(fromBrep(solidToShape(kernel, h), { solid: h }))
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    throw new Error(`E_SWEEP_FAILED: sweep failed: ${raw}`, { cause: e })
  } finally {
    // 面→外环产出的 wire 是 arena 新句柄（曲线借用不 release）
    if (!profileWire.borrowed) {
      try { kernel.release(profileWire.wrapped) } catch { /* 已释放 */ }
    }
    if (!spineWire.borrowed) {
      try { kernel.release(spineWire.wrapped) } catch { /* 已释放 */ }
    }
  }
}

/**
 * 扫掠：截面沿脊柱路径生成扫掠体。
 * @group 特征
 * @inputs 2
 * @async true
 * @qual ok
 * @name sweep
 * @note 基础 op：**occt 与 brepkit 两内核都支持**（occt `sweepPipeShell`；brepkit
 *       `sweep(face, NURBS path)`，路径由适配器从脊柱 wire 拟合）。截面接受 wire
 *       或面（面取其外环）；脊柱必须为 wire。选项集 = 两内核交集 = **空** ——
 *       需要 transition / auxSpine / support / law / orientation 等 occt 独有控制面
 *       时用 `cad.sweepAdvanced`。
 * @returns Shape 扫掠体。
 * @param profile - 截面几何（wire 或面；面取其外环）。type:Shape required:true
 * @param spine - 脊柱路径（wire）。type:Shape required:true
 * @example
 * const path = cad.wire([[0, 0, 0], [0, 0, 50]])
 * const section = cad.profile({ contours: [{ segments: [
 *   { kind: 'line', x1: -4, y1: -4, x2: 4, y2: -4 },
 *   { kind: 'line', x1: 4, y1: -4, x2: 4, y2: 4 },
 *   { kind: 'line', x1: 4, y1: 4, x2: -4, y2: 4 },
 *   { kind: 'line', x1: -4, y1: 4, x2: -4, y2: -4 },
 * ] }] })
 * const body = cad.sweep(section, path)
 */
export const sweep = defineOp({
  name: 'sweep',
  brep(profile: Shape, spine: Shape) {
    return sweepBrep(profile, spine)
  },
  naming: { kind: 'unmodeled', reason: 'swept-body face vocabulary not defined' } as Provenance,

  paramDims: {},
})
