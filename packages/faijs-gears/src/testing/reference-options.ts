/**
 * reference-options — manifest `args` → 构造 options 的**唯一**映射
 *
 * 为什么单独一个模块：这份映射曾经在 `scripts/export-ours.ts`、`bevel-gear-build.test.ts`、
 * `features.test.ts` 里各写一份，结果 2026-09-12 一天内**两次**踩同一个坑——
 * 测试侧漏抽 `bore_d`，于是拿「无轴孔的我们」去比「有轴孔的参考」，报出 2% 的假偏差
 * （bp-angled-helix/gear 1467.389 恰好等于 Python `bore=None` 的 1467.3926）。
 * 双边共用同一函数后，这类「一边抽了、一边没抽」的分裂在结构上不可能再发生。
 *
 * 约定：manifest 的 `args` 是 cq_gears 构造参数与 `build()` 关键字参数的**混合体**
 * （延续 regression 用例的写法），故这里把 `bore_d` / `chamfer` / `hub_d` … 逐字段
 * 抽成构造 options；**字段缺失就是「该类不用该特征」**，不补默认值、不静默。
 */

import type { GearFeatureOptions } from '../features'
import type { BuildBevelGearOptions } from '../bevel_gear'
import type { BuildBevelGearPairOptions } from '../pairs'
import type { SplineFaceStrategy } from '../spline-face'

/** 判断 `unknown` 是否为可用数值。 */
function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined
}

/**
 * SpurGear 族的镀铬特征参数（chamfer / bore / hub / recess / spokes / missing_teeth）。
 *
 * @param args manifest 用例的 `args`
 * @returns `GearFeatureOptions`（只含实际存在的字段）
 */
export function gearFeatureOptionsFromArgs(args: Record<string, unknown>): GearFeatureOptions {
  const o: GearFeatureOptions = {}
  const chamfer = num(args.chamfer)
  const boreD = num(args.bore_d)
  const hubD = num(args.hub_d)
  const hubLength = num(args.hub_length)
  const recess = num(args.recess)
  const recessD = num(args.recess_d)
  const bottomRecess = num(args.bottom_recess)
  const bottomRecessD = num(args.bottom_recess_d)
  const bottomHubD = num(args.bottom_hub_d)
  const nSpokes = num(args.n_spokes)
  const spokeWidth = num(args.spoke_width)
  const spokesId = num(args.spokes_id)
  const spokesOd = num(args.spokes_od)
  const spokeFillet = num(args.spoke_fillet)
  if (chamfer !== undefined) o.chamfer = chamfer
  if (boreD !== undefined) o.boreD = boreD
  if (hubD !== undefined) o.hubD = hubD
  if (hubLength !== undefined) o.hubLength = hubLength
  if (recess !== undefined) o.recess = recess
  if (recessD !== undefined) o.recessD = recessD
  if (bottomRecess !== undefined) o.bottomRecess = bottomRecess
  if (bottomRecessD !== undefined) o.bottomRecessD = bottomRecessD
  if (bottomHubD !== undefined) o.bottomHubD = bottomHubD
  if (nSpokes !== undefined) o.nSpokes = nSpokes
  if (spokeWidth !== undefined) o.spokeWidth = spokeWidth
  if (spokesId !== undefined) o.spokesId = spokesId
  if (spokesOd !== undefined) o.spokesOd = spokesOd
  if (spokeFillet !== undefined) o.spokeFillet = spokeFillet
  if (Array.isArray(args.missing_teeth)) {
    o.missingTeeth = args.missing_teeth as Array<[number, number]>
  }
  return o
}

/**
 * BevelGear 的构造 options（`_build` 只认 `bore_d` / `trim_bottom` / `trim_top`）。
 *
 * @param args manifest 用例的 `args`
 * @param strategy 齿面建面策略
 * @returns `BuildBevelGearOptions`
 */
export function bevelGearOptionsFromArgs(
  args: Record<string, unknown>, strategy: SplineFaceStrategy,
): BuildBevelGearOptions {
  const o: BuildBevelGearOptions = { strategy }
  const boreD = num(args.bore_d)
  if (boreD !== undefined) o.boreD = boreD
  if (args.trim_bottom === false) o.trimBottom = false
  if (args.trim_top === false) o.trimTop = false
  return o
}

/**
 * BevelGearPair 的构造 options（两件共用 `bore_d` / `trim_bottom` / `trim_top`）。
 *
 * @param args manifest 用例的 `args`
 * @param strategy 齿面建面策略
 * @returns `BuildBevelGearPairOptions`
 */
export function bevelPairOptionsFromArgs(
  args: Record<string, unknown>, strategy: SplineFaceStrategy,
): BuildBevelGearPairOptions {
  const o: BuildBevelGearPairOptions = { strategy }
  const boreD = num(args.bore_d)
  if (boreD !== undefined) o.boreD = boreD
  if (args.trim_bottom === false) o.trimBottom = false
  if (args.trim_top === false) o.trimTop = false
  return o
}
