/**
 * index — faijs-gears 公共 API 入口（15 个齿轮类 + contractVersion + libManifest）
 *
 * ## 内核取用（内核取用面收敛 2026-10-14 §3.1 / §3.5）
 *
 * 本包是**平台库**：库级声明 `faijs.lib = { role: 'library', conformsTo: 'cadquery',
 * platform: ['occt'] }`（`package.json`）。声明的事实依据是**构建主路径**上的四件
 * L1 之外的能力——封盖 `healWire`、切齿/越界修剪 `split(工具实体)`、齿面蒙皮
 * `loft`（L1 的 loft 恒产实体，本处要壳/单张面）、齿面偏差 `projectPointOnFace`
 * （详见 `src/kernel/gears.ts` 的 `GearOcct`）。因此**全库 occt-only**，
 * 不是个别函数的例外；库内不存在任何 `fn.engines` 函数级声明。
 *
 * 内核经 `src/kernel/` 的双句柄 `GearKernel = { l1, occt }`（`gearKernel()`）取用：
 * 中立能力走 L1 面，平台能力走 occt 面，用错面是编译期错误。
 *
 * 每个导出函数：
 * - 参数名**逐字沿用 Python**（module / teeth_number / width / helix_angle …），见 `profile.ts`；
 * - 返回 `Promise<Result<…>>`：单体齿轮返回 `BrepHandle`；齿轮对/轮系返回具名记录
 *   （`{gear, pinion}` / `{gear1, gear2}` / `{sun, planets, ring}`）并挂 `fn.outputs`
 *   （`library-dev-guide.md` §2.6 / 方案 §6.4），宿主据此逐件收编、导出 STEP。
 * - `GearAssembly`（`{name, solid}[]`）保留为脚本侧逐件导出的形态（`*ExportParts`）。
 */

import type { BrepHandle } from '@faicad/faijs'
import { ok, err, type Result, CONTRACT_VERSION } from '@faicad/faijs'
import type { BrepEngineId } from '@faicad/faijs/sdk'
import { gearKernel, type GearKernel } from './kernel'

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
 * 统一内核执行包装：取双句柄、运行构建、失败转 `err`。
 *
 * `gearKernel()` 不缓存（引擎可在会话中途切），且内核未就绪时显式抛错——
 * 失败被本包装转成 `err`，不静默降级。
 *
 * @param fn 接收双句柄、返回 solid 或装配
 * @returns `Result<T>`
 */
async function run<T>(fn: (kernel: GearKernel) => T): Promise<Result<T, string>> {
  try {
    const kernel = gearKernel()
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

// ── 函数清单与自校（内核取用面收敛 2026-10-14 §3.5 第 4 项）───────────────────────

/** 齿轮库函数清单里的一条：导出名 + 该函数自己的两级声明注解。 */
export interface GearManifestEntry {
  /** faijs 面导出名（与模块导出一致）。 */
  name: string
  /**
   * 函数级引擎例外（`fn.engines`）。**本库恒缺省**：齿轮用到的四件 L1 之外能力
   * （见 `kernel/gears.ts` 的 `GearOcct`）全都落在构建主路径上，约束因此是**库级**的
   * （下面的 `lib.platform`），不是函数级的（§3.3 第 1 项的判据）。
   */
  engines?: readonly BrepEngineId[]
  /** 逐件输出名（`fn.outputs`）；单体齿轮没有。 */
  outputs?: readonly string[]
}

/** 本库自述清单：库级定位声明 + 逐函数清单。 */
export interface GearLibManifest {
  /** 包名（`package.json` 的 `name`）。 */
  packageName: string
  /** 库级定位的**可读镜像**；权威仍是 `package.json` 的 `faijs.lib`，装配期由核心校验。 */
  lib: { role: 'library'; conformsTo: string; platform: readonly BrepEngineId[] }
  functions: readonly GearManifestEntry[]
}

/** 带可选两级声明注解的函数（`fn.engines` / `fn.outputs`）。 */
type GearFn = ((...a: never[]) => unknown) & {
  engines?: readonly BrepEngineId[]
  outputs?: readonly string[]
}

/**
 * 具名表：导出名 → 导出函数。
 *
 * `libManifest.functions` 从它**推导**（注解是唯一真源，不再手抄一份），而
 * {@link checkLibManifest} 拿它与实际模块命名空间对账——新增导出忘了登记即报错。
 */
const GEAR_FUNCTIONS: Record<string, GearFn> = {
  spurGear, herringboneGear, ringGear, herringboneRingGear,
  crossedHelicalGear, hyperbolicGear, bevelGear, bevelGearPair,
  rackGear, herringboneRackGear, worm,
  crossedGearPair, hyperbolicGearPair,
  planetaryGearset, herringbonePlanetaryGearset,
}

/** 本库清单：库级定位 + 逐函数清单（含各函数的 `fn.engines` / `fn.outputs`）。 */
export const libManifest: GearLibManifest = {
  packageName: '@faicad/faijs-gears',
  lib: { role: 'library', conformsTo: 'cadquery', platform: ['occt'] },
  functions: Object.entries(GEAR_FUNCTIONS).map(([name, fn]) => {
    const entry: GearManifestEntry = { name }
    if (fn.engines !== undefined) entry.engines = fn.engines
    if (fn.outputs !== undefined) entry.outputs = fn.outputs
    return entry
  }),
}

/** 两个可选列表是否**逐位**相等（`undefined` 只与 `undefined` 相等）。 */
function sameList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * 清单自校：`libManifest` 与实际模块的双源一致性。
 *
 * 检查三件事：
 *  1. 清单里每个函数都在 `ns` 里（登记了不存在的导出 → 报错）；
 *  2. 清单项的 `engines` / `outputs` 与该函数对象上的注解**逐位一致**（清单不得与实现漂移）；
 *  3. `ns` 里任何**带注解**的函数都必须在清单里（新增导出忘了登记 → 报错）。
 *
 * @param ns 运行时命名空间（`import * as gear from '…/src/index'`）
 * @throws Error 任一条不成立
 */
export function checkLibManifest(ns: Record<string, unknown>): void {
  const listed = new Set(libManifest.functions.map((f) => f.name))
  for (const entry of libManifest.functions) {
    const value = ns[entry.name]
    if (typeof value !== 'function') {
      throw new Error(`[libManifest] '${entry.name}' 在清单里，但模块没有这个函数导出`)
    }
    const fn = value as GearFn
    if (!sameList(fn.engines, entry.engines)) {
      throw new Error(
        `[libManifest] '${entry.name}': fn.engines=${JSON.stringify(fn.engines)} ` +
          `与清单 ${JSON.stringify(entry.engines)} 不一致`,
      )
    }
    if (!sameList(fn.outputs, entry.outputs)) {
      throw new Error(
        `[libManifest] '${entry.name}': fn.outputs=${JSON.stringify(fn.outputs)} ` +
          `与清单 ${JSON.stringify(entry.outputs)} 不一致`,
      )
    }
  }
  for (const [name, value] of Object.entries(ns)) {
    if (typeof value !== 'function') continue
    const fn = value as GearFn
    if (fn.engines === undefined && fn.outputs === undefined) continue
    if (!listed.has(name)) {
      throw new Error(`[libManifest] 模块导出 '${name}' 带两级声明注解，但不在清单里`)
    }
  }
}
