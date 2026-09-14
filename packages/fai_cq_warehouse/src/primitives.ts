/**
 * primitives.ts — 本包私有 extensions 层（方案 §6 W2 交付物）：
 * ≈ 上游 extensions.py 里各类 fastener 真正用到的构造路径，收敛成
 * 「kernel 原语 → 可复用几何操作」的一层。只依赖 kernel.ts 的 requireKernel()，
 * 不感知具体 fastener 类。
 *
 * 实测行为备注（kernel-conformance.test.ts probe 结论）：
 *  - revolve(wire) 内核直接闭合成实体（与 cq「wire 旋转得旋转面」不同）——
 *    revolveProfile 直接吃 wire，不再先 makeFace。
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
 * ⚠️ 本内核对 wire 旋转直接闭合为实体（probe 实测），调用方传含轴平面轮廓即可。
 * @param profile - 含轴平面内的闭合轮廓 wire。
 * @param axis - 旋转轴（{@link WarehouseAxis}）。
 * @param angleRad - 旋转角（弧度）。
 * @returns 旋转得到的实体句柄。
 */
export function revolveProfile(
  profile: BrepHandle,
  axis: WarehouseAxis,
  angleRad: number,
): BrepHandle {
  return k().revolve(profile, axis, angleRad)
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
 *  ⚠️ 两条实测约束（W3 probe，`docs/analysis/2026-09-14-cq-warehouse-thread-probe.md`）：
 *  1. **容差不能用 1e-6**：本内核的 sew 在 1e-6 下完全不缝合（shells=0），
 *     随后 makeSolid 报 "compound has no valid shell"，getVolume 返回仅侧面贡献
 *     的伪值。1e-3 起可靠单壳（端帽是精确圆弧时）。
 *  2. sew 出来的实体**朝向不可靠**——朝向随侧面行序变化（±），必须翻正。
 * @param faces - 构成闭合壳的面列。
 * @param tolerance - sew 容差（mm），默认 1e-3（1e-6 下内核完全不缝合）。
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
 * 去掉与首点重合的末点（闭合点列 → 唯一点列）；退化边会让 makeFace 报
 * `BRepAdaptor_Curve::No geometry`（W3 probe 实测）。
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
