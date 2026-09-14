/**
 * primitives.ts — 本包私有 extensions 层（方案 §6 W2 交付物）：
 * ≈ 上游 extensions.py 里各类 fastener 真正用到的构造路径，收敛成
 * 「kernel 原语 → 可复用几何操作」的一层。只依赖 kernel.ts 的 requireKernel()，
 * 不感知具体 fastener 类。
 *
 * 实测行为备注（kernel-conformance.test.ts probe 结论）：
 *  - revolve(wire) 内核直接闭合（与 cq「wire 旋转得旋转面」不同）——revolveProfile
 *    直接吃 wire，不再先 makeFace。**订正（W4 实测）**：闭合出的拓扑是 **shell 非 solid**，
 *    故 revolveProfile 内部补 `makeSolid`（详见其 JSDoc 与
 *    `scripts/kernel-nut-probe.ts` 段 7）。
 *  - loft(wires, isSolid, ruled) 可用——makeRuledSurface 缺失期的 §6 退化路径。
 */

import type { BrepHandle, BrepVec3 } from '@faicad/faijs-core'
import {
  requireKernel,
  type TessellateOptionsLite,
  type WarehouseAxis,
  type WarehouseKernel,
} from './kernel'

/** 本包内部统一经 WarehouseKernel 取用（requireKernel 返回基类，这里收窄）。 */
function k(): WarehouseKernel {
  return requireKernel() as WarehouseKernel
}

/**
 * cq `Wire.makeHelix` 等价：绕 +Z（axis 指定）的螺旋线。
 * @param origin - 螺旋线起点。
 * @param axis - 螺旋轴方向（一般为 `{x:0,y:0,z:1}`）。
 * @param pitch - 螺距（mm）。
 * @param height - 轴向高度（mm）。
 * @param radius - 螺旋半径（mm）。
 * @returns 螺旋 wire 句柄。
 */
export function makeHelix(
  origin: BrepVec3,
  axis: BrepVec3,
  pitch: number,
  height: number,
  radius: number,
): BrepHandle {
  return k().makeHelixWire(origin, axis, pitch, height, radius)
}

/**
 * 轮廓 wire 绕轴旋转（nut/screw/bearing 的主体构造）。
 *
 * ⚠️ **内核 `revolve` 返回的是 SHELL，不是 SOLID**（`scripts/kernel-nut-probe.ts` 段 7 实测：
 * 闭合 4 点轮廓旋转后 `getSubShapes(shape,'solid').length === 0`、`'shell'` 为 1）。
 * 上游 cq `Workplane.revolve()` 返回的是 Solid —— 本函数**必须补 `makeSolid`**，
 * 否则：
 *  1. 后续 `common` / `fuse` 拿 shell 当操作数会**静默给出错误实体**
 *     （实测 `common(nutShell, blank)` = 108.5043，而 `common(nutSolid, blank)` =
 *     302.2977 ＝ A 侧解析值 302.2977262431188，逐位一致）；
 *  2. 导出的 STEP 是 SHELL 而非 SOLID（A 侧 manifest `shapeType` 全是 `Solid`）。
 *
 * 定向经 {@link orientOutward} 兜底（`makeSolid` 的朝向不保证，与 {@link solidFromFaces}
 * 同款处理）。
 *
 * ⚠️ 本内核对 wire 旋转不校验闭合性（probe 段 3h：未闭合 wire 也被静默接受）——
 * 轮廓闭合由调用方保证；未闭合时 `makeSolid` 会抛错，这正是期望的响亮失败。
 * @param profile - 含轴平面内的闭合轮廓 wire。
 * @param axis - 旋转轴（{@link WarehouseAxis}）。
 * @param angleRad - 旋转角（弧度）。
 * @returns 旋转得到的**实体（solid）**句柄，朝向已翻正。
 */
export function revolveProfile(
  profile: BrepHandle,
  axis: WarehouseAxis,
  angleRad: number,
): BrepHandle {
  const kern = k()
  return orientOutward(kern.makeSolid(kern.revolve(profile, axis, angleRad)))
}

/**
 * cq `loft(ruled=True)` 等价：截面 wire 列 → 直纹实体（§6 退化路径）。
 * @param wires - 截面 wire 列（≥2 条）。
 * @returns 直纹放样实体句柄。
 */
export function loftRuled(wires: BrepHandle[]): BrepHandle {
  return k().loft(wires, true, true)
}

/**
 * 点列 → 逼近 B 样条曲线（thread 端部 fade 的参数曲线）。
 * @param points - 采样点列。
 * @param tolerance - 逼近残差容差（mm），默认 1e-6。
 * @returns 曲线（edge/wire）句柄。
 */
export function parametricCurve(points: BrepVec3[], tolerance = 1e-6): BrepHandle {
  return k().approximatePoints(points, tolerance)
}

/**
 * 点阵（rows×cols，行优先展平）→ B 样条曲面 face。
 * ⚠️ 内核实现是**逼近**而非插值，且有系统性外扩 —— 直纹带请改用 {@link ruledFace}。
 * @param points - 行优先展平的点阵（长度须为 rows×cols）。
 * @param rows - 行数。
 * @param cols - 列数。
 * @returns 曲面 face 句柄。
 */
export function bsplineFace(points: BrepVec3[], rows: number, cols: number): BrepHandle {
  return k().bsplineSurface(points, rows, cols)
}

/** faces → sew → shell → solid（thread 螺纹体的封壳步骤）。
 *
 *  ⚠️ 两条实测结论（W3 probe；回归锁 `kernel-pitfalls.test.ts`，复现台
 *  `scripts/kernel-pitfalls-probe.ts`）：
 *  1. **makeSolid 的朝向不可保证**：sew 6 张平面 face 成单壳后 makeSolid 实测体积
 *     为 **−8**（朝内）——朝向随面序变化，故本函数**必须**经 orientOutward 翻正。
 *  2. **容差**：默认 1e-3 与上游 `make_shell` 对齐。旧注释曾声称「1e-6 下完全不缝合
 *     （shells=0）」——**已订正**：平面壳与螺纹实体面集实测在 1e-6..1e-2 均可缝成单壳，
 *     该说法未复现，故不再作为选 1e-3 的理由（保留仅为对齐上游 + 给 B 样条端帽留余量）。
 * @param faces - 构成闭合壳的面列。
 * @param tolerance - sew 容差（mm），默认 1e-3（与上游 make_shell 对齐）。
 * @returns 缝合后朝向已翻正的实体句柄。
 */
export function solidFromFaces(faces: BrepHandle[], tolerance = 1e-3): BrepHandle {
  const kern = k()
  const shell = kern.sew(faces, tolerance)
  return orientOutward(kern.makeSolid(shell))
}

/**
 * 体积为负（实体朝内）时反转朝向；零体积视为缝合失败，显式抛错。
 * @param shape - 待检实体。
 * @returns 朝向朝外的同一实体（体积为正时原样返回）。
 */
export function orientOutward(shape: BrepHandle): BrepHandle {
  const v = k().getVolume(shape)
  if (v > 0) return shape
  if (v === 0)
    throw new Error('[fai-cq-warehouse] solidFromFaces: zero-volume solid — sewing failed')
  return k().reverseShape(shape)
}

/**
 * 平面 face 加厚成体（knurl 纹等薄面构造）。
 * @param face - 待加厚的面。
 * @param thickness - 厚度（mm，正负决定内/外偏）。
 * @param tolerance - 内核容差，默认 1e-6。
 * @returns 加厚得到的实体句柄。
 */
export function thickenFace(face: BrepHandle, thickness: number, tolerance = 1e-6): BrepHandle {
  return k().thicken(face, thickness, tolerance)
}

/**
 * 非平面 wire → face（HeatSetNut knurl；kernel 层原语，§3.4 备注）。
 * @param wire - 构成边界的 wire。
 * @returns 由该 wire 围成的面句柄。
 */
export function faceFromWire(wire: BrepHandle): BrepHandle {
  return k().makeNonPlanarFace(wire)
}

// ── 基础 wire 构造（各类 fastener 轮廓共用）────────────────────────────────

/**
 * 直线边（薄封装，语义与内核一致）。
 * @param a - 起点。
 * @param b - 终点。
 * @returns 直线边句柄。
 */
export function lineEdge(a: BrepVec3, b: BrepVec3): BrepHandle {
  return k().makeLineEdge(a, b)
}

/**
 * 三点圆弧边（起点 / 弧上一点 / 终点）—— cq `sagittaArc` / `threePointArc` 的落点。
 * @param a - 起点。
 * @param mid - 弧上一点（决定弧的凸向与半径）。
 * @param b - 终点。
 * @returns 圆弧边句柄。
 */
export function arcEdge(a: BrepVec3, mid: BrepVec3, b: BrepVec3): BrepHandle {
  return k().makeArcEdge(a, mid, b)
}

/**
 * 边列 → wire（**不**做去重与自动闭合，交给调用方控制）。
 *
 * ⚠️ 内核 `makeWire` **不校验连通性**：边序接不上时静默丢弃（`kernel-pitfalls.test.ts`
 * 陷阱 1 实测乱序 4 边 → 3 边），未闭合 wire 也被 `revolve` 静默接受（`kernel-nut-probe.ts`
 * 段 3h）。故轮廓闭合必须由调用方保证（见 {@link polygonWire} / nut 的 `profileWire`）。
 * @param edges - 首尾相接的边列。
 * @returns 由这些边构成的 wire 句柄。
 */
export function wireFromEdges(edges: BrepHandle[]): BrepHandle {
  return k().makeWire(edges)
}

/**
 * 折线闭合 wire（点列首尾自动闭合；若末点与首点重合则不复用该退化边）。
 * @param points - 折线顶点列。
 * @returns 闭合 wire 句柄。
 */
export function polygonWire(points: BrepVec3[]): BrepHandle {
  const kern = k()
  const pts = closeLoop(points)
  const edges: BrepHandle[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    edges.push(kern.makeLineEdge(a, b))
  }
  return kern.makeWire(edges)
}

/**
 * 去掉与首点重合的末点（闭合点列 → 唯一点列）。
 * ⚠️ 不去重会生成一条**零长边**，`makeLineEdge` 直接抛 `construction failed`
 * （W3 probe 实测；此处订正旧注释所说的 makeFace `No geometry` 报错点）。
 * @param points - 顶点列（末点可与首点重合）。
 * @returns 去掉退化末点后的点列（点数 <2 时原样返回）。
 */
export function closeLoop(points: BrepVec3[]): BrepVec3[] {
  if (points.length < 2) return points
  const a = points[0]!
  const b = points[points.length - 1]!
  const same = Math.abs(a.x - b.x) < 1e-12 && Math.abs(a.y - b.y) < 1e-12 && Math.abs(a.z - b.z) < 1e-12
  return same ? points.slice(0, -1) : points
}

/**
 * 4 点闭合多边形 face（螺纹端帽：apex0/apex1/root1/root0）。
 * @param corners - 按环序给出的 4 个角点。
 * @returns 四边形平面 face 句柄。
 */
export function quadFace(corners: [BrepVec3, BrepVec3, BrepVec3, BrepVec3]): BrepHandle {
  return k().makeFace(polygonWire(corners as BrepVec3[]))
}

/** 直纹带曲线拟合容差（mm）。取 1e-6 —— 与内核 `approximatePoints` 的残差同量级
 *  （实测该容差下直纹面外扩残差 ≈ 9.8e-7，远小于 1e-3 线性门禁）。 */
export const RULED_FIT_TOLERANCE = 1e-6

/**
 * 两条**同参数采样**曲线之间的直纹带 face —— cq `Face.makeRuledSurface` 的等价。
 *
 * ⚠️ 为什么**不用** `bsplineSurface([...rowA, ...rowB], 2, cols)`（W3 probe 实测否决）：
 * 内核的 `bsplineSurface` 是**逼近**而非插值，且带**系统性外扩**。实测两行采样点全部
 * 落在 r=3.000000000 时，出来的面 xmax=3.000369534（Δ=3.70e-4），且**与采样密度无关**
 * ——每圈 48→192 点、rows 2→9 全部收敛到 3.699e-4。对 Ø6 螺纹即 0.37‰ 半径超差，
 * 直接撞穿 1e-3 的 bbox 门禁（W3 中间验证实测 3 例 FAIL）。
 *
 * 现行路径：`approximatePoints(row, tol)` → `loft([wireA, wireB], isSolid=false, ruled=true)`。
 * 同一组点实测 xmax=3.000000982 → Δ=9.8e-7，比上面**小 375 倍**。
 *
 * 证据与判定见 docs/analysis/2026-09-14-cq-warehouse-thread-probe.md。
 * @param rowA - 第一条边界的同参数采样点列。
 * @param rowB - 第二条边界的采样点列（长度须与 rowA 相同）。
 * @param tolerance - 曲线逼近容差（mm），默认 {@link RULED_FIT_TOLERANCE}。
 * @returns 两行之间的单个直纹面 face 句柄。
 */
export function ruledFace(
  rowA: BrepVec3[],
  rowB: BrepVec3[],
  tolerance = RULED_FIT_TOLERANCE,
): BrepHandle {
  if (rowA.length !== rowB.length)
    throw new Error(`ruledFace: row sizes differ (${rowA.length} vs ${rowB.length})`)
  if (rowA.length < 2) throw new Error(`ruledFace: need ≥2 points per row (got ${rowA.length})`)
  const kern = k()
  const wireA = kern.makeWire([kern.approximatePoints(rowA, tolerance)])
  const wireB = kern.makeWire([kern.approximatePoints(rowB, tolerance)])
  const shell = kern.loft([wireA, wireB], false, true)
  const faces = kern.getSubShapes(shell, 'face')
  if (faces.length !== 1)
    throw new Error(`ruledFace: expected a single face from ruled loft, got ${faces.length}`)
  return faces[0]!
}

/**
 * XY 平面圆 wire（两段半圆弧）。
 * @param radius - 半径（mm）。
 * @param center - 圆心（默认原点）。
 * @returns 位于 z=center.z 的整圆 wire 句柄。
 */
export function circleWireXY(radius: number, center: BrepVec3 = { x: 0, y: 0, z: 0 }): BrepHandle {
  const kern = k()
  const a = { x: center.x + radius, y: center.y, z: center.z }
  const b = { x: center.x - radius, y: center.y, z: center.z }
  const top = { x: center.x, y: center.y + radius, z: center.z }
  const bottom = { x: center.x, y: center.y - radius, z: center.z }
  return kern.makeWire([kern.makeArcEdge(a, top, b), kern.makeArcEdge(b, bottom, a)])
}

/**
 * 含轴平面（XZ，圆心在 (centerR,0,z)）圆 wire——revolve 轮廓专用。
 * @param radius - 半径（mm）。
 * @param centerR - 圆心到旋转轴（Z 轴）的距离（mm）。
 * @param z - 圆心高度（mm），默认 0。
 * @returns XZ 平面内的整圆 wire 句柄。
 */
export function circleWireXZ(
  radius: number,
  centerR: number,
  z = 0,
): BrepHandle {
  const kern = k()
  const a = { x: centerR + radius, y: 0, z }
  const b = { x: centerR - radius, y: 0, z }
  const top = { x: centerR, y: 0, z: z + radius }
  const bottom = { x: centerR, y: 0, z: z - radius }
  return kern.makeWire([kern.makeArcEdge(a, top, b), kern.makeArcEdge(b, bottom, a)])
}

// ── 布尔 / 变换薄封装（各类 fastener 共用）──────────────────────────────────

/**
 * 平移（薄封装，语义与内核一致：毫米）。
 * @param shape - 待平移的体/面/边。
 * @param dx - X 方向位移（mm）。
 * @param dy - Y 方向位移（mm）。
 * @param dz - Z 方向位移（mm）。
 * @returns 平移后的新句柄（不改动入参）。
 */
export function translate(shape: BrepHandle, dx: number, dy: number, dz: number): BrepHandle {
  return k().translate(shape, dx, dy, dz)
}

/**
 * 原点起的长方体（`makeBox(dx,dy,dz)`：0→(dx,dy,dz)）。
 * @param dx - X 边长（mm）。
 * @param dy - Y 边长（mm）。
 * @param dz - Z 边长（mm）。
 * @returns 长方体实体句柄。
 */
export function makeBoxOrigin(dx: number, dy: number, dz: number): BrepHandle {
  return k().makeBox(dx, dy, dz)
}

/**
 * 布尔差 `a − b`。
 * @param a - 被减体。
 * @param b - 减去体。
 * @returns 差集实体句柄。
 */
export function cut(a: BrepHandle, b: BrepHandle): BrepHandle {
  return k().cut(a, b)
}

/**
 * 布尔交 `a ∩ b`。
 * @param a - 第一个体。
 * @param b - 第二个体。
 * @returns 交集实体句柄。
 */
export function intersect(a: BrepHandle, b: BrepHandle): BrepHandle {
  return k().common(a, b)
}

/**
 * 布尔并 `a ∪ b`。
 * @param a - 第一个体。
 * @param b - 第二个体。
 * @returns 并集实体句柄。
 */
export function fuse(a: BrepHandle, b: BrepHandle): BrepHandle {
  return k().fuse(a, b)
}

// ── W4（nut / screw 头型）所需的拉伸与钻孔原语 ──────────────────────────────

/**
 * 闭合平面 wire → 填充 face（`nut_plan` 拉伸前的必要一步）。
 *
 * ⚠️ 必须传 **face** 给 {@link extrudeFace}：probe 实测（`scripts/kernel-nut-probe.ts`
 * 段 1）`extrude(wire, 0,0,3)` 对 4×2 矩形返回体积 **−16**（错误），传 face 才得 24
 * （正确）。内核不校验输入拓扑，传错不抛错、只给错几何。
 * @param wire - 位于 XY 平面（或法向为 +Z）的闭合平面 wire。
 * @returns 填充后的平面 face 句柄。
 */
export function planarFace(wire: BrepHandle): BrepHandle {
  return k().makeFace(wire)
}

/**
 * 平面 face 沿 **+Z** 拉伸高度 `dz`（`cq .toPending().extrude(h)`）。
 *
 * ⚠️ 只支持沿面法向拉伸：probe 段 1 实测 `extrude(face, 1,0,0)`（XY 面沿面内 X 拉）与
 * `extrude(XZ wire, 0,0,3)`（面内 Z 拉）都退化为体积 0。nut_plan 在 XY 平面 + 沿 Z
 * 拉伸，正好落在有效路径上。
 * @param face - 位于 XY 平面（或法向为 +Z）的填充面。
 * @param dz - 拉伸高度（mm，可为负）。
 * @returns 拉伸实体句柄。
 */
export function extrudeFace(face: BrepHandle, dz: number): BrepHandle {
  return k().extrude(face, 0, 0, dz)
}

/**
 * 圆柱（底面在 z=0，轴向 +Z）—— probe 段 5 实测 `makeCylinder(3,10)` 的 bbox z = 0→10、
 * 体积 = π·9·10。
 * @param radius - 半径（mm）。
 * @param height - 高度（mm）。
 * @returns 圆柱实体句柄。
 */
export function cylinder(radius: number, height: number): BrepHandle {
  return k().makeCylinder(radius, height)
}

/**
 * 指定 z 区间内的圆柱（钻孔用；`zTo < zFrom` 时自动反向建体）。
 * @param radius - 半径（mm）。
 * @param zFrom - 起始高度（mm）。
 * @param zTo - 结束高度（mm）。
 * @returns 该 z 区间的圆柱实体句柄。
 */
export function cylinderBetween(radius: number, zFrom: number, zTo: number): BrepHandle {
  const c = k().makeCylinder(radius, Math.abs(zTo - zFrom))
  return translate(c, 0, 0, Math.min(zFrom, zTo))
}

/**
 * 圆锥/圆台（底面半径 `r1` 于 z=0，顶面半径 `r2` 于 z=height，轴 +Z）。
 * @param r1 - 底面半径（mm）。
 * @param r2 - 顶面半径（mm），取 0 得尖锥。
 * @param height - 高度（mm）。
 * @returns 圆台实体句柄。
 */
export function cone(r1: number, r2: number, height: number): BrepHandle {
  return k().makeCone(r1, r2, height)
}

/**
 * 包围盒对角线长度 —— cq `Workplane.largestDimension()` 的等价物。
 *
 * ⚠️ cq 的实现是 `shape.BoundingBox().DiagonalLength`（cadquery `cq.py`），即**盒子对角线**
 * 而非「最大边长」。BradTeeNut 的钻孔深度取此值（fastener 的 `_fastenerHole` 在
 * `depth=None` 时用 `self.largestDimension()`），实测 nut 侧 = √(36.3²+36.3²+16.5²)
 * = 53.922444（`scripts/probe-bradtee-decomposition.py`）。
 * @param shape - 待测体。
 * @returns 包围盒对角线长度（mm）。
 */
export function bboxDiagonal(shape: BrepHandle): number {
  const b = bboxOf(shape)
  return Math.hypot(b.xmax - b.xmin, b.ymax - b.ymin, b.zmax - b.zmin)
}

// ── 量测 ───────────────────────────────────────────────────────────────────

/** A 侧 `Shape.tessellate(tolerance, angularTolerance)` 的同一组参数
 *  （cadquery `tessellate` 默认 angularTolerance=0.1；`gen-reference.py` 传 tolerance=0.002）。 */
export const MESH_LINEAR_DEFLECTION = 0.002
/** 同一组参数里的角度容差（弧度），cadquery `tessellate` 默认 0.1。 */
export const MESH_ANGULAR_DEFLECTION = 0.1

/**
 * 三角化体积（有符号四面体求和）—— A 侧 manifest 里 `volume_mesh` 的等价量。
 *
 * ⚠️ 为什么体积必须另立 mesh 基准（W3 仲裁实测，2026-09-14）：
 * 内核 `getVolume`（= BRepGProp 精确曲面积分）对**螺旋 B 样条面**出现**求积混叠**。
 * A 侧 Thread raw/raw 实测：GProps=49.961532 / 三角化=43.680000（差 14%），且
 *   ① 随长度**非单调**（L=10→34.97、11→49.96、12→39.18）；
 *   ② 布尔分割**不可加**（两半 31.28 + 34.00 ≠ 49.96）；
 *   ③ 三角化在 deflection 0.05→0.0005 收敛到 43.688，且与 Pappus 解析（43.694）一致。
 * 故 GProps 是离群值，**以 mesh 为准**；`volumeOf`（GProps）仅作参考量。
 *
 * ⚠️ 调用顺序：`tessellate` 会**原地**给 shape 建三角化，之后任何按
 * `useTriangulation=true` 取包围盒的操作都会被污染（A 侧 manifest 曾因此偏大
 * 0.0126 mm）。**先量 bbox/质心，再调本函数。**
 * @param shape - 待测实体。
 * @param options - 覆盖默认线性/角度容差（一般不需要）。
 * @returns 三角化后的有符号体积（mm³）；朝内实体为负。
 */
export function meshVolume(
  shape: BrepHandle,
  options: TessellateOptionsLite = {},
): number {
  const mesh = k().tessellate(shape, {
    linearDeflection: MESH_LINEAR_DEFLECTION,
    angularDeflection: MESH_ANGULAR_DEFLECTION,
    ...options,
  })
  const p = mesh.positions
  const idx = mesh.indices
  let total = 0
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t]! * 3
    const b = idx[t + 1]! * 3
    const c = idx[t + 2]! * 3
    const ax = p[a]!
    const ay = p[a + 1]!
    const az = p[a + 2]!
    const bx = p[b]!
    const by = p[b + 1]!
    const bz = p[b + 2]!
    const cx = p[c]!
    const cy = p[c + 1]!
    const cz = p[c + 2]!
    total +=
      (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
  }
  return total
}

/**
 * GProps 精确曲面积分体积 —— ⚠️ 对螺旋 B 样条面会求积混叠（见 {@link meshVolume}），
 * 仅作参考量；判等价请用 `meshVolume`。
 * @param shape - 待测实体。
 * @returns 内核 `getVolume` 的原始值（mm³）。
 */
export function volumeOf(shape: BrepHandle): number {
  return k().getVolume(shape)
}

/**
 * 表面积（GProps）。
 * @param shape - 待测体/面。
 * @returns 表面积（mm²）。
 */
export function areaOf(shape: BrepHandle): number {
  return k().getSurfaceArea(shape)
}

/**
 * 精确包围盒（内核 `useTriangulation=false`）。
 * ⚠️ 仍须先取本值再调 {@link meshVolume}，避免三角化污染。
 * @param shape - 待测体/面。
 * @returns `{xmin,ymin,zmin,xmax,ymax,zmax}`（mm）。
 */
export function bboxOf(shape: BrepHandle): {
  xmin: number
  ymin: number
  zmin: number
  xmax: number
  ymax: number
  zmax: number
} {
  return k().getBoundingBox(shape)
}

// ── W5 screw 原语扩展（rotate / mirror / vertexPosition / draftPrism）───────

/**
 * 绕任意轴旋转（内核 `rotate`，弧度、右手）。
 * 实测：box 绕 Z 转 π/2 精确落位；edge 同样可旋转（hexalobular 六分之一轮廓
 * 的 polarArray 合成，上游 `edge.rotate` 等价）。
 * @param shape - 任意 shape/edge/vertex。
 * @param axis - 旋转轴（点 + 方向）。
 * @param angleRad - 弧度。
 * @returns 旋转后的新 handle。
 */
export function rotateAbout(shape: BrepHandle, axis: WarehouseAxis, angleRad: number): BrepHandle {
  return k().rotate(shape, axis, angleRad)
}

/**
 * 关于平面镜像（内核 `mirror`，点 + 法向）。
 * 锥度沉孔切割器 = draftPrism 向上收锥后关于 XY 面镜像翻转（上游
 * `extrude(-depth, taper)` 的语义等价替换，探针 §W5-probe11/12）。
 * @param shape - 待镜像 shape。
 * @param point - 镜像平面上一点。
 * @param normal - 镜像平面法向。
 * @returns 镜像后的新 handle。
 */
export function mirrorAbout(shape: BrepHandle, point: BrepVec3, normal: BrepVec3): BrepHandle {
  return k().mirror(shape, point, normal)
}

/**
 * 顶点坐标（内核 `vertexPosition`）。
 * @param vertex - 顶点 handle。
 * @returns 世界坐标。
 */
export function vertexAt(vertex: BrepHandle): BrepVec3 {
  return k().vertexPosition(vertex)
}

/**
 * 带拔模角的棱柱拉伸（内核 `draftPrism`，角度**度**）。
 * ⚠️ 截面随锥度收缩到自交时内核直接抛错（A 侧 LocOpe_DPrism 容忍退化）——
 * taper=30° 的 cross/R 沉孔因此是 W5 显式缺口（见 recess.ts 文件头）。
 * @param face - 拉伸截面（平面 face）。
 * @param dz - 拉伸高度（mm，正负皆可）。
 * @param angleDeg - 拔模角（度，0 = 直棱柱）。
 * @returns 拉伸实体。
 */
export function draftPrismFace(face: BrepHandle, dz: number, angleDeg: number): BrepHandle {
  return k().draftPrism(face, 0, 0, dz, angleDeg)
}

/**
 * 点列 → 插值 B 样条边（内核 `interpolatePoints`，cq `Workplane.spline` 等价：
 * 过点插值，非逼近）。
 * @param points - 插值点列（世界坐标）。
 * @returns B 样条 edge handle。
 */
export function interpolateEdge(points: BrepVec3[]): BrepHandle {
  return k().interpolatePoints(points)
}

/**
 * 点列 + 端点切向 → 插值三次 B 样条（`GeomAPI_Interpolate.Load(t0, t1, scale=True)`）。
 * A 侧实证（probe73 vs probe72）：PanHead M6/M4/M2.5 三规格极点逐位一致——
 * cq `Workplane.spline(tangents=…)` 对两点输入正是这条路径。
 * @param points - 两个插值点（起点、终点，世界坐标）。
 * @param startTangent - 起点切向（内核按 scale=True 处理，无需归一化）。
 * @param endTangent - 终点切向。
 * @returns B 样条 edge handle。
 */
export function interpolateEdgeWithTangents(
  points: [BrepVec3, BrepVec3],
  startTangent: BrepVec3,
  endTangent: BrepVec3,
): BrepHandle {
  return k().interpolatePointsWithTangents(points, startTangent, endTangent)
}

// ── cq 轮廓原语的纯几何复刻（全部 2D 平面点算术，零内核往返）──────────────

/**
 * cq `radiusArc` 的三点弧中点（`cq.py sagittaArc` 公式逐字复刻）。
 * 约定（上游 docstring）：闭合轮廓顺时针绘制；radius>0 = 凸弧，<0 = 凹弧。
 * @param p0 - 弧起点（2D）。
 * @param p1 - 弧终点（2D）。
 * @param radius - 半径（带符号，同 cq 约定）。
 * @returns 弧上中点（2D）——喂给内核 `makeArcEdge(start, mid, end)`。
 * @throws 当半径小于半弦长（弧够不着终点，同上游 ValueError）。
 */
export function radiusArcMidpoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  radius: number,
): { x: number; y: number } {
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y
  const length = Math.hypot(dx, dy) / 2
  if (Math.abs(radius) < length)
    throw new Error(`radiusArc: radius ${radius} too small for chord ${2 * length}`)
  // sag = |r| − √(r²−l²)（r²−l² 因浮点略负时按 0 处理，同上游 TOL 分支）
  const r2l2 = radius * radius - length * length
  let sag = Math.abs(radius)
  if (Math.abs(r2l2) >= 1e-7) sag -= Math.sqrt(Math.max(0, r2l2))
  // sagittaArc：mid = 弦中点 ± 弦向旋转 90° × |sag|。
  // ⚠️ 符号分支必须用 **radius** 的符号（cq radiusArc 按 radius>0/<0 向
  // sagittaArc 传 +sag/−sag），不是恒正的 |sag|——否则凹弧（负半径，如
  // hexalobular 的 −Ri 内弧）全部外凸，面积偏差 +28%（T30 实测 22.35 vs 17.52）。
  const ux = dx / (2 * length)
  const uy = dy / (2 * length)
  const sx = radius > 0 ? -uy * sag : uy * sag
  const sy = radius > 0 ? ux * sag : -ux * sag
  return { x: (p0.x + p1.x) / 2 + sx, y: (p0.y + p1.y) / 2 + sy }
}

/**
 * 两直线夹角处的圆角化（`Wire.fillet2D` 的线-线角几何复刻，§6 第 ② 类）。
 * 给定顶点 B 及其前后点 A、C，计算半径 r 的相切圆角：
 * 切点距 B 沿两边各 t = r/tan(θ/2)，圆心在角平分线上距 B 为 r/sin(θ/2)。
 * 凹角（材料在外）时圆弧向 B 鼓出 → 面积**增加**（A 侧 cross 沉孔
 * 11.262240 实证）。
 * @param a - 前一点。
 * @param b - 圆角顶点。
 * @param c - 后一点。
 * @param radius - 圆角半径。
 * @returns 切点 P1/P2 与弧中点 mid（2D）。
 * @throws 当半径超过任一边可用长度。
 */
export function filletCorner2D(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  radius: number,
): { p1: { x: number; y: number }; p2: { x: number; y: number }; mid: { x: number; y: number } } {
  const v1 = { x: a.x - b.x, y: a.y - b.y }
  const v2 = { x: c.x - b.x, y: c.y - b.y }
  const l1 = Math.hypot(v1.x, v1.y)
  const l2 = Math.hypot(v2.x, v2.y)
  const u1 = { x: v1.x / l1, y: v1.y / l1 }
  const u2 = { x: v2.x / l2, y: v2.y / l2 }
  const cosT = u1.x * u2.x + u1.y * u2.y
  const theta = Math.acos(Math.max(-1, Math.min(1, cosT)))
  const t = radius / Math.tan(theta / 2)
  if (t > l1 || t > l2)
    throw new Error(`fillet2D: radius ${radius} too large for corner edges (${l1}, ${l2})`)
  const p1 = { x: b.x + u1.x * t, y: b.y + u1.y * t }
  const p2 = { x: b.x + u2.x * t, y: b.y + u2.y * t }
  const bis = { x: u1.x + u2.x, y: u1.y + u2.y }
  const bl = Math.hypot(bis.x, bis.y)
  const d = radius / Math.sin(theta / 2)
  const ctr = { x: b.x + (bis.x / bl) * d, y: b.y + (bis.y / bl) * d }
  const mid = { x: ctr.x - (bis.x / bl) * radius, y: ctr.y - (bis.y / bl) * radius }
  return { p1, p2, mid }
}
