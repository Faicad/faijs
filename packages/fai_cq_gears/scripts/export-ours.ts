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
import { exportStepFromSolid } from '@faicad/faijs-core'
import { loadManifest, OUT_DIR, type ReferenceCase } from '../src/fixtures'
import { getRawKernel } from '../src/kernel'
import { buildSpurGearSolid, buildHerringboneGearSolid, type BuildSpurGearOptions } from '../src/spur_gear'
import {
  buildRingGearSolid, buildHerringboneRingGearSolid,
} from '../src/ring_gear'
import { buildCrossedHelicalSolid } from '../src/crossed_helical_gear'
import { buildRackGearSolid, type BuildRackGearOptions } from '../src/rack_gear'
import type {
  SpurGearParams, RingGearParams, CrossedHelicalGearParams, RackGearParams,
} from '../src/profile'
import type { SplineFaceStrategy } from '../src/spline-face'
import type { GearFeatureOptions } from '../src/features'
import type { RawOcctKernel } from '../src/kernel'
import type { BrepHandle } from '@faicad/faijs-core'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/**
 * 按用例的 `class` 分派到对应的实体构造（T2：全类接入）。
 *
 * 注意：参考 STEP 是 cq_gears `gear.build()` 的**完整体**（含 chamfer/bore/hub/spokes/
 * recess），而我们当前只建模**裸齿轮**（齿 + 顶底盖面，Ring 另加 rim 与环形盖面）。
 * 因此带特征的用例（绝大多数 regression 用例）比对会因未建模特征而 DIFFERENT——
 * 这是已知的特性缺口（见后续倒角/特征工作），不是建体 bug；纯裸用例（spike 与 Rack
 * 族，其参数不含特征字段）应 EQUIVALENT。
 */
export function buildOurShape(
  kernel: RawOcctKernel,
  c: ReferenceCase,
  strategy: SplineFaceStrategy,
): BrepHandle {
  // 从 manifest 抽镀铬特征参数，复刻 cq_gears `gear.build()` 的完整体。
  const a = c.args as Record<string, unknown>
  const build: BuildSpurGearOptions = { strategy }
  if (typeof a.chamfer === 'number') (build as GearFeatureOptions).chamfer = a.chamfer
  if (typeof a.bore_d === 'number') (build as GearFeatureOptions).boreD = a.bore_d
  if (typeof a.hub_d === 'number') (build as GearFeatureOptions).hubD = a.hub_d
  if (typeof a.hub_length === 'number') (build as GearFeatureOptions).hubLength = a.hub_length
  if (typeof a.recess === 'number') (build as GearFeatureOptions).recess = a.recess
  if (typeof a.recess_d === 'number') (build as GearFeatureOptions).recessD = a.recess_d
  if (typeof a.bottom_recess === 'number') (build as GearFeatureOptions).bottomRecess = a.bottom_recess
  if (typeof a.bottom_recess_d === 'number') (build as GearFeatureOptions).bottomRecessD = a.bottom_recess_d
  if (typeof a.bottom_hub_d === 'number') (build as GearFeatureOptions).bottomHubD = a.bottom_hub_d
  if (typeof a.n_spokes === 'number') (build as GearFeatureOptions).nSpokes = a.n_spokes
  if (typeof a.spoke_width === 'number') (build as GearFeatureOptions).spokeWidth = a.spoke_width
  if (typeof a.spokes_id === 'number') (build as GearFeatureOptions).spokesId = a.spokes_id
  if (typeof a.spokes_od === 'number') (build as GearFeatureOptions).spokesOd = a.spokes_od
  if (typeof a.spoke_fillet === 'number') (build as GearFeatureOptions).spokeFillet = a.spoke_fillet
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
    case 'RackGear':
      // 齿条无倒角 / 轴孔（cq_gears `RackGear` 不建模这些特征），用独立 options。
      return buildRackGearSolid(kernel, c.args as unknown as RackGearParams, { strategy } as BuildRackGearOptions)
    case 'HerringboneRackGear':
      return buildRackGearSolid(kernel, c.args as unknown as RackGearParams,
        { strategy, herringbone: true } as BuildRackGearOptions)
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
    const shape = buildOurShape(kernel, c, strategy)
    const volume = kernel.getVolume(shape)
    const bb = kernel.getBoundingBox(shape)
    const bbox = [bb.xmax - bb.xmin, bb.ymax - bb.ymin, bb.zmax - bb.zmin]
    const step = exportStepFromSolid(shape, kernel)
    const file = `${outDir}/${c.id}.step`
    writeFileSync(file, Buffer.from(step))
    const ms = Date.now() - t0
    const dVol = c.volume !== undefined ? volume - c.volume : NaN
    summary.push({
      id: c.id, strategy, volume, refVolume: c.volume, dVolume: dVol,
      relVolumeDiff: c.volume ? Math.abs(dVol) / c.volume : NaN,
      bbox, refBbox: c.bbox, ms, stepFile: file,
    })
    console.log(
      `${c.id.padEnd(15)} vol=${volume.toFixed(6).padStart(14)} ref=${String(c.volume).padStart(14)} ` +
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
