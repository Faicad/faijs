/**
 * index — fai_cq_gears 公共 API 入口（15 个齿轮类 + contractVersion）
 *
 * ## 现状（2026-09-13）
 *
 * 本包经 `@faicad/cq-compat` 的齿轮原语层消费内核（`getGearKernel()`，
 * cq-compat 内部统一归属 occt 内核访问），入口签名（参数名逐字沿用 Python、
 * 返回 `Result`）保持不变。
 *
 * 每个导出函数：
 * - 参数名**逐字沿用 Python**（module / teeth_number / width / helix_angle …），见 `profile.ts`；
 * - 返回 `Promise<Result<…>>`：单体齿轮返回 `BrepHandle`；齿轮对/轮系返回具名记录
 *   （`{gear, pinion}` / `{gear1, gear2}` / `{sun, planets, ring}`）并挂 `fn.outputs`
 *   （`library-dev-guide.md` §2.6 / 方案 §6.4），宿主据此逐件收编、导出 STEP。
 * - `GearAssembly`（`{name, solid}[]`）保留为脚本侧逐件导出的形态（`*ExportParts`）。
 */

import type { BrepHandle } from '@faicad/faijs-core'
import { ok, err, type Result, CONTRACT_VERSION } from '@faicad/faijs-core'
import { getGearKernel, type GearKernel } from '@faicad/cq-compat'

import {
  buildSpurGearSolid, buildHerringboneGearSolid, buildHyperbolicGearSolid,
  type BuildSpurGearOptions,
} from './spur_gear'
import {
  buildRingGearSolid, buildHerringboneRingGearSolid, type BuildRingGearOptions,
} from './ring_gear'
import { buildCrossedHelicalSolid } from './crossed_helical_gear'
import { buildRackGearSolid, type BuildRackGearOptions } from './rack_gear'
import { buildWormSolid, type BuildWormOptions } from './worm_gear'
import { buildBevelGearSolid, type BuildBevelGearOptions } from './bevel_gear'
import {
  buildBevelGearPair,
  type BevelGearPairParams, type BuildBevelGearPairOptions,
} from './pairs'
import {
  buildCrossedGearPair, buildHyperbolicGearPair,
  type CrossedGearPairParams, type HyperbolicGearPairParams, type BuildCrossedGearPairOptions,
} from './crossed_pair'
import {
  buildPlanetaryGearset, buildHerringbonePlanetaryGearset,
  type PlanetaryGearsetParams, type BuildPlanetaryGearsetOptions,
} from './planetary'

import type {
  SpurGearParams, RingGearParams, CrossedHelicalGearParams, RackGearParams,
  WormParams, BevelGearParams, HyperbolicGearParams,
} from './profile'

/** 库契约版本（与 faijs 引擎对齐，勿硬编码）。 */
export const contractVersion = CONTRACT_VERSION

/** 齿轮对/轮系的逐件导出条目（名字进 STEP 产品名，供逐件等价比对）。 */
export type GearAssembly = Array<{ name: string; solid: BrepHandle }>

/**
 * 统一内核执行包装：取单例内核、运行构建、失败转 `err`。
 *
 * @param fn 接收原始内核、返回 solid 或装配
 * @returns `Result<T>`
 */
async function run<T>(fn: (kernel: GearKernel) => T): Promise<Result<T, string>> {
  try {
    const kernel = await getGearKernel()
    return ok(fn(kernel))
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

// ── A 族：直纹/扭纹齿面（网格样条曲面）──────────────────────────────────────────

/**
 * SpurGear（直齿圆柱齿轮）。
 *
 * @param params 齿轮参数（逐字沿用 Python `SpurGear.__init__`）
 * @param options 构建选项（齿面策略 / 特征字段）
 * @returns `Result<BrepHandle>`——solid 句柄，失败转 `err`
 */
export function spurGear(
  params: SpurGearParams, options: BuildSpurGearOptions = {},
): Promise<Result<BrepHandle, string>> {
  return run((k) => buildSpurGearSolid(k, params, options))
}

/**
 * HerringboneGear（人字齿圆柱齿轮）。
 *
 * @param params 齿轮参数（逐字沿用 Python `HerringboneGear.__init__`）
 * @param options 构建选项（齿面策略 / 特征字段）
 * @returns `Result<BrepHandle>`——solid 句柄，失败转 `err`
 */
export function herringboneGear(
  params: SpurGearParams, options: BuildSpurGearOptions = {},
): Promise<Result<BrepHandle, string>> {
  return run((k) => buildHerringboneGearSolid(k, params, options))
}

/**
 * RingGear（内齿圈）。
 *
 * @param params 齿轮参数（逐字沿用 Python `RingGear.__init__`）
 * @param options 构建选项（齿面策略 / 特征字段）
 * @returns `Result<BrepHandle>`——solid 句柄，失败转 `err`
 */
export function ringGear(
  params: RingGearParams, options: BuildRingGearOptions = {},
): Promise<Result<BrepHandle, string>> {
  return run((k) => buildRingGearSolid(k, params, options))
}

/**
 * HerringboneRingGear（人字内齿圈）。
 *
 * @param params 齿轮参数（逐字沿用 Python `HerringboneRingGear.__init__`）
 * @param options 构建选项（齿面策略 / 特征字段）
 * @returns `Result<BrepHandle>`——solid 句柄，失败转 `err`
 */
export function herringboneRingGear(
  params: RingGearParams, options: BuildRingGearOptions = {},
): Promise<Result<BrepHandle, string>> {
  return run((k) => buildHerringboneRingGearSolid(k, params, options))
}

/**
 * CrossedHelicalGear（交错轴斜齿轮，单体）。
 *
 * @param params 齿轮参数（逐字沿用 Python `CrossedHelicalGear.__init__`）
 * @param options 构建选项（齿面策略 / 特征字段）
 * @returns `Result<BrepHandle>`——solid 句柄，失败转 `err`
 */
export function crossedHelicalGear(
  params: CrossedHelicalGearParams, options: BuildSpurGearOptions = {},
): Promise<Result<BrepHandle, string>> {
  return run((k) => buildCrossedHelicalSolid(k, params, options))
}

/**
 * HyperbolicGear（双曲面齿轮，单体）。
 *
 * @param params 齿轮参数（逐字沿用 Python `HyperbolicGear.__init__`）
 * @param options 构建选项（齿面策略 / 特征字段）
 * @returns `Result<BrepHandle>`——solid 句柄，失败转 `err`
 */
export function hyperbolicGear(
  params: HyperbolicGearParams, options: BuildSpurGearOptions = {},
): Promise<Result<BrepHandle, string>> {
  return run((k) => buildHyperbolicGearSolid(k, params, options))
}

// ── B 族：球面渐开线（BevelGear）───────────────────────────────────────────────

/**
 * BevelGear（锥齿轮，单体）。
 *
 * @param params 齿轮参数（逐字沿用 Python `BevelGear.__init__`）
 * @param options 构建选项（齿面策略 / bore_d / trim）
 * @returns `Result<BrepHandle>`——solid 句柄，失败转 `err`
 */
export function bevelGear(
  params: BevelGearParams, options: BuildBevelGearOptions = {},
): Promise<Result<BrepHandle, string>> {
  return run((k) => buildBevelGearSolid(k, params, options))
}

/** BevelGearPair 逐件输出（`fn.outputs` 指定的具名记录，方案 §6.4）。 */
export interface BevelGearPairOutput {
  /** 大轮 solid（未加定位）。 */
  gear?: BrepHandle
  /** 小轮 solid（**已加**定位，除非 `transformPinion: false`）。 */
  pinion?: BrepHandle
}

/**
 * BevelGearPair（锥齿轮副，装配体）。
 *
 * @param params 齿轮副参数（逐字沿用 Python `BevelGearPair.__init__`）
 * @param options 构建选项（齿面策略 / bore_d / trim）
 * @returns `Result<BevelGearPairOutput>`——具名记录，失败转 `err`
 */
export function bevelGearPair(
  params: BevelGearPairParams, options: BuildBevelGearPairOptions = {},
): Promise<Result<BevelGearPairOutput, string>> {
  return run((k) => {
    const b = buildBevelGearPair(k, params, options)
    return { gear: b.gear, pinion: b.pinion }
  })
}
;(bevelGearPair as { outputs?: string[] }).outputs = ['gear', 'pinion']

// ── C 族：齿条 / 蜗杆 ───────────────────────────────────────────────────────────

/**
 * RackGear（齿条）。
 *
 * @param params 齿条参数（逐字沿用 Python `RackGear.__init__`）
 * @param options 构建选项（齿面策略）
 * @returns `Result<BrepHandle>`——solid 句柄，失败转 `err`
 */
export function rackGear(
  params: RackGearParams, options: BuildRackGearOptions = {},
): Promise<Result<BrepHandle, string>> {
  return run((k) => buildRackGearSolid(k, params, options))
}

/**
 * HerringboneRackGear（人字齿条）。
 *
 * @param params 齿条参数（逐字沿用 Python `HerringboneRackGear.__init__`）
 * @param options 构建选项（齿面策略；内部强制 `herringbone: true`）
 * @returns `Result<BrepHandle>`——solid 句柄，失败转 `err`
 */
export function herringboneRackGear(
  params: RackGearParams, options: BuildRackGearOptions = {},
): Promise<Result<BrepHandle, string>> {
  return run((k) => buildRackGearSolid(k, params, { ...options, herringbone: true }))
}

/**
 * Worm（蜗杆）。
 *
 * @param params 蜗杆参数（逐字沿用 Python `Worm.__init__`）
 * @param options 构建选项（策略默认 grid-approx / 缝合与组线容差 / boreD）
 * @returns `Result<BrepHandle>`——solid 句柄，失败转 `err`
 */
export function worm(
  params: WormParams, options: BuildWormOptions = {},
): Promise<Result<BrepHandle, string>> {
  return run((k) => buildWormSolid(k, params, options))
}

// ── 齿轮对 / 轮系（返回装配）────────────────────────────────────────────────────

/** CrossedGearPair / HyperbolicGearPair 逐件输出（`fn.outputs` 指定的具名记录，方案 §6.4）。 */
export interface CrossedGearPairOutput {
  /** 第一齿轮 solid（未定位）。 */
  gear1?: BrepHandle
  /** 第二齿轮 solid（已按轴交角定位）。 */
  gear2?: BrepHandle
}

/**
 * CrossedGearPair（交错轴斜齿轮副，装配体）。
 *
 * @param params 齿轮副参数（逐字沿用 Python `CrossedGearPair.__init__`）
 * @param options 构建选项（齿面策略 / 特征字段）
 * @returns `Result<CrossedGearPairOutput>`——具名记录，失败转 `err`
 */
export function crossedGearPair(
  params: CrossedGearPairParams, options: BuildCrossedGearPairOptions = {},
): Promise<Result<CrossedGearPairOutput, string>> {
  return run((k) => {
    const b = buildCrossedGearPair(k, params, options)
    return { gear1: b.gear1, gear2: b.gear2 }
  })
}
;(crossedGearPair as { outputs?: string[] }).outputs = ['gear1', 'gear2']

/**
 * HyperbolicGearPair（双曲面齿轮副，装配体）。
 *
 * @param params 齿轮副参数（逐字沿用 Python `HyperbolicGearPair.__init__`）
 * @param options 构建选项（齿面策略 / 特征字段）
 * @returns `Result<CrossedGearPairOutput>`——具名记录，失败转 `err`
 */
export function hyperbolicGearPair(
  params: HyperbolicGearPairParams, options: BuildCrossedGearPairOptions = {},
): Promise<Result<CrossedGearPairOutput, string>> {
  return run((k) => {
    const b = buildHyperbolicGearPair(k, params, options)
    return { gear1: b.gear1, gear2: b.gear2 }
  })
}
;(hyperbolicGearPair as { outputs?: string[] }).outputs = ['gear1', 'gear2']

/** PlanetaryGearset 逐件输出（`fn.outputs` 指定的具名记录，方案 §6.4）。 */
export interface PlanetaryGearsetOutput {
  /** 太阳轮 solid。 */
  sun?: BrepHandle
  /** 行星轮 solid 列表（planet_01…planet_NN）。 */
  planets: BrepHandle[]
  /** 内齿圈 solid。 */
  ring?: BrepHandle
}

/**
 * PlanetaryGearset（行星轮系，装配体）。
 *
 * @param params 轮系参数（逐字沿用 Python `PlanetaryGearset.__init__`）
 * @param options 构建选项（齿面策略 / 特征字段）
 * @returns `Result<PlanetaryGearsetOutput>`——具名记录，失败转 `err`
 */
export function planetaryGearset(
  params: PlanetaryGearsetParams, options: BuildPlanetaryGearsetOptions = {},
): Promise<Result<PlanetaryGearsetOutput, string>> {
  return run((k) => {
    const b = buildPlanetaryGearset(k, params, options)
    return { sun: b.sun, planets: b.planets, ring: b.ring }
  })
}
;(planetaryGearset as { outputs?: string[] }).outputs = ['sun', 'planets', 'ring']

/**
 * HerringbonePlanetaryGearset（人字行星轮系，装配体）。
 *
 * @param params 轮系参数（逐字沿用 Python `HerringbonePlanetaryGearset.__init__`）
 * @param options 构建选项（齿面策略 / 特征字段）
 * @returns `Result<PlanetaryGearsetOutput>`——具名记录，失败转 `err`
 */
export function herringbonePlanetaryGearset(
  params: PlanetaryGearsetParams, options: BuildPlanetaryGearsetOptions = {},
): Promise<Result<PlanetaryGearsetOutput, string>> {
  return run((k) => {
    const b = buildHerringbonePlanetaryGearset(k, params, options)
    return { sun: b.sun, planets: b.planets, ring: b.ring }
  })
}
;(herringbonePlanetaryGearset as { outputs?: string[] }).outputs = ['sun', 'planets', 'ring']
