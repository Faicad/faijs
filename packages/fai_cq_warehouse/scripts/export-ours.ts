/**
 * export-ours — 用 fai_cq_warehouse 生成对照 STEP（等价性比对的 B 侧）
 *
 * 前置：先跑 `scripts/gen-reference.py`（A 侧 manifest + STEP 入库）。
 *
 * 用法：
 *   npx tsx scripts/export-ours.ts [--case <id>] [--out out]
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { exportStepFromSolids } from '@faicad/faijs-core'
import { setupWarehouseKernel } from '../src/test-setup'
import { requireKernel } from '../src/kernel'
import { loadManifest, ourStepPath, threadCases, OUT_DIR } from '../src/testing/fixtures'
import { buildThreadReference } from '../src/testing/reference-options'
import type { BrepHandle } from '@faicad/faijs-core'
import type { ManifestCase } from '../src/testing/reference-options'

/** 从一条 manifest 用例构造 B 侧几何（W3 只覆盖线程族）。
 *
 * @param c manifest 用例
 * @returns BREP 句柄（`simple=true` 时为 null）
 * @throws 当 class 不属于线程族
 */
export function buildOurSolid(c: ManifestCase): BrepHandle | null {
  switch (c.class) {
    case 'Thread':
    case 'IsoThread':
    case 'AcmeThread':
    case 'MetricTrapezoidalThread':
    case 'PlasticBottleThread':
      return buildThreadReference(c).handle
    default:
      throw new Error(`export-ours: 尚未支持的类 ${c.class}（W3 只覆盖线程族）`)
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  await setupWarehouseKernel()
  const kernel = requireKernel()
  const outDir = arg('out') ?? OUT_DIR
  mkdirSync(outDir, { recursive: true })

  const only = arg('case')
  const manifest = loadManifest()
  const cases = threadCases(manifest).filter((c) => !only || c.id === only)
  if (cases.length === 0) {
    // 无命中即为用法错误：id 写错时静默跳过会让人误以为「已通过」
    console.error(`[export-ours] 无匹配用例（--case ${only ?? '(未指定)'}）`)
    process.exitCode = 2
    return
  }

  let ok = 0
  let skipped = 0
  for (const c of cases) {
    const solid = buildOurSolid(c)
    if (!solid) {
      console.log(`- ${c.id}: simple=true（无几何），跳过`)
      skipped++
      continue
    }
    const step = exportStepFromSolids(kernel, [{ solid, name: 'SOLID' }])
    const path = only ? `${outDir}/${c.id}.step` : ourStepPath(c.id)
    writeFileSync(path, Buffer.from(step))
    console.log(`✓ ${c.id} -> ${path}`)
    ok++
  }
  console.log(`\n[export-ours] ${ok} 导出，${skipped} 跳过`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
