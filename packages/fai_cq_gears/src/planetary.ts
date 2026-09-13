/**
 * planetary — 行星轮系（PlanetaryGearset / HerringbonePlanetaryGearset）
 *
 * 对应 `ring_gear.py`：一个太阳轮 + n 个行星轮 + 一个内齿圈，按中心距均布装配。
 * 三件各自用现成的实体构造（`buildSpurGearSolid` / `buildRingGearSolid` 及其人字变体），
 * 差异只在**参数分配**与**装配定位**：
 *
 * ## 参数分配（PlanetaryGearset）
 * - `ring_z = sun_z + planet_z·2`（内齿圈齿数由太阳/行星决定）
 * - 太阳：`helix_angle`（给定）
 * - 行星：`helix_angle = -helix_angle`（旋向相反）
 * - 内齿圈：`helix_angle = -helix_angle`
 * - `orbit_r = sun.r0 + planet.r0`（行星公转半径）
 *
 * ## 装配定位（逐件，复刻 Python `assemble`）
 * - 太阳：仅在 `planet.z` 为**奇数**时绕 Z 转 `tau_sun/2`（否则恒等）；
 * - 行星 i：先绕 Z 自转 `tau_planet/2`，再平移到 `(cos(i·a)·orbit_r, sin(i·a)·orbit_r, 0)`，
 *   `a = 2π/n_planets`；
 * - 内齿圈：绕 Z 转 `tau_ring/2`。
 *
 * ⚠️ `cq.Location(Vector(p), Z, angle)` 的语义是「先绕原点 Z 转 angle，再平移 p」
 * （见 `pairs.ts` 文件头实测结论），故行星定位是 **rotate → translate**，不是反过来。
 *
 * HerringbonePlanetaryGearset 继承 PlanetaryGearset，仅把 `gear_cls = HerringboneGear`、
 * `ring_gear_cls = HerringboneRingGear`——即三件全部走人字齿构建。
 */

import type { BrepHandle } from '@faicad/faijs-core'
import type { GearKernel, GearAxis } from '@faicad/cq-compat'
import {
  spurGearGeometry, ringGearGeometry, type SpurGearGeometry, type RingGearParams,
} from './profile'
import {
  buildSpurGearSolid, buildHerringboneGearSolid, type BuildSpurGearOptions,
} from './spur_gear'
import { buildRingGearSolid, buildHerringboneRingGearSolid } from './ring_gear'

const Z_AXIS: GearAxis = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }

/** 行星轮系参数（逐字沿用 `PlanetaryGearset.__init__`）。 */
export interface PlanetaryGearsetParams {
  module: number
  sun_teeth_number: number
  planet_teeth_number: number
  width: number
  rim_width: number
  n_planets: number
  pressure_angle?: number
  helix_angle?: number
  clearance?: number
  backlash?: number
}

/** 行星轮系构造选项（扩展单体特征选项 + 装配开关）。 */
export interface BuildPlanetaryGearsetOptions extends BuildSpurGearOptions {
  /** 是否构建太阳轮（默认 true）。 */
  buildSun?: boolean
  /** 是否构建行星轮（默认 true）。 */
  buildPlanets?: boolean
  /** 是否构建内齿圈（默认 true）。 */
  buildRing?: boolean
  /** 是否为人字齿（HerringbonePlanetaryGearset 传 true）。 */
  herringbone?: boolean
}

/** 行星轮系的构建结果。 */
export interface PlanetaryGearsetBuild {
  sun?: BrepHandle
  planets: BrepHandle[]
  ring?: BrepHandle
  sunGeometry: SpurGearGeometry
  planetGeometry: SpurGearGeometry
  ringGeometry: SpurGearGeometry
  /** 行星公转半径（= sun.r0 + planet.r0）。 */
  orbitR: number
  /** 行星个数。 */
  nPlanets: number
}

/**
 * 构建行星轮系（PlanetaryGearset / HerringbonePlanetaryGearset 共用）。
 *
 * @param kernel 原始 OCCT 内核
 * @param params 轮系参数
 * @param options 构造选项（`herringbone` 控制是否人字齿）
 * @returns 太阳 / 行星数组 / 内齿圈 solid 与几何量
 */
export function buildPlanetaryGearset(
  kernel: GearKernel,
  params: PlanetaryGearsetParams,
  options: BuildPlanetaryGearsetOptions = {},
): PlanetaryGearsetBuild {
  const herringbone = options.herringbone ?? false
  const ringZ = params.sun_teeth_number + params.planet_teeth_number * 2

  const sunParams = {
    module: params.module,
    teeth_number: params.sun_teeth_number,
    width: params.width,
    pressure_angle: params.pressure_angle,
    helix_angle: params.helix_angle,
    clearance: params.clearance,
    backlash: params.backlash,
  }
  const planetParams = {
    module: params.module,
    teeth_number: params.planet_teeth_number,
    width: params.width,
    pressure_angle: params.pressure_angle,
    helix_angle: -(params.helix_angle ?? 0.0),
    clearance: params.clearance,
    backlash: params.backlash,
  }
  const ringParams: RingGearParams = {
    module: params.module,
    teeth_number: ringZ,
    width: params.width,
    rim_width: params.rim_width,
    pressure_angle: params.pressure_angle,
    helix_angle: -(params.helix_angle ?? 0.0),
    clearance: params.clearance,
    backlash: params.backlash,
  }

  const sunGeom = spurGearGeometry(sunParams)
  const planetGeom = spurGearGeometry(planetParams)
  const ringGeom = ringGearGeometry(ringParams)
  const orbitR = sunGeom.r0 + planetGeom.r0
  const nPlanets = params.n_planets

  const out: PlanetaryGearsetBuild = {
    planets: [], sunGeometry: sunGeom, planetGeometry: planetGeom,
    ringGeometry: ringGeom, orbitR, nPlanets,
  }

  // 太阳：仅在 planet.z 为奇数时绕 Z 转 tau_sun/2
  if (options.buildSun !== false) {
    let sun = herringbone
      ? buildHerringboneGearSolid(kernel, sunParams, options)
      : buildSpurGearSolid(kernel, sunParams, options)
    if (params.planet_teeth_number % 2 !== 0) {
      sun = kernel.rotate(sun, Z_AXIS, sunGeom.tau / 2)
    }
    out.sun = sun
  }

  // 行星：先自转 tau_planet/2，再平移到均布位置
  if (options.buildPlanets !== false && nPlanets > 0) {
    const planetA = (Math.PI * 2.0) / nPlanets
    for (let i = 0; i < nPlanets; i++) {
      let p = herringbone
        ? buildHerringboneGearSolid(kernel, planetParams, options)
        : buildSpurGearSolid(kernel, planetParams, options)
      p = kernel.rotate(p, Z_AXIS, planetGeom.tau / 2)
      p = kernel.translate(
        p, Math.cos(i * planetA) * orbitR, Math.sin(i * planetA) * orbitR, 0,
      )
      out.planets.push(p)
    }
  }

  // 内齿圈：绕 Z 转 tau_ring/2
  if (options.buildRing !== false) {
    let ring = herringbone
      ? buildHerringboneRingGearSolid(kernel, ringParams, options)
      : buildRingGearSolid(kernel, ringParams, options)
    ring = kernel.rotate(ring, Z_AXIS, ringGeom.tau / 2)
    out.ring = ring
  }

  return out
}

/**
 * 人字行星轮系（HerringbonePlanetaryGearset）——三件全部人字齿。
 *
 * @param kernel 原始 OCCT 内核
 * @param params 行星轮系参数（逐字沿用 Python `HerringbonePlanetaryGearset.__init__`）
 * @param options 构建选项（strategy / 特征字段，透传单体构造）
 * @returns sun + planets[] + ring 的构建记录
 */
export function buildHerringbonePlanetaryGearset(
  kernel: GearKernel,
  params: PlanetaryGearsetParams,
  options: BuildPlanetaryGearsetOptions = {},
): PlanetaryGearsetBuild {
  return buildPlanetaryGearset(kernel, params, { ...options, herringbone: true })
}

/**
 * 行星轮系的导出条目（sun → planet_00.. → ring）。
 *
 * @param build 行星轮系构建结果（成员可能为空——只有 `shafts_connected` 时存在）
 * @returns 具名实体数组（名字进 STEP 产品名，供逐件等价比对）
 */
export function planetaryExportParts(
  build: PlanetaryGearsetBuild,
): Array<{ name: string; solid: BrepHandle }> {
  const parts: Array<{ name: string; solid: BrepHandle }> = []
  if (build.sun) parts.push({ name: 'sun', solid: build.sun })
  build.planets.forEach((p, i) => {
    parts.push({ name: `planet_${String(i).padStart(2, '0')}`, solid: p })
  })
  if (build.ring) parts.push({ name: 'ring', solid: build.ring })
  return parts
}
