/**
 * compare-all — 批量比对 A 侧（CadQuery 参考 STEP）与 B 侧（fai_cq_warehouse 产出）
 *
 * 前置：先跑 `scripts/gen-reference.py`（A 侧）与 `scripts/export-ours.ts`（B 侧）。
 *
 * 用法：
 *   npx tsx scripts/compare-all.ts [--case <id>] [--json]
 *
 * 容差只在 `src/testing/compare.ts` 里定义（方案 §7.3 红线）。
 */

import { writeFileSync } from 'node:fs'
import { loadManifest, stepPath, ourStepPath, threadCases, OUT_DIR } from '../src/testing/fixtures'
import {
  classifyKnownArtifact,
  compareCase,
  formatCompareLine,
  type CaseCompareInput,
} from '../src/testing/compare'
import type { AssemblyCompareResult } from '@faicad/cq-compat'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const only = arg('case')
  const asJson = process.argv.includes('--json')
  const manifest = loadManifest()
  const cases = threadCases(manifest).filter((c) => !only || c.id === only)

  const results: Array<{
    id: string
    equivalent: boolean
    artifact: boolean
    line: string
    details: string[]
  }> = []

  for (const c of cases) {
    const input: CaseCompareInput = {
      id: c.id,
      referenceStep: stepPath(c.id),
      ourStep: ourStepPath(c.id),
      refVolume: c.volume_mesh ?? c.volume,
    }
    let r: AssemblyCompareResult
    try {
      r = await compareCase(input)
    } catch (e) {
      console.log(`✗ ${c.id}: 比对抛错 ${(e as Error).message}`)
      results.push({
        id: c.id,
        equivalent: false,
        artifact: false,
        line: String((e as Error).message),
        details: [],
      })
      continue
    }
    const verdict = classifyKnownArtifact(c.id, r)
    const mark = r.equivalent ? '✓' : verdict.artifact ? '△' : '✗'
    const line = formatCompareLine(r)
    console.log(`${mark} ${c.id.padEnd(26)} ${line}`)
    if (verdict.artifact) console.log(`      已知 A 侧伪差：${verdict.reason}`)
    if (!r.equivalent && !verdict.artifact && !asJson)
      for (const d of r.details) console.log(`      ${d}`)
    results.push({ id: c.id, equivalent: r.equivalent, artifact: verdict.artifact, line, details: r.details })
  }

  if (asJson) {
    console.log(JSON.stringify({ results }, null, 2))
  } else {
    writeFileSync(`${OUT_DIR}/compare-summary.json`, JSON.stringify({ results }, null, 2), 'utf-8')
    const hard = results.filter((r) => !r.equivalent && !r.artifact)
    const accepted = results.length - hard.length
    console.log(
      `\n[compare-all] ${accepted}/${results.length} 通过（其中 ${results.filter((r) => r.artifact).length} 例为已归因的 A 侧伪差）` +
        (hard.length ? `；真不一致：${hard.map((f) => f.id).join(', ')}` : ''),
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
