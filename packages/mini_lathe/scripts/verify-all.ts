/**
 * verify-all — mini_lathe 全部零件 + 装配的「装配一致性」验证（2026-09-08 修复后）
 *
 * 前置：先重导出全部零件 + 装配：
 *   pwsh -NoProfile packages/mini_lathe/scripts/export-all.ps1
 *
 * 检查项（用户铁律：所有 STEP 比对必须走装配一致性比对）：
 * 1. 每个零件 STEP → 期望 leaf 数（compound 被拆成多零件 = 失败）；
 *    slide_mid 例外 = 2 leaf：底座 z∈[-3,8] 与块体 z∈[11,24.7] 无重叠
 *    （面接触/间隙，union 不熔合）——既有真实几何，legacy 快照同为 2 leaf。
 * 2. 装配 STEP → 恰 6 个 leaf，名字 = axk/bp/mb/mt/slide_top/tp
 *    （修复前旧导出把 slide_top 拆成 2 → 7 个）。
 * 3. slide_top 体积/包围盒硬断言（修复后管线实测基线，见下）。
 * 4. compareAssemblyFiles：新 slide_top vs 旧 slide_top（旧=1 leaf 但内部 2-solid
 *    compound、v=90008.3）→ 必须 DIFFERENT。
 * 5. compareAssemblyFiles：新装配 vs 旧 7-leaf 工件 → 必须 DIFFERENT。
 *
 * 用法：npx tsx packages/mini_lathe/scripts/verify-all.ts
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { initOcctWasm, importAssemblyFromStep, collectLeafParts } from '@faicad/faijs-core'
import { compareAssemblyFiles } from '@faicad/cq-compat'

const ROOT = join(import.meta.dirname, '..')
const OUT = join(ROOT, 'out')
const LEGACY = join(OUT, 'legacy-buggy-2026-09-08')

/** 零件 → 期望 leaf 数。全部 1：union 熔合修复后 slide_mid 不再裂成 2（与 CadQuery ref 一致，
 *  STEP 比对 vol Δ=0 / 拓扑 f76,e181,v120 全同；旧断言"slide_mid=2"建立在修复前的 bug 行为上）。 */
const PARTS: Array<[name: string, expectedLeaves: number]> = [
  ['bottom_plate', 1],
  ['middle_bottom', 1],
  ['middle_top', 1],
  ['top_plate', 1],
  ['axk', 1],
  ['slide_top', 1],
  ['slide_mid', 1],
]
const ASM_PARTS = ['axk', 'bp', 'mb', 'mt', 'slide_top', 'tp']

/** slide_top 实测基线（2026-09-08 cboreHole 修复后重导出：沉孔深 = 精确 cboreDepth，不再 +1）。
 *  注意：这只是回归护栏；slide_top 与 CadQuery ref 尚有 2.5% 差（ref 多 3 面/2646mm³，
 *  移植脚本特征缺口，见 docs/plans/2026-09-08-cq-compat-cadquery-parity.md §11.3），
 *  与 ref 对齐后需再次更新本基线。 */
const SLIDE_TOP_EXPECTED = {
  volume: 86262.876, // 实测：cbore 修复后重导出 STEP 单 leaf（旧基线 88282.5 为 cbore+1 时代产物）
  zmax: 21.7, // boss 顶面（8 + 13.7）；boss 未熔合悬浮时也是 21.7，但 leaf 数由第 1 项拦截
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ ${msg}`)
    process.exitCode = 1
  } else {
    console.log(`✓ ${msg}`)
  }
}

async function main(): Promise<void> {
  const kernel = await initOcctWasm()

  // ── 1. 每个零件：期望 leaf 数 ──
  console.log('\n=== 1. 零件 leaf 数（compound 拆分检测） ===')
  for (const [p, expectedLeaves] of PARTS) {
    const buf = readFileSync(join(OUT, `${p}.step`))
    const nodes = await importAssemblyFromStep(buf.buffer as ArrayBuffer)
    const leaves = collectLeafParts(nodes).filter((n) => n.shapeHandle !== null)
    const vol = leaves[0] ? kernel.getVolume(leaves[0].shapeHandle as never) : NaN
    const bb = leaves[0] ? kernel.getBoundingBox(leaves[0].shapeHandle as never) : null
    const bbStr = bb
      ? `[${bb.xmin.toFixed(2)},${bb.ymin.toFixed(2)},${bb.zmin.toFixed(2)}]→[${bb.xmax.toFixed(2)},${bb.ymax.toFixed(2)},${bb.zmax.toFixed(2)}]`
      : 'n/a'
    console.log(`  ${p.padEnd(15)} leaves=${leaves.length}  vol=${vol.toFixed(1)}  bbox=${bbStr}  names=[${leaves.map((l) => l.name).join(', ')}]`)
    assert(leaves.length === expectedLeaves, `${p} 导出恰 ${expectedLeaves} 个 leaf（实际 ${leaves.length}）`)
  }

  // ── 2. 装配：恰 6 个 leaf，名字正确 ──
  console.log('\n=== 2. 装配结构 ===')
  const asmBuf = readFileSync(join(OUT, 'mini_lathe.step'))
  const asmNodes = await importAssemblyFromStep(asmBuf.buffer as ArrayBuffer)
  const asmLeaves = collectLeafParts(asmNodes).filter((n) => n.shapeHandle !== null)
  const asmNames = asmLeaves.map((n) => n.name).sort()
  console.log(`  leaves=${asmLeaves.length} names=[${asmNames.join(', ')}]`)
  assert(asmLeaves.length === 6, `装配 = 6 个 leaf（实际 ${asmLeaves.length}；修复前旧导出 slide_top 拆 2 → 7）`)
  const expectedNames = [...ASM_PARTS].sort()
  assert(
    asmNames.length === expectedNames.length && asmNames.every((n, i) => n === expectedNames[i]),
    `装配 leaf 名字 = ${expectedNames.join('/')}（实际 [${asmNames.join(', ')}]）`,
  )

  // ── 3. slide_top 几何基线 ──
  console.log('\n=== 3. slide_top 几何基线 ===')
  const stBuf = readFileSync(join(OUT, 'slide_top.step'))
  const stNodes = await importAssemblyFromStep(stBuf.buffer as ArrayBuffer)
  const stLeaves = collectLeafParts(stNodes).filter((n) => n.shapeHandle !== null)
  if (stLeaves.length === 1) {
    const h = stLeaves[0].shapeHandle as never
    const vol = kernel.getVolume(h)
    const bb = kernel.getBoundingBox(h)
    console.log(`  volume=${vol.toFixed(3)}  zmax=${bb.zmax.toFixed(3)}`)
    assert(Math.abs(vol - SLIDE_TOP_EXPECTED.volume) / SLIDE_TOP_EXPECTED.volume < 1e-3, `slide_top 体积 = ${SLIDE_TOP_EXPECTED.volume} ±0.1%（实际 ${vol.toFixed(3)}）`)
    assert(Math.abs(bb.zmax - SLIDE_TOP_EXPECTED.zmax) < 0.01, `slide_top zmax = ${SLIDE_TOP_EXPECTED.zmax}（实际 ${bb.zmax.toFixed(3)}）`)
  } else {
    assert(false, `slide_top 应恰 1 个 leaf（实际 ${stLeaves.length}）`)
  }

  // ── 4/5. 装配一致性比对：新 vs 旧 buggy 工件（必须 DIFFERENT）──
  // legacy 工件是修复前的一次性快照（out/ 已 gitignore，可能不存在）；
  // 缺失时跳过并提示，不再让整个验证崩在 ENOENT 上。
  console.log('\n=== 4/5. 装配一致性比对（新 vs 旧 buggy 工件） ===')
  const legacyDir = join(OUT, 'legacy-buggy-2026-09-08')
  if (!existsSync(join(legacyDir, 'slide_top.step'))) {
    console.log(`  (skip) legacy 工件不存在：${legacyDir} — 第 4/5 步跳过（结构性回归由 leaf 数断言覆盖）`)
  } else {
  const cmp1 = await compareAssemblyFiles(
    join(OUT, 'slide_top.step'),
    join(LEGACY, 'slide_top.step'),
  )
  console.log(`  slide_top(新 ${cmp1.structure.leafCountA} leaf) vs slide_top(旧 ${cmp1.structure.leafCountB} leaf): equivalent=${cmp1.equivalent}`)
  assert(!cmp1.equivalent, `新 slide_top vs 旧 slide_top（旧=1 leaf 但内部 2-solid compound，v=90008.3）必须不通过（几何/体积差异被装配比对捕获）`)

  const cmp2 = await compareAssemblyFiles(
    join(OUT, 'mini_lathe.step'),
    join(LEGACY, 'mini_lathe.step'),
  )
  console.log(`  装配(新 ${cmp2.structure.leafCountA} leaf) vs 装配(旧 ${cmp2.structure.leafCountB} leaf): equivalent=${cmp2.equivalent}`)
  assert(!cmp2.equivalent, `新装配(6 leaf) vs 旧装配(7 leaf) 必须不通过`)
  }

  console.log('\n' + (process.exitCode ? '✗ 存在失败项' : '✓ 全部通过'))
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
