/**
 * spur_gear — SpurGear 最小实体构造（P0/P1：裸齿轮，无 bore/hub/spokes/chamfer）
 *
 * 对应 `SpurGear._build_gear_faces()` + `make_shell` + `Solid.makeSolid`：
 *
 * ```
 * ① 4 段齿廓 → 4 个齿面（spline-face 三方案可切换）
 * ② 每个齿面绕 Z 旋转 tau*i，得到 z 个齿的 4z 个面
 * ③ 顶/底面：取所有位于 z=0 / z=width 的边 → 组线 → 成面
 * ④ sew(faces, shell_sewing_tol) → makeSolid(shell)
 * ```
 *
 * cq 用 `Wire.combine(edges, tol)` 组线（带容差排序）；faijs 侧用
 * `makeWire(edges)` + `healWire(wire, tol)` 复现，容差取同一个 `wire_comb_tol`。
 */

import type { BrepHandle } from '@faicad/faijs-core'
import type { RawOcctKernel } from './kernel'
import { GEAR_BASE_CONSTANTS } from './profile'
import { toothFaceGrids, type SpurGearGeometry, type SpurGearParams } from './profile'
import { spurGearGeometry } from './profile'
import {
  buildSplineFace, DEFAULT_SPLINE_FACE_STRATEGY,
  type SplineFaceOptions, type SplineFaceStrategy,
} from './spline-face'
import { connectEdgesToWires } from './geom-build'
import {
  applyChamfer, applyBore, applyRecess, applyHub, applySpokes, type GearFeatureOptions,
} from './features'

/** 判定「边是否落在某个 z 平面上」的容差（远小于 wire_comb_tol）。 */
const PLANAR_PICK_TOL = 1e-6

/** SpurGear 实体构造选项（在 `SplineFaceOptions` 上加容差、策略与镀铬特征覆盖）。 */
export interface BuildSpurGearOptions extends SplineFaceOptions, GearFeatureOptions {
  strategy?: SplineFaceStrategy
  /** 缝合容差（cq `shell_sewing_tol`）。 */
  shellSewingTol?: number
  /** 组线容差（cq `wire_comb_tol`）。 */
  wireCombTol?: number
  /** 人字齿：齿面沿宽度方向拆成上下两半、各以相反螺旋扭转（V 形）。 */
  herringbone?: boolean
}

/**
 * 把一批面中位于 `z` 平面上的边界边收集成一个平面盖面。
 *
 * @throws 内核抛错时原样上抛
 *
 * @param kernel 原始 OCCT 内核
 * @param faces 齿面集合（已含 z 向厚度）
 * @param z 目标平面高度
 * @param wireCombTol 组线容差（mm）
 * @returns 平面盖面（Face）
 */
export function planarCapAtZ(
  kernel: RawOcctKernel,
  faces: BrepHandle[],
  z: number,
  wireCombTol: number = GEAR_BASE_CONSTANTS.wire_comb_tol,
): BrepHandle {
  const edges: BrepHandle[] = []
  for (const f of faces) {
    for (const e of kernel.getSubShapes(f, 'edge')) {
      const bb = kernel.getBoundingBox(e)
      if (Math.abs(bb.zmin - z) <= PLANAR_PICK_TOL && Math.abs(bb.zmax - z) <= PLANAR_PICK_TOL) {
        edges.push(e)
      }
    }
  }
  if (edges.length === 0) {
    throw new Error(`planarCapAtZ: no boundary edges found at z=${z}`)
  }
  const wires = connectEdgesToWires(kernel, edges, wireCombTol)
  if (wires.length !== 1) {
    throw new Error(
      `planarCapAtZ: expected one closed loop at z=${z}, got ${wires.length} wires from ${edges.length} edges`,
    )
  }
  return kernel.makeFace(kernel.healWire(wires[0], wireCombTol))
}

/** ①+②：4z 个齿面（不含顶/底面）。
 *
 * @param kernel 原始 OCCT 内核
 * @param geom 齿轮几何量
 * @param strategy 齿面建面策略
 * @param options 容差/次数选项
 * @returns 齿面列表（4z 个 Face）
 */
export function buildToothFaces(
  kernel: RawOcctKernel,
  geom: SpurGearGeometry,
  strategy: SplineFaceStrategy,
  options: SplineFaceOptions = {},
): BrepHandle[] {
  const grids = toothFaceGrids(geom)
  const base = grids.map((grid) => buildSplineFace(kernel, grid, strategy, options))

  const faces: BrepHandle[] = []
  const axis = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }
  for (let i = 0; i < geom.z; i++) {
    const angle = geom.tau * i
    for (const f of base) {
      faces.push(i === 0 ? f : kernel.rotate(f, axis, angle))
    }
  }
  return faces
}

/**
 * ①+②：人字齿（Herringbone）的 8z 个齿面（上下两半 V 形）。
 *
 * 对应 cq_gears `HerringboneGear._build_tooth_faces`：调父类两次，
 * 上半 `(0, +twist, 0, w/2)`、下半 `(+twist, 0, w/2, w/2)`，两半在 z=w/2 处
 * 以相同扭转角衔接（点集重合，sew 自动并合）。
 *
 * @param kernel 原始 OCCT 内核
 * @param geom 齿廓几何量
 * @param strategy 齿面建面策略
 * @param options 容差/次数选项
 * @returns 齿面列表（8z 个 Face：4 段 × 2 半 × z 齿）
 */
export function buildHerringboneToothFaces(
  kernel: RawOcctKernel,
  geom: SpurGearGeometry,
  strategy: SplineFaceStrategy,
  options: SplineFaceOptions = {},
): BrepHandle[] {
  const w = geom.width
  // 上半：z ∈ [0, w/2]，扭转 0 → +twist；下半：z ∈ [w/2, w]，扭转 +twist → 0。
  const grids1 = toothFaceGrids(geom, 0, geom.twistAngle, 0, w / 2)
  const grids2 = toothFaceGrids(geom, geom.twistAngle, 0, w / 2, w / 2)
  const base1 = grids1.map((grid) => buildSplineFace(kernel, grid, strategy, options))
  const base2 = grids2.map((grid) => buildSplineFace(kernel, grid, strategy, options))

  const faces: BrepHandle[] = []
  const axis = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }
  for (let i = 0; i < geom.z; i++) {
    const angle = geom.tau * i
    for (const f of base1) faces.push(i === 0 ? f : kernel.rotate(f, axis, angle))
    for (const f of base2) faces.push(i === 0 ? f : kernel.rotate(f, axis, angle))
  }
  return faces
}

/** ③–④：由**已算好**的齿廓几何量构造裸齿轮实体（SpurGear 全族共用）。
 *
 * 与类无关：只吃 `SpurGearGeometry`（Spur / Herringbone / CrossedHelical 的齿廓布局
 * 同构），所以子类（如 CrossedHelical）只要先用自己的公式算出 `geom`，即可复用它。
 *
 * @param kernel 原始 OCCT 内核
 * @param geom 齿廓几何量（`spurGearGeometry` / `crossedHelicalGearGeometry` 的产物）
 * @param build 构造选项（策略/容差覆盖）
 * @returns 朝向归一化后的 solid
 */
export function buildGearSolid(
  kernel: RawOcctKernel,
  geom: SpurGearGeometry,
  build: BuildSpurGearOptions = {},
): BrepHandle {
  const strategy = build.strategy ?? DEFAULT_SPLINE_FACE_STRATEGY
  const faces = build.herringbone
    ? buildHerringboneToothFaces(kernel, geom, strategy, build)
    : buildToothFaces(kernel, geom, strategy, build)

  const bottom = planarCapAtZ(kernel, faces, 0, build.wireCombTol)
  const top = planarCapAtZ(kernel, faces, geom.width, build.wireCombTol)
  const all = [...faces, top, bottom]

  const shell = kernel.sew(all, build.shellSewingTol ?? GEAR_BASE_CONSTANTS.shell_sewing_tol)
  const solid = kernel.makeSolid(shell)

  // `sew` 不保证面朝向一致（实测 2026-09-08：loft 蒙皮得到的齿面法向朝内，
  // 缝出的实体体积为 −1111.7107）。`fixFaceOrientations` 是拓扑朝向归一化，
  // 不改变几何——用它而不是去改面的构造方式。
  const oriented = kernel.fixFaceOrientations(solid)
  if (!kernel.isSolid(oriented)) {
    throw new Error(
      `buildGearSolid: result is not a solid (got ${String(kernel.getShapeType(oriented))})`,
    )
  }

  // 镀铬特征：cq `_build` 顺序 chamfer → bore → recess → hub → spokes，
  // 全部是在完整体上的布尔差/并，故放在 sew+makeSolid 之后。
  let result = oriented
  if (build.chamfer !== undefined || build.chamferTop !== undefined || build.chamferBottom !== undefined) {
    result = applyChamfer(kernel, result, geom.ra, geom.width, build, false)
  }
  if (build.boreD !== undefined) {
    result = applyBore(kernel, result, build.boreD, geom.width)
  }
  if (build.recess !== undefined || build.bottomRecess !== undefined) {
    result = applyRecess(kernel, result, geom.width, build)
  }
  if (build.hubLength !== undefined) {
    result = applyHub(kernel, result, geom.width, build)
  }
  if (build.nSpokes !== undefined) {
    // cq 语义：spokes_id 缺省 = hub_d、spokes_od 缺省 = recess_d
    result = applySpokes(kernel, result, geom.width, {
      ...build,
      spokesId: build.spokesId ?? build.hubD,
      spokesOd: build.spokesOd ?? build.recessD,
    })
  }
  if (!kernel.isSolid(result)) {
    throw new Error(
      `buildGearSolid: result is not a solid after features (got ${String(kernel.getShapeType(result))})`,
    )
  }
  return result
}

/** ①–④：完整 SpurGear 实体（裸齿轮）。
 *
 * @param kernel 原始 OCCT 内核
 * @param params 齿轮参数
 * @param build 构造选项（策略/容差覆盖）
 * @returns 朝向归一化后的 solid
 */
export function buildSpurGearSolid(
  kernel: RawOcctKernel,
  params: SpurGearParams,
  build: BuildSpurGearOptions = {},
): BrepHandle {
  return buildGearSolid(kernel, spurGearGeometry(params), build)
}

/** ①–④：完整 HerringboneGear 实体（人字齿，裸齿轮）。
 *
 * 齿廓数学与 SpurGear 同构（`gearGeometryForClass` 已分派到 `spurGearGeometry`），
 * 差异只在建面阶段：齿面沿宽度拆成上下两半、反向螺旋形成 V 形，由
 * `buildHerringboneToothFaces` 实现；顶/底盖面与 SpurGear 一致（z=0 与 z=width 处
 * 截面均为基准渐开线，净扭转回零）。
 *
 * @param kernel 原始 OCCT 内核
 * @param params 齿轮参数（逐字沿用 Python 构造参数名）
 * @param build 构造选项（策略/容差覆盖）
 * @returns 朝向归一化后的 solid
 */
export function buildHerringboneGearSolid(
  kernel: RawOcctKernel,
  params: SpurGearParams,
  build: BuildSpurGearOptions = {},
): BrepHandle {
  return buildGearSolid(kernel, spurGearGeometry(params), { ...build, herringbone: true })
}
