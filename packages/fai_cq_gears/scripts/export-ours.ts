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
import { buildSpurGearSolid } from '../src/spur_gear'
import type { SpurGearParams } from '../src/profile'
import type { SplineFaceStrategy } from '../src/spline-face'
import type { RawOcctKernel } from '../src/kernel'
import type { BrepHandle } from '@faicad/faijs-core'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** 按用例构造我们这一侧的形状（目前只支持 SpurGear 与 Box 对照体）。 */
export function buildOurShape(
  kernel: RawOcctKernel,
  c: ReferenceCase,
  strategy: SplineFaceStrategy,
): BrepHandle {
  if (c.class === 'Box') {
    const { width = 10, depth = 20, height = 30 } = c.args as Record<string, number>
    return kernel.makeBoxFromCorners(
      { x: -width / 2, y: -depth / 2, z: -height / 2 },
      { x: width / 2, y: depth / 2, z: height / 2 },
    )
  }
  if (c.class === 'SpurGear') {
    return buildSpurGearSolid(kernel, c.args as unknown as SpurGearParams, { strategy })
  }
  throw new Error(`export-ours: 尚未支持的类 ${c.class}`)
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
