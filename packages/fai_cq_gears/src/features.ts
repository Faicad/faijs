/**
 * features — 裸齿轮之上的布尔特征（倒角 / 轴孔 / 凹槽 / 轮毂 / 轮辐）
 *
 * 复刻 cq_gears `GearBase._make_chamfer` / `_make_bore`（A1 尖峰
 * `scripts/spike-chamfer.ts` 已验证：spur 裸体 + chamfer0.5 + bore1 → 体积
 * 167.845620 对齐官方 167.8456187，rel 5.6e-9），以及 SpurGear 系的
 * `_make_recess` / `_make_hub` / `_make_spokes`（RingGear 无这些特征）。
 *
 * 实现要点（与 cq 逐字一致）：
 * - 倒角是 XZ 平面（法向 -Y）上的三角轮廓 → line-edge → wire → face → revolve 360°
 *   得到旋转体 cutter，再布尔差到裸齿轮；外部齿 / 内齿（ring）的 cutter 轮廓方向相反。
 * - 轴孔是贯穿圆柱 cut（轴心对齐 +Z，高度 = width + 2E 确保穿透）。
 * - 凹槽（recess）是顶/底面上的圆盘或圆环 pocket 布尔差（cq `cutBlind`，深度恰好
 *   = recess，与端面齐平——参考构建同款做法，OCCT 可处理共面 cut）。
 * - 轮毂（hub）是顶面上的圆环棱柱（bore_d 作内孔）布尔并（cq `extrude(hub_length)`）。
 * - 轮辐（spokes）是 r1..r2 之间的「直边 + 内外圆弧」窗口棱柱 cutter，绕 Z 轴
 *   逐个旋转 n_spokes 次布尔差；spoke_fillet 对 cutter 的竖直棱边做圆角。
 */

import type { BrepHandle, BrepVec3 } from '@faicad/faijs-core'
import type { GearKernel } from '@faicad/cq-compat'

/** cq `_make_chamfer` 的小偏移量（避免共面自交）。 */
export const CHAMFER_E = 0.01

/** 倒角量：标量 = 等边；`[wx, wy]` = 半径方向 / z 方向各自的去除量。 */
export type ChamferValue = number | [number, number]

/** 倒角 / 轴孔 / 凹槽 / 轮毂 / 轮辐相关构造选项（裸齿轮之上的镀铬特征）。 */
export interface GearFeatureOptions {
  /** 上下两边同时倒角（同量）。 */
  chamfer?: ChamferValue
  /** 顶面倒角量（覆盖 `chamfer`）。 */
  chamferTop?: ChamferValue
  /** 底面倒角量（覆盖 `chamfer`）。 */
  chamferBottom?: ChamferValue
  /** 轴孔直径（cq `bore_d`）。 */
  boreD?: number
  /** 删齿区间集合（cq `missing_teeth`，如 `[[0,10],[20,30]]`）。 */
  missingTeeth?: MissingTeethSpec
  /** 顶面轮毂直径（cq `hub_d`）。 */
  hubD?: number
  /** 轮毂自顶面向上的高度（cq `hub_length`，None=不建轮毂）。 */
  hubLength?: number
  /** 顶面凹槽深度（cq `recess`）。 */
  recess?: number
  /** 顶面凹槽直径（cq `recess_d`）。 */
  recessD?: number
  /** 底面凹槽深度（cq `bottom_recess`）。 */
  bottomRecess?: number
  /** 底面凹槽直径（cq `bottom_recess_d`，缺省用 `recessD`）。 */
  bottomRecessD?: number
  /** 底面轮毂直径（cq `bottom_hub_d`，缺省用 `hubD`）。 */
  bottomHubD?: number
  /** 轮辐数量（cq `n_spokes`，>1 才生效）。 */
  nSpokes?: number
  /** 轮辐宽度（cq `spoke_width`）。 */
  spokeWidth?: number
  /** 轮辐内径（cq `spokes_id`，缺省 = hub_d）。 */
  spokesId?: number
  /** 轮辐外径（cq `spokes_od`，缺省 = recess_d）。 */
  spokesOd?: number
  /** 轮辐圆角（cq `spoke_fillet`，对窗口 cutter 竖直棱边）。 */
  spokeFillet?: number
}

function point(u: number, v: number): BrepVec3 {
  return { x: u, y: 0, z: v }
}

/**
 * cq `_make_chamfer` 的旋转体 cutter 三角轮廓（XZ 平面，4 个顶点：末点=首点闭合重复）。
 *
 * ⚠️ 末点必须与首点相同：`makeChamferCutter` 用 `pts.slice(0, 3).map((p, i) => makeLineEdge(p, pts[i + 1]))`
 * 构造边，i=2 时 `pts[i + 1]` 取 `pts[3]`（即首点）才能闭合三角——这是 A1 尖峰验证过的写法。
 *
 * @param ra 齿顶圆半径（外部齿=齿尖、内齿=内齿尖）
 * @param width 齿宽
 * @param wx 沿半径方向的去除量
 * @param wy 沿 z 方向的去除量
 * @param which 顶面 / 底面
 * @param isRing 内齿（true）使用与 cq `ring_gear.py` 一致的相反轮廓
 */
function chamferProfile(
  ra: number, width: number, wx: number, wy: number, which: 'top' | 'bottom', isRing: boolean,
): [BrepVec3, BrepVec3, BrepVec3, BrepVec3] {
  if (isRing) {
    const top: [BrepVec3, BrepVec3, BrepVec3] = [
      point(ra - CHAMFER_E, width - wy), point(ra - CHAMFER_E, width + CHAMFER_E), point(ra + wx, width + CHAMFER_E),
    ]
    const bottom: [BrepVec3, BrepVec3, BrepVec3] = [
      point(ra + wx, -CHAMFER_E), point(ra - CHAMFER_E, -CHAMFER_E), point(ra - CHAMFER_E, wy),
    ]
    const p = which === 'top' ? top : bottom
    return [p[0], p[1], p[2], p[0]]
  }
  const top: [BrepVec3, BrepVec3, BrepVec3] = [
    point(ra - wx, width + CHAMFER_E), point(ra + CHAMFER_E, width + CHAMFER_E), point(ra + CHAMFER_E, width - wy),
  ]
  const bottom: [BrepVec3, BrepVec3, BrepVec3] = [
    point(ra + CHAMFER_E, wy), point(ra + CHAMFER_E, -CHAMFER_E), point(ra - wx, -CHAMFER_E),
  ]
  const p = which === 'top' ? top : bottom
  return [p[0], p[1], p[2], p[0]]
}

/**
 * 生成单个倒角 cutter 旋转体（A1 已验证的几何）。
 *
 * 轮廓取自 {@link chamferProfile}，绕全局 Z 转 360° 成体，供 `applyChamfer` 布尔差。
 *
 * @param kernel 原始 OCCT 内核
 * @param ra 齿顶圆半径（外部齿=齿尖、内齿=内齿尖）
 * @param width 齿宽
 * @param wx 沿半径方向的去除量
 * @param wy 沿 z 方向的去除量
 * @param which 顶面 / 底面（决定用哪一支轮廓）
 * @param isRing 内齿（true）使用与 cq `ring_gear.py` 一致的相反轮廓
 * @returns 绕 Z 轴 360° 回转得到的 cutter 实体句柄
 */
export function makeChamferCutter(
  kernel: GearKernel,
  ra: number, width: number, wx: number, wy: number,
  which: 'top' | 'bottom', isRing: boolean,
): BrepHandle {
  const pts = chamferProfile(ra, width, wx, wy, which, isRing)
  // 与 A1 尖峰完全一致：取前 3 顶点 → 2 条边，i=2 时 `pts[3]`（=首点）闭合三角 → wire → face → revolve 360°。
  const edges = pts.slice(0, 3).map((p, i) => kernel.makeLineEdge(p, pts[i + 1]))
  const wire = kernel.makeWire(edges)
  const face = kernel.makeFace(wire)
  return kernel.revolve(face, { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }, Math.PI * 2)
}

function resolveChamfer(spec: ChamferValue | undefined): [number, number] | undefined {
  if (spec === undefined) return undefined
  return Array.isArray(spec) ? [spec[0], spec[1]] : [spec, spec]
}

/**
 * 内核 `BRepAlgoAPI_Cut` 有时会多包一层 compound 外壳（即使结果只是单个实体，
 * 内齿 cutter 即此情况；外部齿则直接返回 solid）。这里把「仅含 1 个 solid 的 compound」
 * 解包成 solid，与 `fixFaceOrientations` 的思路一致，避免调用方无谓地判非 solid。
 *
 * @returns 解包后的 solid；若本就不是 compound 或含多块实体则原样返回（交给调用方校验）。
 */
function asSolid(kernel: GearKernel, shape: BrepHandle): BrepHandle {
  if (kernel.isSolid(shape)) return shape
  if (kernel.getShapeType(shape) === 'compound') {
    const solids = kernel.getSubShapes(shape, 'solid')
    if (solids.length === 1) return solids[0]
  }
  return shape
}

/**
 * 复刻 cq `_make_chamfer`：在裸齿轮实体上布尔差上/下倒角旋转体。
 *
 * @param kernel 原始 OCCT 内核
 * @param body 裸齿轮 solid
 * @param ra 齿顶圆半径
 * @param width 齿宽
 * @param opts 倒角选项（chamfer / chamferTop / chamferBottom）
 * @param isRing 内齿（使用 ring 版 cutter 轮廓）
 * @returns 倒角后的 solid（cutter 无效时显式抛错，不静默吞掉）
 */
export function applyChamfer(
  kernel: GearKernel,
  body: BrepHandle,
  ra: number,
  width: number,
  opts: GearFeatureOptions,
  isRing = false,
): BrepHandle {
  const top = resolveChamfer(opts.chamferTop ?? opts.chamfer)
  const bottom = resolveChamfer(opts.chamferBottom ?? opts.chamfer)
  let result = body
  if (top) {
    const cutter = makeChamferCutter(kernel, ra, width, top[0], top[1], 'top', isRing)
    if (!kernel.isValid(cutter)) {
      throw new Error(`applyChamfer: top cutter invalid (ra=${ra}, width=${width}, wx=${top[0]}, wy=${top[1]})`)
    }
    result = asSolid(kernel, kernel.cut(result, cutter))
  }
  if (bottom) {
    const cutter = makeChamferCutter(kernel, ra, width, bottom[0], bottom[1], 'bottom', isRing)
    if (!kernel.isValid(cutter)) {
      throw new Error(`applyChamfer: bottom cutter invalid (ra=${ra}, width=${width}, wx=${bottom[0]}, wy=${bottom[1]})`)
    }
    result = asSolid(kernel, kernel.cut(result, cutter))
  }
  return result
}

/**
 * 复刻 cq `_make_bore`：贯穿圆柱 cut（轴心对齐 +Z，高度 = width + 2E 确保穿透）。
 *
 * @param kernel 原始 OCCT 内核
 * @param body 实体
 * @param boreD 轴孔直径（cq `bore_d`）
 * @param width 齿宽
 * @returns 带轴孔的 solid
 */
export function applyBore(
  kernel: GearKernel,
  body: BrepHandle,
  boreD: number,
  width: number,
): BrepHandle {
  const cyl = kernel.makeCylinder(boreD / 2, width + 2 * CHAMFER_E)
  const moved = kernel.translate(cyl, 0, 0, -CHAMFER_E)
  return asSolid(kernel, kernel.cut(body, moved))
}

/**
 * 复刻 cq `_make_recess`：顶/底面上的圆盘或圆环 pocket 布尔差。
 *
 * cq 语义（逐字对齐 `spur_gear.py::_make_recess`）：
 * - 仅在传了 `recess`/`bottom_recess` 深度时生效；`recess_d` 缺失应报错（assert）。
 * - 顶面：外径 = recess_d 的圆盘 pocket，深度恰好 = recess（cutBlind(-recess)）；
 *   有 hub_d 时改为**圆环** pocket（外 recess_d、内 hub_d）——轮毂在 recess 之后
 *   由 `_make_hub` 另行 fuse，故这里挖掉的只是轮毂之外的环槽。
 * - 底面：bottom_recess_d / bottom_hub_d 缺省时分别回退 recess_d / hub_d。
 * - 深度与端面齐平（cutter 顶面在 z=width / z=0），与参考构建一致，共面 cut OCCT 可处理。
 *
 * @param kernel 原始 OCCT 内核
 * @param body 实体（裸齿轮，含 bore 之后的形态）
 * @param width 齿宽
 * @param opts recess / recessD / hubD / bottomRecess / bottomRecessD / bottomHubD
 * @returns 挖槽后的 solid
 */
export function applyRecess(
  kernel: GearKernel,
  body: BrepHandle,
  width: number,
  opts: GearFeatureOptions,
): BrepHandle {
  let result = body
  const ring = (outerD: number, innerD: number | undefined, z0: number, depth: number): BrepHandle => {
    const outer = kernel.makeCylinder(outerD / 2, depth)
    const at = kernel.translate(outer, 0, 0, z0)
    if (innerD === undefined) return at
    const inner = kernel.makeCylinder(innerD / 2, depth)
    return asSolid(kernel, kernel.cut(at, kernel.translate(inner, 0, 0, z0)))
  }
  if (opts.recess !== undefined && opts.recess > 0) {
    if (opts.recessD === undefined) {
      throw new Error('applyRecess: recess_d is not set (cq assert)')
    }
    const cutter = ring(opts.recessD, opts.hubD, width - opts.recess, opts.recess)
    if (!kernel.isValid(cutter)) {
      throw new Error(`applyRecess: top cutter invalid (recessD=${opts.recessD}, hubD=${String(opts.hubD)})`)
    }
    result = asSolid(kernel, kernel.cut(result, cutter))
  }
  if (opts.bottomRecess !== undefined && opts.bottomRecess > 0) {
    const d = opts.bottomRecessD ?? opts.recessD
    if (d === undefined) {
      throw new Error('applyRecess: bottom_recess_d (or recess_d) is not set (cq assert)')
    }
    const hub = opts.bottomHubD ?? opts.hubD
    const cutter = ring(d, hub, 0, opts.bottomRecess)
    if (!kernel.isValid(cutter)) {
      throw new Error(`applyRecess: bottom cutter invalid (d=${d}, hub=${String(hub)})`)
    }
    result = asSolid(kernel, kernel.cut(result, cutter))
  }
  return result
}

/**
 * 复刻 cq `_make_hub`：顶面上的圆环棱柱布尔并（hub_length 为 None 时不建模）。
 *
 * cq 语义（`spur_gear.py::_make_hub`）：在顶面 workplane 上，有 bore_d 时先画
 * 内孔圆，再画 hub_d/2 外圆并 `extrude(hub_length)`——得到的是**圆环**棱柱
 * （bore 贯穿轮毂），fuse 到主体上。
 *
 * @param kernel 原始 OCCT 内核
 * @param body 实体
 * @param width 齿宽（轮毂从 z=width 向上生长）
 * @param opts hubD / hubLength / boreD
 * @returns fuse 轮毂后的 solid
 */
export function applyHub(
  kernel: GearKernel,
  body: BrepHandle,
  width: number,
  opts: GearFeatureOptions,
): BrepHandle {
  if (opts.hubLength === undefined || opts.hubLength <= 0) return body
  if (opts.hubD === undefined) {
    throw new Error('applyHub: hub diameter is not set (cq assert)')
  }
  const outer = kernel.makeCylinder(opts.hubD / 2, opts.hubLength)
  const at = kernel.translate(outer, 0, 0, width)
  const hub = opts.boreD !== undefined
    ? asSolid(kernel, kernel.cut(at, kernel.translate(
        kernel.makeCylinder(opts.boreD / 2, opts.hubLength), 0, 0, width,
      )))
    : at
  if (!kernel.isValid(hub)) {
    throw new Error(`applyHub: hub invalid (hubD=${opts.hubD}, hubLength=${opts.hubLength})`)
  }
  return asSolid(kernel, kernel.fuse(body, hub))
}

/**
 * 复刻 cq `_make_spokes`：r1..r2 之间的「直边 + 内外圆弧」窗口棱柱 cutter，
 * 绕 Z 轴逐个旋转 n_spokes 次布尔差（n_spokes 为 None 时不建模）。
 *
 * cq 语义（`spur_gear.py::_make_spokes`，角度逐字一致）：
 * - r1 = max(spoke_width/2, spokes_id/2)（spokes_id 缺省 = hub_d）、r2 = spokes_od/2；
 * - 两端各收/放 ±0.0001 避免与内/外边界共面；
 * - a1 = asin(sw/2 / id/2)、a2 = asin(sw/2 / od/2)，a3 = tau − a2、a4 = tau − a1；
 * - 窗口轮廓 = 内弧(a1→a4, r1) − 直边(r1@a4 → r2@a3) − 外弧(r2: a3→a2, **顺时针**) −
 *   直边(r2@a2 → r1@a1)，即外弧反向走；
 * - 高度 = width + 1.0，从 z=-0.1 起完全穿透；spoke_fillet 对窗口的竖直棱边做圆角。
 *
 * 圆弧用 `makeArcEdge(start, mid, end)` 构造（三点定弧，几何精确，无 radiusArc
 * 的正负半径歧义）：外弧 a3→a2 取中点角 (a3+a2)/2。
 *
 * @param kernel 原始 OCCT 内核
 * @param body 实体
 * @param width 齿宽
 * @param opts nSpokes / spokeWidth / spokesId / spokesOd / spokeFillet / hubD / recessD
 * @returns 挖去全部轮辐窗口后的 solid
 */
export function applySpokes(
  kernel: GearKernel,
  body: BrepHandle,
  width: number,
  opts: GearFeatureOptions,
): BrepHandle {
  if (opts.nSpokes === undefined) return body
  const nSpokes = opts.nSpokes
  if (nSpokes <= 1) {
    throw new Error('applySpokes: number of spokes must be > 1 (cq assert)')
  }
  if (opts.spokeWidth === undefined) {
    throw new Error('applySpokes: spoke width is not set (cq assert)')
  }
  if (opts.spokesOd === undefined) {
    throw new Error('applySpokes: outer spokes diameter is not set (cq assert)')
  }
  // cq 语义：spokes_id 缺省 = hub_d；r1/r2 加减 0.0001 避免共面。
  const idD = opts.spokesId ?? opts.hubD
  const r1 = Math.max(opts.spokeWidth / 2, idD !== undefined ? idD / 2 : 0) + 0.0001
  const r2 = opts.spokesOd / 2 - 0.0001

  const tau = (Math.PI * 2) / nSpokes
  // cq 用 spokes_id/spokes_od（未缩的原始直径）算张角
  const a1 = Math.asin((opts.spokeWidth / 2) / (idD !== undefined ? idD / 2 : opts.spokeWidth / 2))
  const a2 = Math.asin((opts.spokeWidth / 2) / (opts.spokesOd / 2))
  const a3 = tau - a2
  const a4 = tau - a1

  // 窗口轮廓（与 cq 同构）：p1=(r1,a1) → p2=(r2,a2) 直边 → 外弧 p2→p3=(r2,a3)
  // （cq radiusArc 负半径=顺时针，即弧走大角度方向；此处外弧从 a2 到 a3 顺时针经
  // tau/2 中点）→ 直边 p3→p4=(r1,a4) → 内弧 p4→p1（radiusArc 正半径=逆时针，
  // 从 a4 回 a1 经 (a4+tau+a1)/2 方向的短弧……与 cq 几何等价的取法：内弧凸向圆心外）。
  const pt = (r: number, ang: number): BrepVec3 => ({ x: Math.cos(ang) * r, y: Math.sin(ang) * r, z: 0 })
  const p1 = pt(r1, a1)
  const p2 = pt(r2, a2)
  const p3 = pt(r2, a3)
  const p4 = pt(r1, a4)

  const edges: BrepHandle[] = [
    kernel.makeLineEdge(p1, p2),
    // 外弧 p2→p3：r2 圆上的短弧（窗口外边界落在外圆上），中点角 = (a2 + a3) / 2
    kernel.makeArcEdge(p2, pt(r2, (a2 + a3) / 2), p3),
    kernel.makeLineEdge(p3, p4),
    // 内弧 p4→p1：r1 圆上的短弧（窗口内边界落在内圆上，与 cq radiusArc(+r1)
    // 的凸向约定几何等价），中点角 = (a1 + a4) / 2。
    kernel.makeArcEdge(p4, pt(r1, (a1 + a4) / 2), p1),
  ]
  const wire = kernel.makeWire(edges)
  const face = kernel.makeFace(wire)
  let cutter = kernel.extrude(face, 0, 0, width + 1.0)
  cutter = kernel.translate(cutter, 0, 0, -0.1)

  if (opts.spokeFillet !== undefined && opts.spokeFillet > 0) {
    // cq `cutout.edges('|Z').fillet(spoke_fillet)`：对窗口棱柱的竖直棱边做圆角。
    // 用 bbox 中心识别竖直棱边（z 向棱边的两个端点 (x,y) 相同且非圆弧）。
    const vertEdges = kernel.getSubShapes(cutter, 'edge').filter((e) => {
      const t = kernel.curveType(e)
      if (t !== 'line') return false
      const { a, b } = edgeEndsOf(kernel, e)
      return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9
    })
    if (vertEdges.length > 0) {
      cutter = kernel.fillet(cutter, vertEdges, opts.spokeFillet)
    }
  }

  if (!kernel.isValid(cutter)) {
    throw new Error(
      `applySpokes: cutter invalid (nSpokes=${nSpokes}, r1=${r1}, r2=${r2}, fillet=${String(opts.spokeFillet)})`,
    )
  }

  let result = body
  for (let i = 0; i < nSpokes; i++) {
    const rotated = kernel.rotate(cutter, { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }, tau * i)
    result = asSolid(kernel, kernel.cut(result, rotated))
  }
  return result
}

/** 取边的两个端点（applySpokes 圆角竖直棱边识别用）。 */
function edgeEndsOf(kernel: GearKernel, edge: BrepHandle): { a: BrepVec3; b: BrepVec3 } {
  const { first, last } = kernel.curveParameters(edge)
  return { a: kernel.curvePointAtParam(edge, first), b: kernel.curvePointAtParam(edge, last) }
}

/** cq `_make_missing_teeth` 的删齿区间集合：`[[起始齿, 结束齿], …]`（含两端）。 */
export type MissingTeethSpec = Array<[number, number]>

/** applyMissingTeeth 所需的齿轮几何量（避免对 profile 的类型耦合）。 */
export interface MissingTeethGeom {
  /** 齿顶圆半径 */
  ra: number
  /** 齿根圆半径 */
  rd: number
  /** 齿距角 2π/z */
  tau: number
  /** 齿宽 */
  width: number
  /** 扭转角（弧度，helix_angle=0 时为 0） */
  twistAngle: number
}

/**
 * 复刻 cq `_make_teeth_cutout_wire`：删齿窗口的截面 wire（XY 平面，z=0）。
 *
 * cq 语义（`spur_gear.py::_make_teeth_cutout_wire`，角度逐字一致）：
 * - at1/at2 = 齿位角 + tau/2（窗口以齿槽中心对称），中点角 atm=(at1+at2)/2；
 * - 外径 rc = ra + 1.0（超出齿顶）、内径 rin = rd − 0.01（略低于齿根）；
 * - 轮廓 = 内弧(at1→at2, rin) − 直边(rin@at2 → rc@at2) − 外弧(at2→at1, rc) −
 *   直边(rc@at1 → rin@at1)；内外弧都走各自圆上的短弧（经 atm）。
 */
function missingTeethCutoutWire(
  kernel: GearKernel, ra: number, rd: number, tau: number, t1: number, t2: number,
): BrepHandle {
  const at1 = t1 * tau + tau / 2
  const at2 = t2 * tau + tau / 2
  const atm = (at1 + at2) / 2
  const rc = ra + 1.0
  const rin = rd - 0.01
  const pt = (r: number, a: number): BrepVec3 => ({ x: Math.cos(a) * r, y: Math.sin(a) * r, z: 0 })
  const edges: BrepHandle[] = [
    kernel.makeArcEdge(pt(rin, at1), pt(rin, atm), pt(rin, at2)),
    kernel.makeLineEdge(pt(rin, at2), pt(rc, at2)),
    kernel.makeArcEdge(pt(rc, at2), pt(rc, atm), pt(rc, at1)),
    kernel.makeLineEdge(pt(rc, at1), pt(rin, at1)),
  ]
  return kernel.makeWire(edges)
}

/**
 * 扭转扫掠 cutter 的多站截面（逼近 cq `twistExtrude` 的螺旋扫掠）。
 *
 * cq `twistExtrude(distance, angle)` 沿线性扭转律把截面从 z0 扫到 z0+distance：
 * 高度 h 处的截面绕 Z 轴旋转 angle·(h−z0)/distance。这里取 N 个站点，每站放一份
 * 「旋转 + 平移」的截面 wire 副本，`loft(ruled=false)` 平滑蒙皮。
 * case04/06 的总扭转仅 16°/8°，站距 ≤1° 时对切出体积的偏差远小于齿面 B-spline
 * 近似本身的误差。
 */
function twistCutoutSolid(
  kernel: GearKernel, wire0: BrepHandle, z0: number, height: number, totalAngleRad: number,
): BrepHandle {
  const n = Math.min(64, Math.max(8, Math.ceil((Math.abs(totalAngleRad) * 180) / Math.PI)))
  const axis = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }
  const stations: BrepHandle[] = []
  for (let i = 0; i <= n; i++) {
    const f = i / n
    let w = kernel.copy(wire0)
    if (f !== 0) w = kernel.rotate(w, axis, totalAngleRad * f)
    const z = z0 + height * f
    if (z !== 0) w = kernel.translate(w, 0, 0, z)
    stations.push(w)
  }
  return kernel.loft(stations, true, false)
}

/**
 * 复刻 cq `_make_missing_teeth` / `_remove_teeth`：按删齿区间切掉轮齿。
 *
 * cq 语义（`spur_gear.py`，逐字一致）：
 * - 每个区间 (t1, t2) 生成窗口 cutter（z=-0.1 起、高 width+0.2 完全穿透），逐个 cut；
 * - twist_angle = 0（直齿）：截面 `extrude` 直棱柱；
 * - twist_angle ≠ 0（斜齿/人字齿）：截面 `twistExtrude(width+0.2, degrees(-twist))`，
 *   本实现用多站旋转截面 loft 逼近（见 `twistCutoutSolid`）。
 *
 * @param kernel 原始 OCCT 内核
 * @param body 实体（cq `_build` 中位于 bore 之后、recess 之前）
 * @param geom 删齿所需几何量（ra/rd/tau/width/twistAngle）
 * @param spec 删齿区间集合
 * @returns 删齿后的 solid
 */
export function applyMissingTeeth(
  kernel: GearKernel,
  body: BrepHandle,
  geom: MissingTeethGeom,
  spec: MissingTeethSpec,
): BrepHandle {
  const z0 = -0.1
  const height = geom.width + 0.2
  let result = body
  for (const [t1, t2] of spec) {
    const wire = missingTeethCutoutWire(kernel, geom.ra, geom.rd, geom.tau, t1, t2)
    let cutter: BrepHandle
    if (geom.twistAngle === 0) {
      const face = kernel.makeFace(wire)
      cutter = kernel.extrude(face, 0, 0, height)
      cutter = kernel.translate(cutter, 0, 0, z0)
    } else {
      // cq `degrees(-self.twist_angle)`：负号 = 沿齿的螺旋方向扭转
      cutter = twistCutoutSolid(kernel, wire, z0, height, -geom.twistAngle)
    }
    if (!kernel.isValid(cutter)) {
      throw new Error(`applyMissingTeeth: cutter invalid (t1=${t1}, t2=${t2})`)
    }
    result = asSolid(kernel, kernel.cut(result, cutter))
  }
  return result
}
