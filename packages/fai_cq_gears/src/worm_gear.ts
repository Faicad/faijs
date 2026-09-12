/**
 * worm_gear — Worm 蜗杆实体构造
 *
 * 对应 cq_gears `Worm._build_tooth_faces()` + `_build_gear_faces()` +
 * `make_shell` + `Solid.makeSolid`（`worm_gear.py`）。蜗杆轴向沿 **X**，
 * 齿面 = 齿条齿廓（与 RackGear 同构的梯形直线段）绕 X 轴的螺旋扫掠：
 *
 * ```
 * ① 4 段齿廓 × 8 个螺旋站位 → 4 张 8×2 点阵 B-spline 面（t_faces）
 * ② 每张面绕 X 转 −n·part_turn、平移 step_x·n（n=0,1）→ 8 张面（一个导程的 2 part）
 * ③ 每头绕 X 转 tau·th（th=0..n_threads-1），再沿 X 以 step 为周期平移 turns 份 → nfaces
 * ④ 端面 x=±length/2 处修剪越界面 + 由修剪边界边组端盖面
 * ⑤ sew(g_faces, shell_sewing_tol) → makeSolid → fixFaceOrientations → bore
 * ```
 *
 * 与 Python 的差异（有意为之，几何等价）：
 * - 端面截面不用 `GeomAPI_IntSS` 曲面求交：修剪后的面在 x=±L/2 处的边界边
 *   就是 IntSS 的交线，直接收集修剪面的平面边组线成面，曲线集相同。
 * - 越界修剪用 `kernel.split`（BRepAlgoAPI_Splitter）复刻 `face.split`：
 *   只在 bbox 越界时分割，按 Python 的选择规则取内侧片（左端取 xmax 最大片、
 *   右端取 xmin 最小片）。
 */

import type { BrepHandle } from '@faicad/faijs-core'
import type { RawOcctKernel } from './kernel'
import {
  wormGeometry,
  type ToothGrid, type WormGeometry, type WormParams,
} from './profile'
import { rotateRows, vec3 } from './math'
import {
  buildSplineFace,
  type SplineFaceOptions, type SplineFaceStrategy,
} from './spline-face'
import { connectEdgesToWires } from './geom-build'

/** Worm 覆写 GearBase 的类常量（`worm_gear.py` 类属性）。 */
const WORM_SURFACE_SPLINES = 8
const WORM_WIRE_COMB_TOL = 0.1
const WORM_T_FACE_PARTS = 2

/** 判定「边是否落在某个 x 平面上」的容差（与 spur_gear 的 PLANAR_PICK_TOL 同级）。 */
const PLANAR_PICK_TOL = 1e-6

/** Worm 实体构造选项。 */
export interface BuildWormOptions extends SplineFaceOptions {
  strategy?: SplineFaceStrategy
  /** 缝合容差（cq `shell_sewing_tol`，GearBase 默认 1e-2）。 */
  shellSewingTol?: number
  /** 组线容差（cq `wire_comb_tol`，Worm 覆写为 0.1）。 */
  wireCombTol?: number
  /** 轴孔直径（沿 X 轴贯穿，`Worm._make_bore`）。 */
  boreD?: number
}

/** 齿廓 4 段（顺序与 Python `_build_tooth_faces` 的循环一致）。 */
const WORM_SEGMENTS = ['lflank', 'tip', 'rflank', 'root'] as const

function segmentPoints(geom: WormGeometry, seg: (typeof WORM_SEGMENTS)[number]) {
  switch (seg) {
    case 'lflank': return geom.t_lflank_pts
    case 'tip': return geom.t_tip_pts
    case 'rflank': return geom.t_rflank_pts
    case 'root': return geom.t_root_pts
  }
}

/**
 * ①+②：一个导程内 2 part × 4 段 = 8 张螺旋齿面。
 *
 * 复刻 `Worm._build_tooth_faces`：每段齿廓（2 点直线）沿螺旋站位
 * `(tx, alpha) ~ linspace((start_x, 0), (start_x+step_x, part_turn), 8)`
 * 平移 `(tx, r0, 0)` 后绕 X 旋转（行向量左乘约定，见 `math.ts` 顶部说明），
 * 8×2 点阵建面；再按 part 拆分旋转/平移。
 *
 * @param kernel 原始 OCCT 内核
 * @param geom 蜗杆几何量
 * @param strategy 齿面建面策略
 * @param options 容差/次数选项
 * @returns 8 张齿面（Face）
 */
export function buildWormToothFaces(
  kernel: RawOcctKernel,
  geom: WormGeometry,
  strategy: SplineFaceStrategy,
  options: SplineFaceOptions = {},
): BrepHandle[] {
  const ttx = geom.m * Math.PI * geom.nThreads
  const startX = -ttx / 2.0
  const stepX = ttx / WORM_T_FACE_PARTS
  const partTurn = (Math.PI * 2.0) / WORM_T_FACE_PARTS * Math.sign(geom.leadAngle)

  // np.linspace((start_x, 0), (start_x + step_x, part_turn), surface_splines)
  const stations: Array<{ tx: number; alpha: number }> = []
  for (let i = 0; i < WORM_SURFACE_SPLINES; i++) {
    const f = i / (WORM_SURFACE_SPLINES - 1)
    stations.push({ tx: startX + stepX * f, alpha: partTurn * f })
  }

  const axisX = { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }

  const tFaces: BrepHandle[] = []
  for (const seg of WORM_SEGMENTS) {
    const spline = segmentPoints(geom, seg)
    // 每站位：spline + (tx, r0, 0)，再 @ rotation_matrix((1,0,0), alpha)
    const rows = stations.map(({ tx, alpha }) =>
      rotateRows(
        spline.map((p) => vec3(p.x + tx, p.y + geom.r0, p.z)),
        { x: 1, y: 0, z: 0 },
        alpha,
      ),
    )
    const grid: ToothGrid = { segment: seg, rows: rows.length, cols: rows[0].length, points: rows }
    tFaces.push(buildSplineFace(kernel, grid, strategy, options))
  }

  // for n in range(t_face_parts): rotate(-n·part_turn).translate((step_x·n, 0, 0))
  const faces: BrepHandle[] = []
  for (let n = 0; n < WORM_T_FACE_PARTS; n++) {
    for (const tf of tFaces) {
      let f = tf
      if (n !== 0) f = kernel.rotate(f, axisX, -n * partTurn)
      if (n !== 0) f = kernel.translate(f, stepX * n, 0, 0)
      faces.push(f)
    }
  }
  return faces
}

/**
 * ③+④：全齿面集合（多头 × 多圈 + 两端修剪 + 端盖面）。
 *
 * 复刻 `Worm._build_gear_faces`：
 * - `step = π·m·n_threads`（轴向导程），`turns = ceil(length/step) + 2`，
 *   起始平移 `step/2 + x_start + i·step`（x_start = −turns·step/2）；
 * - 每头先绕 X 转 `tau·th`（tau = 2π/n_threads），再按圈平移；
 * - x=±length/2 处修剪越界面（左端取 xmax 最大片 / 右端取 xmin 最小片，
 *   与 Python `max(get_xmax)` / `min(get_xmin)` 一致），并补两端盖面。
 *
 * @param kernel 原始 OCCT 内核
 * @param geom 蜗杆几何量
 * @param strategy 齿面建面策略
 * @param options 容差/次数选项
 * @returns 修剪后的全部面（含两端盖）
 */
export function buildWormGearFaces(
  kernel: RawOcctKernel,
  geom: WormGeometry,
  strategy: SplineFaceStrategy,
  options: SplineFaceOptions = {},
): BrepHandle[] {
  const step = Math.PI * geom.m * geom.nThreads
  const turns = Math.ceil(geom.length / step) + 2
  const xStart = (-turns * step) / 2.0
  const tau = (Math.PI * 2.0) / geom.nThreads

  const tFaces = buildWormToothFaces(kernel, geom, strategy, options)
  const axisX = { point: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }

  // 每头旋转 tau·th，再按圈平移 → nfaces
  // ⚠️ Python 是无条件 translate（含 i=0：dx = step/2 + x_start ≠ 0），
  //    不能像旋转 tau·0=0 那样跳过，否则第一组齿面整体错位。
  const nfaces: BrepHandle[] = []
  for (let th = 0; th < geom.nThreads; th++) {
    const rot = th === 0 ? tFaces : tFaces.map((f) => kernel.rotate(f, axisX, tau * th))
    for (let i = 0; i < turns; i++) {
      const dx = step / 2.0 + xStart + i * step
      for (const f of rot) nfaces.push(kernel.translate(f, dx, 0, 0))
    }
  }

  // 端面修剪：cp_size = ra·2+2 的方形截平面
  const half = geom.ra + 1.0
  const cpX = geom.length / 2.0
  const cutPlaneAt = (x: number): BrepHandle => {
    const c = vec3(x, -half, -half)
    const edges = [
      kernel.makeLineEdge(c, vec3(x, half, -half)),
      kernel.makeLineEdge(vec3(x, half, -half), vec3(x, half, half)),
      kernel.makeLineEdge(vec3(x, half, half), vec3(x, -half, half)),
      kernel.makeLineEdge(vec3(x, -half, half), c),
    ]
    return kernel.makeFace(kernel.makeWire(edges))
  }
  const leftPlane = cutPlaneAt(-cpX)
  const rightPlane = cutPlaneAt(cpX)

  const gFaces: BrepHandle[] = []
  for (const face of nfaces) {
    const bb = kernel.getBoundingBox(face)
    if (bb.xmin > -cpX && bb.xmax < cpX) {
      gFaces.push(face)
      continue
    }
    // ⚠️ Python `face.split` 只在平面真正切到面时返回 Compound（isinstance 检查），
    // 完全在端面之外的面被静默跳过——这里必须同样跳过，否则外部散面会撑破 shell。
    if (bb.xmin < -cpX && bb.xmax > -cpX) {
      // 左端越界：split 后取 xmax 最大的片（Python `max(list(cpd), key=get_xmax)`）
      const pieces = kernel.getSubShapes(kernel.split(face, [leftPlane]), 'face')
      let best: BrepHandle | undefined
      let bestX = -Infinity
      for (const p of pieces) {
        const x = kernel.getBoundingBox(p).xmax
        if (x > bestX) { bestX = x; best = p }
      }
      if (best) gFaces.push(best)
    } else if (bb.xmax > cpX && bb.xmin < cpX) {
      // 右端越界：取 xmin 最小的片（Python `min(list(cpd), key=get_xmin)`）
      const pieces = kernel.getSubShapes(kernel.split(face, [rightPlane]), 'face')
      let best: BrepHandle | undefined
      let bestX = Infinity
      for (const p of pieces) {
        const x = kernel.getBoundingBox(p).xmin
        if (x < bestX) { bestX = x; best = p }
      }
      if (best) gFaces.push(best)
    }
  }

  // 端盖面：从修剪后的保留面收集位于 x=±cpX 平面上的边界边 → 组线 → 成面。
  // split 生成的切边界边共享顶点、几何精确，比 kernel.section（对右端平面
  // 实测会漏交线）可靠；4 段 × 2 part 的截面曲线恰构成一条闭环。
  const capAt = (x: number): BrepHandle => {
    const edges: BrepHandle[] = []
    for (const f of gFaces) {
      for (const e of kernel.getSubShapes(f, 'edge')) {
        const bb = kernel.getBoundingBox(e)
        if (Math.abs(bb.xmin - x) <= PLANAR_PICK_TOL && Math.abs(bb.xmax - x) <= PLANAR_PICK_TOL) {
          edges.push(e)
        }
      }
    }
    if (edges.length === 0) {
      throw new Error(`buildWormGearFaces: no boundary edges found at x=${x}`)
    }
    const wires = connectEdgesToWires(kernel, edges, WORM_WIRE_COMB_TOL)
    if (wires.length === 0) {
      throw new Error(`buildWormGearFaces: no closed loop at x=${x} from ${edges.length} edges`)
    }
    // 接缝处可能产生小碎环（两条 wire）；确定性取 bbox 面积最大的环（真实端面边界）
    let cap = wires[0]
    if (wires.length > 1) {
      let bestArea = -1
      for (const w of wires) {
        const bb = kernel.getBoundingBox(w)
        const area = (bb.ymax - bb.ymin) * (bb.zmax - bb.zmin)
        if (area > bestArea) { bestArea = area; cap = w }
      }
    }
    return kernel.makeFace(kernel.healWire(cap, WORM_WIRE_COMB_TOL))
  }

  gFaces.push(capAt(-cpX))
  gFaces.push(capAt(cpX))
  return gFaces
}

/**
 * ①–⑤：完整 Worm 实体（裸蜗杆，可选轴孔）。
 *
 * @param kernel 原始 OCCT 内核
 * @param params 蜗杆参数（逐字沿用 Python 构造参数名）
 * @param build 构造选项（策略/容差覆盖）
 * @returns 朝向归一化后的 solid
 */
export function buildWormSolid(
  kernel: RawOcctKernel,
  params: WormParams,
  build: BuildWormOptions = {},
): BrepHandle {
  const geom = wormGeometry(params)
  // cq `Face.makeSplineApprox` 对整块点阵一次性拟合 —— 与 grid-approx
  // （GeomAPI_PointsToBSplineSurface）同族；逐行 loft 的行间误差在这里会被
  // 螺旋面放大（实测 rel≈1.4e-3 vs 参考体积），故 Worm 默认用 grid-approx。
  const strategy = build.strategy ?? 'grid-approx'
  const faces = buildWormGearFaces(kernel, geom, strategy, build)

  // 蜗杆齿面是逐段独立逼近的 B-spline 面，相邻面边界只有 ~spline_approx_tol
  // （0.01）量级的贴合度，实测接缝间隙 ≈0.0105 恰好卡在 cq shell_sewing_tol=0.01
  // 之上导致 sew 不封闭，故把缝合容差放宽到 0.05（几何不变，仅拓扑容差）。
  const solid = kernel.sewAndSolidify(faces, build.shellSewingTol ?? 0.05)
  const oriented = kernel.fixFaceOrientations(solid)
  if (!kernel.isSolid(oriented)) {
    throw new Error(
      `buildWormSolid: result is not a solid (got ${String(kernel.getShapeType(oriented))})`,
    )
  }

  // `Worm._make_bore`：YZ 工作面圆 + cutThruAll ⇒ 沿 X 轴贯穿的圆柱差
  let result = oriented
  if (build.boreD !== undefined) {
    const eps = 0.1
    const cyl = kernel.makeCylinder(build.boreD / 2, geom.length + 2 * eps)
    const alongX = kernel.rotate(
      cyl,
      { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
      Math.PI / 2,
    )
    result = kernel.cut(result, kernel.translate(alongX, -(geom.length / 2 + eps), 0, 0))
    if (!kernel.isSolid(result)) {
      throw new Error('buildWormSolid: result is not a solid after bore')
    }
  }
  return result
}
