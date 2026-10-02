/**
 * merge-reference — 把外部目录生成的参考用例并入入库清单
 * （`fixtures/reference/manifest.json` + 对应 STEP）。
 *
 * `gen-reference.py` 默认写到入库目录；但当参考集分批生成时（`--set spike` /
 * `regression` / `pairs` 各自落到 `out/ref-*`），需要一个小工具做「按 id 合并」：
 * 同 id 覆盖、新 id 插入、STEP 一并拷入。**不重排已有条目的顺序**（历史顺序即记录）。
 *
 * 用法：
 *   npx tsx scripts/merge-reference.ts --from out/ref-pairs --class BevelGearPair
 *   npx tsx scripts/merge-reference.ts --from out/ref-pairs --class all
 *
 * 参数：
 *   --from   含 `manifest.json` 与 `<id>.step` 的源目录（相对包根）
 *   --class  只并入该 `class` 的用例；`all` = 全部
 */

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = resolve(fileURLToPath(import.meta.url), '..')
const PKG = resolve(HERE, '..')
const DST_DIR = resolve(PKG, 'fixtures', 'reference')

interface Case {
  id: string
  class: string
  [k: string]: unknown
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** `case07-SpurGear` → 7；非 `caseNN-*` 形态返回 null。 */
function caseIndex(id: string): number | null {
  const m = /^case(\d+)-/.exec(id)
  return m ? Number(m[1]) : null
}

function main(): void {
  const from = arg('from')
  const cls = arg('class')
  if (!from) throw new Error('merge-reference: --from <dir> is required')
  if (!cls) throw new Error('merge-reference: --class <ClassName|all> is required')

  const srcDir = resolve(PKG, from)
  const src = JSON.parse(readFileSync(resolve(srcDir, 'manifest.json'), 'utf-8')) as {
    cases: Case[]
    environment?: Record<string, string>
  }
  const dstPath = resolve(DST_DIR, 'manifest.json')
  const dst = JSON.parse(readFileSync(dstPath, 'utf-8')) as {
    cases: Case[]
    environment_note?: string
    [k: string]: unknown
  }

  const picked = cls === 'all' ? src.cases : src.cases.filter((c) => c.class === cls)
  if (picked.length === 0) {
    throw new Error(`merge-reference: no case with class ${cls} in ${from}/manifest.json`)
  }
  for (const c of picked) {
    if (c.error) throw new Error(`merge-reference: ${c.id} failed at generation: ${String(c.error)}`)
  }

  // 同 id 覆盖：先记住被替换者的位置，删除后按该位置插回，保持顺序稳定。
  const replaced = new Map<number, Case>()
  for (const c of picked) {
    const at = dst.cases.findIndex((x) => x.id === c.id)
    if (at >= 0) replaced.set(at, c)
  }
  const insertedIds = new Set(picked.map((c) => c.id))
  const merged: Case[] = []
  for (let i = 0; i < dst.cases.length; i++) {
    const repl = replaced.get(i)
    if (repl) merged.push(repl)
    else if (!insertedIds.has(dst.cases[i].id)) merged.push(dst.cases[i])
  }

  // 新增条目（源里存在、目标里没有）：`caseNN-*` 按号码插到最后一个 ≤ NN 的位置之后，
  // 其余（spike / pair 命名）追加到末尾。
  const fresh = picked.filter((c) => !dst.cases.some((x) => x.id === c.id))
  for (const c of fresh) {
    const n = caseIndex(c.id)
    if (n === null) { merged.push(c); continue }
    let at = merged.length
    for (let i = merged.length - 1; i >= 0; i--) {
      const mi = caseIndex(merged[i].id)
      if (mi !== null && mi <= n) { at = i + 1; break }
    }
    merged.splice(at, 0, c)
  }

  for (const c of picked) {
    copyFileSync(resolve(srcDir, `${c.id}.step`), resolve(DST_DIR, `${c.id}.step`))
  }

  dst.cases = merged
  const env = src.environment
  dst.environment_note = env
    ? `environment 记录的是本文件最后一次写入时的解释器（本次：cadquery `
      + `${env.cadquery ?? '?'} / python ${env.python ?? '?'} / cq_gears ${env.cq_gears_src_git_sha ?? '?'}）。`
      + '所有 `caseXX-*` 条目与 `out/ref-all31/manifest.json` 逐字节一致。'
    : dst.environment_note

  writeFileSync(dstPath, `${JSON.stringify(dst, null, 2)}\n`, 'utf-8')
  console.log(`merged ${picked.length} case(s) from ${from} (class=${cls}); total now ${merged.length}`)
  console.log(merged.map((c) => c.id).join(','))
}

main()
