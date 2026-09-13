/**
 * export-ours — 用 fai_cq_gears 生成对照 STEP（等价性比对的 B 侧）
 *
 * 与 `scripts/gen-reference.py`（A 侧，CadQuery）成对使用，然后由
 * `scripts/compare-all.ts` 走**装配一致性比对**（compareAssemblyFiles，见
 * `src/testing/compare.ts`——所有 STEP 比对必须用装配比对，见分析文档
 * `docs/analysis/2026-09-08-cq-compat-union-compound-bug.md`）。
 *
 * 用法：
 *   npx tsx scripts/export-ours.ts [--case spur-basic] [--strategy row-approx-loft] [--out out]
 * 不传 `--case` 则导出 manifest 里全部用例。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { exportStepFromSolids, type StepExportEntry } from '@faicad/faijs-core'
import { loadManifest, OUT_DIR, type ReferenceCase } from '../src/fixtures'
import { getRawKernel } from '../src/kernel'
import { buildSpurGearSolid, buildHerringboneGearSolid, buildHyperbolicGearSolid, type BuildSpurGearOptions } from '../src/spur_gear'
import {
  buildRingGearSolid, buildHerringboneRingGearSolid,
} from '../src/ring_gear'
import { buildCrossedHelicalSolid } from '../src/crossed_helical_gear'
import { buildRackGearSolid, type BuildRackGearOptions } from '../src/rack_gear'
import { buildBevelGearSolid } from '../src/bevel_gear'
import {
  bevelPairExportParts, buildBevelGearPair, type BevelGearPairParams,
} from '../src/pairs'
import {
  buildCrossedGearPair, crossedPairExportParts,
  buildHyperbolicGearPair, hyperbolicPairExportParts,
  type CrossedGearPairParams, type HyperbolicGearPairParams,
} from '../src/crossed_pair'
import {
  buildPlanetaryGearset, planetaryExportParts, type PlanetaryGearsetParams,
} from '../src/planetary'
import { bevelGearOptionsFromArgs, bevelPairOptionsFromArgs, gearFeatureOptionsFromArgs } from '../src/testing/reference-options'
import type {
  SpurGearParams, RingGearParams, CrossedHelicalGearParams, RackGearParams, BevelGearParams,
  HyperbolicGearParams,
} from '../src/profile'
import type { SplineFaceStrategy } from '../src/spline-face'
import type { RawOcctKernel } from '../src/kernel'
import type { BrepHandle } from '@faicad/faijs-core'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/**
 * 按 class 分派到一个或多个实体。
 *
 * 绝大多数类是单体；齿轮对（`*Pair`）是多件装配，必须**一件一个 XCAF 产品**导出，
 * 才能与参考侧（`asm.toCompound()` → 2 个 `MANIFOLD_SOLID_BREP`）逐件对齐。
 *
 * @param kernel 原始 OCCT 内核
 * @param c 参考用例
 * @param strategy 齿面建面策略
 * @returns 具名实体列表（名字进 STEP 产品名）
 */
export function buildOurParts(
  kernel: RawOcctKernel,
  c: ReferenceCase,
  strategy: SplineFaceStrategy,
): Array<{ name: string; solid: BrepHandle }> {
  if (c.class === 'BevelGearPair') {
    const build = buildBevelGearPair(
      kernel, c.args as unknown as BevelGearPairParams, bevelPairOptionsFromArgs(c.args, strategy),
    )
    return bevelPairExportParts(build)
  }
  // 交错轴斜齿轮对（CrossedGearPair）：两件各走 CrossedHelical 实体，gear2 按轴交角定位。
  if (c.class === 'CrossedGearPair') {
    const build = buildCrossedGearPair(
      kernel, c.args as unknown as CrossedGearPairParams,
      { strategy, ...gearFeatureOptionsFromArgs(c.args) },
    )
    return crossedPairExportParts(build)
  }
  // 双曲面齿轮对（HyperbolicGearPair）：两件各走 HyperbolicGear 实体（throat_r 偏移）。
  if (c.class === 'HyperbolicGearPair') {
    const build = buildHyperbolicGearPair(
      kernel, c.args as unknown as HyperbolicGearPairParams,
      { strategy, ...gearFeatureOptionsFromArgs(c.args) },
    )
    return hyperbolicPairExportParts(build)
  }
  // 行星轮系（PlanetaryGearset / HerringbonePlanetaryGearset）：sun+planets+ring 装配。
  if (c.class === 'PlanetaryGearset' || c.class === 'HerringbonePlanetaryGearset') {
    const build = buildPlanetaryGearset(
      kernel, c.args as unknown as PlanetaryGearsetParams,
      { strategy, ...gearFeatureOptionsFromArgs(c.args) },
    )
    return planetaryExportParts(build)
  }
  return [{ name: c.id, solid: buildOurShape(kernel, c, strategy) }]
}

/**
 * 按用例的 `class` 分派到对应的实体构造（T2：全类接入）。
 *
 * 注意：参考 STEP 是 cq_gears `gear.build()` 的**完整体**（含 chamfer/bore/hub/spokes/
 * recess），而我们当前只建模**裸齿轮**（齿 + 顶底盖面，Ring 另加 rim 与环形盖面）。
 * 因此带特征的用例（绝大多数 regression 用例）比对会因未建模特征而 DIFFERENT——
 * 这是已知的特性缺口（见后续倒角/特征工作），不是建体 bug；纯裸用例（spike 与 Rack
 * 族，其参数不含特征字段）应 EQUIVALENT。
 *
 * 多件类见 {@link buildOurParts}。
 *
 * @param kernel 原始 OCCT 内核
 * @param c 参考用例
 * @param strategy 齿面建面策略
 * @returns 单体 solid 句柄
 */
export function buildOurShape(
  kernel: RawOcctKernel,
  c: ReferenceCase,
  strategy: SplineFaceStrategy,
): BrepHandle {
  // 从 manifest 抽镀铬特征参数，复刻 cq_gears `gear.build()` 的完整体。
  // ⚠️ 这份映射的单真源在 `src/testing/reference-options.ts`——不要在这里另写一份。
  const build: BuildSpurGearOptions = {
    strategy, ...gearFeatureOptionsFromArgs(c.args),
  }
  switch (c.class) {
    case 'Box': {
      const { width = 10, depth = 20, height = 30 } = c.args as Record<string, number>
      return kernel.makeBoxFromCorners(
        { x: -width / 2, y: -depth / 2, z: -height / 2 },
        { x: width / 2, y: depth / 2, z: height / 2 },
      )
    }
    case 'SpurGear':
      return buildSpurGearSolid(kernel, c.args as unknown as SpurGearParams, build)
    case 'HerringboneGear':
      return buildHerringboneGearSolid(kernel, c.args as unknown as SpurGearParams, build)
    case 'RingGear':
      return buildRingGearSolid(kernel, c.args as unknown as RingGearParams, build)
    case 'HerringboneRingGear':
      return buildHerringboneRingGearSolid(kernel, c.args as unknown as RingGearParams, build)
    case 'CrossedHelicalGear':
      return buildCrossedHelicalSolid(kernel, c.args as unknown as CrossedHelicalGearParams, build)
    case 'HyperbolicGear':
      // 双曲面齿轮（单体）：twist_angle 直接给定，throat_r 由几何反算（见 profile.ts）。
      return buildHyperbolicGearSolid(kernel, c.args as unknown as HyperbolicGearParams, build)
    case 'RackGear':
      // 齿条无倒角 / 轴孔（cq_gears `RackGear` 不建模这些特征），用独立 options。
      return buildRackGearSolid(kernel, c.args as unknown as RackGearParams, { strategy } as BuildRackGearOptions)
    case 'HerringboneRackGear':
      return buildRackGearSolid(kernel, c.args as unknown as RackGearParams,
        { strategy, herringbone: true } as BuildRackGearOptions)
    case 'BevelGear': {
      // BevelGear 的 `_build` 只认 bore_d / trim_bottom / trim_top（无 chamfer/hub/spokes）。
      return buildBevelGearSolid(
        kernel, c.args as unknown as BevelGearParams, bevelGearOptionsFromArgs(c.args, strategy),
      )
    }
    case 'BevelGearPair':
      // 装配体是多件，单实体路径表达不了——见 buildOurParts。
      throw new Error('export-ours: BevelGearPair 是多件装配，请走 buildOurParts')
    default:
      throw new Error(`export-ours: 尚未支持的类 ${c.class}`)
  }
}

async function main(): Promise<void> {
  const kernel = await getRawKernel()
  const outDir = arg('out') ?? OUT_DIR
  const strategy = (arg('strategy') ?? 'row-approx-loft') as SplineFaceStrategy
  const only = arg('case')
  mkdirSync(outDir, { recursive: true })

  const manifest = loadManifest()
  const cases = only ? manifest.cases.filter((c) => c.id === only) : manifest.cases
  const summary: unknown[] = []

  for (const c of cases) {
    const t0 = Date.now()
    const parts = buildOurParts(kernel, c, strategy)
    // 多件类的**整体**量：体积 = 各件之和（与 Compound 的 Volume() 同定义），
    // bbox = 各件的并集（与 Compound.BoundingBox() 同定义）。
    let volume = 0
    const boxes = parts.map((p) => {
      const v = kernel.getVolume(p.solid)
      volume += v
      return kernel.getBoundingBox(p.solid)
    })
    const bbox = [
      Math.max(...boxes.map((b) => b.xmax)) - Math.min(...boxes.map((b) => b.xmin)),
      Math.max(...boxes.map((b) => b.ymax)) - Math.min(...boxes.map((b) => b.ymin)),
      Math.max(...boxes.map((b) => b.zmax)) - Math.min(...boxes.map((b) => b.zmin)),
    ]
    const step = exportStepFromSolids(kernel, parts)
    const file = `${outDir}/${c.id}.step`
    writeFileSync(file, Buffer.from(step))
    const ms = Date.now() - t0
    const dVol = c.volume !== undefined ? volume - c.volume : NaN
    summary.push({
      id: c.id, strategy, parts: parts.length, volume, refVolume: c.volume, dVolume: dVol,
      relVolumeDiff: c.volume ? Math.abs(dVol) / c.volume : NaN,
      bbox, refBbox: c.bbox, ms, stepFile: file,
    })
    console.log(
      `${c.id.padEnd(15)} [${parts.length}p] vol=${volume.toFixed(6).padStart(14)} ref=${String(c.volume).padStart(14)} ` +
      `Δ=${dVol.toExponential(3).padStart(12)} rel=${Math.abs(dVol / (c.volume || 1)).toExponential(3)}  ${ms}ms`,
    )
  }

  writeFileSync(`${outDir}/export-summary.json`, JSON.stringify({ strategy, cases: summary }, null, 2), 'utf-8')
  console.log(`\n[export-ours] wrote ${cases.length} STEP file(s) to ${outDir}`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
