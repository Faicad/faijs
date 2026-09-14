/**
 * recess.ts — **W4 临时**的紧固件孔切割器（`clearanceHole` 的最小等价路径）。
 *
 * ## 为什么这个文件存在
 *
 * `BradTeeNut.custom_make`（fastener.py:734）要 `extensions.clearanceHole`，而
 * `extensions.py` 整体不移植（方案 §2.2）。方案 §8-W4 的去重表规定：
 * **W4 内以本地临时实现替代，命名带 `Temp` 前缀，W9·P1-b 落 `src/holes.ts` 正式版后
 * 必须替换并删除本文件。**
 *
 * ⚠️ **勿扩散引用**：本文件只服务 `nut.ts` 的 `bradTeeNut`。除它以外任何地方都不得 import。
 *
 * ## 复刻范围（只做 W4 真正走到的那条路径）
 *
 * 上游 `_fastenerHole`（extensions.py:865-1046）在 `clearanceHole(fastener=brad)` 的
 * 默认实参下走的是：`fit="Normal"`、`depth=None`、`counterSunk=True`、`captiveNut=False`、
 * `baseAssembly=None`、`hand=None`（非螺纹孔）、`clean=True`。本文件把这支路径逐字转写：
 *
 * | 上游 | 本包 |
 * |---|---|
 * | `countersink_cutter = countersink_profile.revolve().translate((0,0,-head_offset))` | {@link tempClearanceHoleCutter} 第 ① 段 |
 * | `shank_hole = Solid.makeCylinder(hole_radius, depth, origin, (0,0,-1))` | 第 ② 段（自 z=0 向 −Z 长 depth） |
 * | `drill_tip = Solid.makeCone(hole_radius, 0, h, (0,0,-depth), (0,0,-1))` | 第 ③ 段（82° 钻尖） |
 * | `fastener_hole = countersink_cutter.fuse(shank_hole).fuse(drill_tip)` | 三段 `fuse` |
 * | `self.cutEach(lambda loc: fastener_hole.moved(loc), True, False)` | `nut.ts` 侧按极坐标位置平移后 `cut` |
 *
 * ## 与上游的三处**已知**偏差（均不改变几何体积，见 W4 分析文档）
 *
 * 1. **不调 `clean()`**：`Shape.clean()` 是 OCCT `ShapeUpgrade_UnifySameDomain`，只合并
 *    同域面、不改体积；内核无对应封装（cq-compat parity 欠账，已记 backlog）。
 * 2. **不建 `null_object` 取 `hole_locations`**：上游用 1×1×1 占位盒 + `eachpoint` 反算
 *    位置，是因为它要走通用 Workplane 栈。本包直接算极坐标位置（等价且更直白）。
 * 3. **不做 `baseAssembly` 装配注入**：W4 用不到（上游该分支为 `None` 时也不执行）。
 *
 * ## 为什么只搬 `CounterSunkScrew` 的沉头轮廓
 *
 * `BradTeeNut.custom_make` 里的 `brad` 是 `CounterSunkScrew(...)`（**W5 的类**），
 * 但它在本路径上只被当作**参数载体**用两个属性：
 * `clearance_hole_diameters`（间隙孔表）与 `countersink_profile(fit)`（沉头轮廓）。
 * 本文件用 {@link tempCounterSunkCountersinkProfile} 复刻后者（逐字转写
 * fastener.py:1786-1798 的 90° 截锥），前者由 `params.clearanceHoleData` 直接提供。
 * W5 落地 `CounterSunkScrew` 后应改为调用其真实方法。
 */

import type { BrepHandle, BrepVec3 } from '@faicad/faijs-core'
import { fuse, polygonWire, revolveProfile, translate, cylinder, cone } from './primitives'

/** 旋转轴（+Z）。 */
const AXIS_Z = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }

/** 钻尖角（度）—— 上游 `_fastenerHole` 的 `cskAngle = 82`（extensions.py:975）。 */
export const DRILL_TIP_ANGLE = 82

/** 沉头轮廓（XZ 平面 `{r,z}` 点列，闭合，`r` 为到轴距离）。 */
export interface TempProfilePoint {
  r: number
  z: number
}

/**
 * `CounterSunkScrew.countersink_profile`（fastener.py:1786-1798）的临时等价实现 —— 90° 截锥。
 *
 * 上游逐字转写：`vLineTo(k)` → `hLineTo(dk/2)` → `polarLine(k/cos(a/2), -90-a/2)` → `close()`。
 * `polarLine` 语义见 `nut.ts` 的 `ProfileBuilder.polarLine`（cq `cq.py polarLine`）。
 *
 * ⚠️ 注意上游此方法**不读 `fit`**（与 `Screw.default_countersink_profile` 不同）：
 * 轮廓只由 `a`（头角）/`dk`（头径）/`k`（头高）决定。参数里的 `fit` 仅为签名对齐。
 * @param screwData - `countersunk_head_parameters.csv` 中该规格行的求值结果（含 a/dk/k）。
 * @param _fit - 配合等级（上游此路径未使用）。
 * @returns 截锥轮廓点列：`(0,0) → (0,k) → (dk/2,k) → (dk/2−k·tan(a/2), 0)`。
 */
export function tempCounterSunkCountersinkProfile(
  screwData: Record<string, number | string>,
  _fit: 'Close' | 'Normal' | 'Loose' = 'Normal',
): TempProfilePoint[] {
  const a = screwData['a']
  const dk = screwData['dk']
  const k = screwData['k']
  if (typeof a !== 'number' || typeof dk !== 'number' || typeof k !== 'number')
    throw new Error(
      `recess(Temp): countersunk screw data must be numeric (a/dk/k), got ${JSON.stringify({ a, dk, k })}`,
    )
  const half = (a * Math.PI) / 180 / 2
  const sideLength = k / Math.cos(half)
  const dir = ((-90 - a / 2) * Math.PI) / 180
  const endR = dk / 2 + sideLength * Math.cos(dir)
  const endZ = k + sideLength * Math.sin(dir)
  return [
    { r: 0, z: 0 },
    { r: 0, z: k },
    { r: dk / 2, z: k },
    { r: endR, z: endZ },
  ]
}

/** 沉孔切割器参数（上游 `_fastenerHole` 该路径的全部自由度）。 */
export interface TempClearanceHoleCutterParams {
  /** 沉头轮廓点列（{@link tempCounterSunkCountersinkProfile} 或等价的闭式轮廓）。 */
  countersinkProfile: TempProfilePoint[]
  /** 杆部（间隙）孔半径（mm）= `clearance_hole_diameters[fit] / 2`。 */
  holeRadius: number
  /** 孔深（mm）= 上游 `self.largestDimension()`（包围盒对角线，见 `bboxDiagonal`）。 */
  depth: number
  /** 钻尖角（度），默认 {@link DRILL_TIP_ANGLE}。 */
  cskAngle?: number
}

function toastWorld(p: TempProfilePoint): BrepVec3 {
  return { x: p.r, y: 0, z: p.z }
}

/**
 * 组装 `_fastenerHole` 的孔切割器实体（**局部坐标**：孔口在 z=0，孔轴向 −Z）。
 *
 * 调用方负责把它平移到每个孔位再 `cut`（上游 `cutEach(...)`）。
 * @param p - 切割器参数。
 * @returns 切割器实体句柄（沉头 + 杆部 + 钻尖三段的并集）。
 */
export function tempClearanceHoleCutter(p: TempClearanceHoleCutterParams): BrepHandle {
  const { countersinkProfile, holeRadius, depth } = p
  const cskAngle = p.cskAngle ?? DRILL_TIP_ANGLE
  const headOffset = Math.max(...countersinkProfile.map((q) => q.z))

  // ① 沉头：轮廓绕 +Z 旋转，再下移 head_offset → z ∈ [−headOffset, 0]
  const csk = translate(
    revolveProfile(polygonWire(countersinkProfile.map(toastWorld)), AXIS_Z, 2 * Math.PI),
    0,
    0,
    -headOffset,
  )

  // ② 杆部：自 z=0 向 −Z 长 depth（上游 makeCylinder(dir=(0,0,-1)) → z ∈ [−depth, 0]）
  const shank = translate(cylinder(holeRadius, depth), 0, 0, -depth)

  // ③ 钻尖：底半径 holeRadius 于 z=−depth，尖顶在 z=−depth−h
  const h = holeRadius / Math.tan(((cskAngle / 2) * Math.PI) / 180)
  const tip = translate(cone(0, holeRadius, h), 0, 0, -depth - h)

  return fuse(fuse(csk, shank), tip)
}
