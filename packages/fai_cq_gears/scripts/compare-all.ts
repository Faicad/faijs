/**
 * compare-all — 批量比对 A 侧（CadQuery 参考 STEP）与 B 侧（fai_cq_gears 产出）
 *
 * 前置：先跑 `scripts/gen-reference.py`（A 侧）与 `scripts/export-ours.ts`（B 侧）。
 *
 * 用法：
 *   npx tsx scripts/compare-all.ts [--case spur-basic] [--json]
 */

import { writeFileSync } from 'node:fs'
import { loadManifest, OUT_DIR, stepPath } from '../src/fixtures'
import {
  compareCase, formatCompareLine, type CaseCompareInput,
} from '../src/testing/compare'
import type { StepCompareResult } from '@faicad/cq-compat'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const only = arg('case')
  const asJson = process.argv.includes('--json')
  const manifest = loadManifest()
  const cases = only ? manifest.cases.filter((c) => c.id === only) : manifest.cases

  const results: Array<{ id: string; equivalent: boolean; line: string; details: string[] }> = []

  for (const c of cases) {
    if (c.volume === undefined) {
      console.log(`- ${c.id}: 无参考体积，跳过`)
      continue
    }
    const input: CaseCompareInput = {
      id: c.id,
      referenceStep: stepPath(c.id),
      ourStep: `${OUT_DIR}/${c.id}.step`,
      refVolume: c.volume,
    }
    let r: StepCompareResult
    try {
      r = await compareCase(input)
    } catch (e) {
      console.log(`✗ ${c.id}: 比对抛错 ${(e as Error).message}`)
      results.push({ id: c.id, equivalent: false, line: String((e as Error).message), details: [] })
      continue
    }
    const line = formatCompareLine(r)
    console.log(`${r.equivalent ? '✓' : '✗'} ${c.id.padEnd(15)} ${line}`)
    if (!r.equivalent && !asJson) {
      for (const d of r.details) console.log(`      ${d}`)
    }
    results.push({ id: c.id, equivalent: r.equivalent, line, details: r.details })
  }

  if (asJson) {
    console.log(JSON.stringify({ results }, null, 2))
  } else {
    writeFileSync(`${OUT_DIR}/compare-summary.json`, JSON.stringify({ results }, null, 2), 'utf-8')
    const failed = results.filter((r) => !r.equivalent)
    console.log(
      `\n[compare-all] ${results.length - failed.length}/${results.length} 等价` +
      (failed.length ? `；不一致：${failed.map((f) => f.id).join(', ')}` : ''),
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
