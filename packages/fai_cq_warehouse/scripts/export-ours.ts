/**
 * export-ours — 用 fai_cq_warehouse 生成对照 STEP（等价性比对的 B 侧）
 *
 * 前置：先跑 `scripts/gen-reference.py`（A 侧 manifest + STEP 入库）。
 *
 * 用法：
 *   npx tsx scripts/export-ours.ts [--set <thread|nut|washer|screw|bearing|all>] [--case <id>] [--out out]
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { exportStepFromSolids } from '@faicad/faijs-core'
import { setupWarehouseKernel } from '../src/test-setup'
import { requireKernel } from '../src/kernel'
import { casesForSet, loadManifest, ourStepPath, OUT_DIR } from '../src/testing/fixtures'
import { buildBearingReference, buildNutReference, buildScrewReference, buildSprocketReference, buildThreadReference, buildWasherReference } from '../src/testing/reference-options'
import type { BrepHandle } from '@faicad/faijs-core'
import type { ManifestCase } from '../src/testing/reference-options'

/** 已知缺口的类（W4 `HeatSetNut` 需 `makeNSidedSurface`；W5 两个 PH 沉孔类的 30° 锥度切割器）。
 *
 * 这些类**有 A 侧数据、B 侧按设计抛错**，测试里逐例断言抛错。本脚本据此把「缺口」
 * 与「真失败」分开计数：缺口不置退出码，避免真失败被淹没。
 */
const KNOWN_GAP_CLASSES: ReadonlySet<string> = new Set([
  'HeatSetNut',
  'PanHeadWithCollarScrew',
  'RaisedCheeseHeadScrew',
])

/** 从一条 manifest 用例构造 B 侧几何（线程 / 螺母 / 垫圈 / 螺钉四族）。
 *
 * @param c manifest 用例
 * @returns BREP 句柄（`simple=true` 时线程族为 null）
 * @throws 当 class 不属于已移植的四族（含 W4/W5 的已知缺口类）
 */
export function buildOurSolid(c: ManifestCase): BrepHandle | null {
  switch (c.class) {
    case 'Thread':
    case 'IsoThread':
    case 'AcmeThread':
    case 'MetricTrapezoidalThread':
    case 'PlasticBottleThread':
      return buildThreadReference(c).handle
    case 'HexNut':
    case 'HexNutWithFlange':
    case 'DomedCapNut':
    case 'UnchamferedHexagonNut':
    case 'SquareNut':
    case 'BradTeeNut':
    case 'HeatSetNut':
      return buildNutReference(c).handle
    case 'PlainWasher':
    case 'ChamferedWasher':
    case 'CheeseHeadWasher':
      return buildWasherReference(c).handle
    case 'ButtonHeadScrew':
    case 'ButtonHeadWithCollarScrew':
    case 'CheeseHeadScrew':
    case 'CounterSunkScrew':
    case 'HexHeadScrew':
    case 'HexHeadWithFlangeScrew':
    case 'PanHeadScrew':
    case 'PanHeadWithCollarScrew':
    case 'RaisedCheeseHeadScrew':
    case 'RaisedCounterSunkOvalHeadScrew':
    case 'SetScrew':
    case 'SocketHeadCapScrew':
      return buildScrewReference(c).handle
    case 'SingleRowDeepGrooveBallBearing':
    case 'SingleRowCappedDeepGrooveBallBearing':
    case 'SingleRowAngularContactBallBearing':
    case 'SingleRowCylindricalRollerBearing':
    case 'SingleRowTaperedRollerBearing':
      return buildBearingReference(c).handle
    case 'Sprocket':
      return buildSprocketReference(c).handle
    default:
      throw new Error(`export-ours: 尚未支持的类 ${c.class}`)
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

  const setName = arg('set') ?? 'thread'
  const only = arg('case')
  const manifest = loadManifest()
  const cases = casesForSet(setName, manifest).filter((c) => !only || c.id === only)
  if (cases.length === 0) {
    // 无命中即为用法错误：id 写错时静默跳过会让人误以为「已通过」
    console.error(`[export-ours] 无匹配用例（--set ${setName} --case ${only ?? '(未指定)'}）`)
    process.exitCode = 2
    return
  }

  let ok = 0
  let skipped = 0
  let knownGap = 0
  let failed = 0
  for (const c of cases) {
    let solid: BrepHandle | null
    try {
      solid = buildOurSolid(c)
    } catch (e) {
      // 已知缺口（W4 HeatSetNut / W5 PH 沉孔类）走这里：如实报错、不静默、不中断整批。
      // 缺口**不**算失败（退出码保持 0）——它已在测试里被逐例断言，批处理脚本再红一次
      // 只会让「真失败」淹没在「已知缺口」里。未声明的类则必须响亮失败。
      if (KNOWN_GAP_CLASSES.has(c.class)) {
        console.error(`○ ${c.id}: 已知缺口 — ${(e as Error).message}`)
        knownGap++
      } else {
        console.error(`✗ ${c.id}: ${(e as Error).message}`)
        failed++
      }
      continue
    }
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
  console.log(
    `\n[export-ours] set=${setName}：${ok} 导出，${skipped} 跳过，${knownGap} 已知缺口，${failed} 失败`,
  )
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
