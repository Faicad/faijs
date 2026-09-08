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

/** 判定「边是否落在某个 z 平面上」的容差（远小于 wire_comb_tol）。 */
const PLANAR_PICK_TOL = 1e-6

/** SpurGear 实体构造选项（在 `SplineFaceOptions` 上加容差与策略覆盖）。 */
export interface BuildSpurGearOptions extends SplineFaceOptions {
  strategy?: SplineFaceStrategy
  /** 缝合容差（cq `shell_sewing_tol`）。 */
  shellSewingTol?: number
  /** 组线容差（cq `wire_comb_tol`）。 */
  wireCombTol?: number
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
  wireCombTol = GEAR_BASE_CONSTANTS.wire_comb_tol,
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
  const strategy = build.strategy ?? DEFAULT_SPLINE_FACE_STRATEGY
  const geom = spurGearGeometry(params)
  const faces = buildToothFaces(kernel, geom, strategy, build)

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
      `buildSpurGearSolid: result is not a solid (got ${String(kernel.getShapeType(oriented))})`,
    )
  }
  return oriented
}
