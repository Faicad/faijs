/**
 * 一次性脚本：把 out/ref-all31 里 BevelGear 的用例（case08–13）并入
 * fixtures/reference/manifest.json，并把参考 STEP 拷进 fixtures/reference/。
 *
 * 用法：npx tsx scripts/merge-bevel-reference.ts
 */

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = resolve(fileURLToPath(import.meta.url), '..')
const PKG = resolve(HERE, '..')
const SRC_DIR = resolve(PKG, 'out', 'ref-all31')
const DST_DIR = resolve(PKG, 'fixtures', 'reference')

interface Case {
  id: string
  class: string
  [k: string]: unknown
}

const src = JSON.parse(readFileSync(resolve(SRC_DIR, 'manifest.json'), 'utf-8')) as {
  cases: Case[]
}
const dstPath = resolve(DST_DIR, 'manifest.json')
const dst = JSON.parse(readFileSync(dstPath, 'utf-8')) as {
  cases: Case[]
  environment_note?: string
  [k: string]: unknown
}

const bevel = src.cases.filter((c) => c.class === 'BevelGear')
if (bevel.length !== 6) throw new Error(`expected 6 BevelGear cases, got ${bevel.length}`)

const existing = new Set(dst.cases.map((c) => c.id))
for (const c of bevel) {
  if (existing.has(c.id)) {
    dst.cases = dst.cases.filter((x) => x.id !== c.id)
  }
  copyFileSync(resolve(SRC_DIR, `${c.id}.step`), resolve(DST_DIR, `${c.id}.step`))
}

// 插到 case07 之后，保持 case 编号有序
const insertAt = dst.cases.findIndex((c) => c.id === 'case07-SpurGear') + 1
dst.cases.splice(insertAt, 0, ...bevel)

dst.environment_note =
  'environment 记录的是本文件最后一次「spike 集」写入时的解释器；'
  + '所有 `caseXX-*` 条目（含本次并入的 case08–13 BevelGear）与 out/ref-all31/manifest.json '
  + '逐字节一致，即由 cadquery 2.8.0 / python 3.13.14 / cq_gears e73874c 生成。'

writeFileSync(dstPath, `${JSON.stringify(dst, null, 2)}\n`, 'utf-8')
console.log(`merged ${bevel.length} BevelGear cases; total now ${dst.cases.length}`)
console.log(dst.cases.map((c) => c.id).join(','))
