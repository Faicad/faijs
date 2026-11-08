/**
 * check-consume-corpus — 语言级消费规则的离线语料扫描（方案 2026-11-08 §9.8 / F6）
 *
 * 规则（§9.3）：变量在其**销毁型消费点**之后再被引用 → `E_USE_AFTER_CONSUME`。
 * 本脚本在**不执行几何**的前提下扫源码，给出"如果切到 error 档，哪些脚本会报错"
 * 的清单，用于决定 warn 期长度与迁移批量。
 *
 * 判定口径（**唯一**，2026-11-08 用户规定）：`lineConsumes` 判真即消费 ——
 * 该变量必须释放、且此后不得再引用。**不做 op 语义分类**：布尔运算、`cad.assembly`
 * 成员、`sheet.solidOf`、`cad.fai_drill` 一视同仁。要保留输入的脚本改成 `keep()`。
 *
 * 静态误差（只影响报告标注，不参与过滤）：形状集合按"所有 outputs 都当几何值"过近似，
 * 比运行期"按 ctx 现值做结构判定"更宽，于是 `splitByPlane` 之类返回 SplitResult 的
 * 生产者会被算成 findable——这类候选标 `note: 'producer 可能非几何'`。
 *
 * 用法：
 *   npx tsx scripts/check-consume-corpus.ts <dir-or-file> [...] [--json]
 * 退出码恒 0（报告工具，不是门禁）；`--json` 输出机器可读结构。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { extractMetadata } from '../packages/core/src/lang/metadata-extractor'
import { lineConsumes, keepViewFromMetadata } from '../packages/core/src/cad-runtime/live-shapes'
import { asPartName } from '../packages/core/src/identity'
import type { StatementSummary } from '../packages/core/src/lang/statement-summary'

/** 返回非单一几何（SplitResult 等）的生产者：仅用于给候选加注。 */
const NON_SHAPE_PRODUCERS = new Set(['splitByPlane', 'splitByBox', 'splitByCylinder', 'split'])

interface Candidate {
  file: string
  name: string
  producerLine: number
  consumeLine: number
  useLine: number
  calleeAtConsume: string
  /** 静态过近似可能造成的假阳说明（运行期按 ctx 结构判定不会命中） */
  note?: string
}

/** 递归收集 .fai.js（也接受显式文件路径）。 */
function collectFiles(target: string): string[] {
  const out: string[] = []
  const abs = resolve(target)
  const st = statSync(abs)
  if (st.isFile()) {
    out.push(abs)
    return out
  }
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const child = join(abs, entry.name)
    if (entry.isDirectory()) out.push(...collectFiles(child))
    else if (entry.name.endsWith('.fai.js')) out.push(child)
  }
  return out
}

/**
 * 扫一个文件，返回违规候选。
 * @param file - 绝对路径（只用于报告）
 * @param code - 源码文本
 * @returns 候选清单
 */
function scanFile(file: string, code: string): Candidate[] {
  const meta = extractMetadata(code)
  const lines: StatementSummary[] = meta.lines
  const keep = keepViewFromMetadata(meta)
  // 过近似：所有产出名都当几何值（运行期用 ctx 现值结构判定，见文件头）
  const shapeNames = new Set(meta.lines.flatMap((l) => l.outputs.map((o) => asPartName(o))))
  const lastProducer = new Map<string, number>()
  lines.forEach((l, i) => {
    if (!l.hasAssignment) return
    for (const o of l.outputs) lastProducer.set(String(o), i)
  })

  const candidates: Candidate[] = []
  lines.forEach((line, i) => {
    for (const name of line.refs ?? []) {
      const producerIdx = lastProducer.get(name)
      if (producerIdx === undefined || producerIdx >= i) continue
      // 消费点 = producer 之后第一条 lineConsumes 为真的语句（唯一口径）
      let consumeIdx = -1
      for (let j = producerIdx + 1; j < lines.length; j++) {
        if (lineConsumes(lines[j], asPartName(name), keep, shapeNames)) {
          consumeIdx = j
          break
        }
      }
      if (consumeIdx < 0 || consumeIdx >= i) continue
      const producerCallee = lines[producerIdx].callee
      candidates.push({
        file,
        name,
        producerLine: lines[producerIdx].line,
        consumeLine: lines[consumeIdx].line,
        useLine: line.line,
        calleeAtConsume: lines[consumeIdx].callee,
        ...(NON_SHAPE_PRODUCERS.has(producerCallee)
          ? { note: `producer ${producerCallee} 返回非单一几何，运行期结构判定不会命中` }
          : {}),
      })
    }
  })
  return candidates
}

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const targets = argv.filter((a) => !a.startsWith('--'))
if (targets.length === 0) {
  console.error('usage: npx tsx scripts/check-consume-corpus.ts <dir-or-file> [...] [--json]')
  process.exit(1)
}

const all: Candidate[] = []
const skipped: Array<{ file: string; reason: string }> = []
let fileCount = 0
for (const target of targets) {
  for (const file of collectFiles(target)) {
    fileCount++
    const code = readFileSync(file, 'utf8')
    try {
      all.push(...scanFile(file, code))
    } catch (err) {
      skipped.push({ file, reason: err instanceof Error ? err.message : String(err) })
    }
  }
}

if (asJson) {
  console.log(JSON.stringify({
    files: fileCount,
    rule: 'lineConsumes（唯一口径，无 op 白名单）',
    violations: all,
    skipped,
  }, null, 2))
} else {
  console.log(`scanned ${fileCount} file(s)  rule=lineConsumes（唯一口径）`)
  console.log(`violations: ${all.length}`)
  if (skipped.length > 0) console.log(`skipped (parse error): ${skipped.length}`)
  const byFile = new Map<string, Candidate[]>()
  for (const c of all) {
    const list = byFile.get(c.file) ?? []
    list.push(c)
    byFile.set(c.file, list)
  }
  for (const [file, list] of byFile) {
    console.log(`\n${file}`)
    for (const c of list) {
      console.log(`  line ${c.useLine}: "${c.name}" reused after consume at line ${c.consumeLine} ` +
        `(producer line ${c.producerLine}, callee ${c.calleeAtConsume})` +
        (c.note ? `  [${c.note}]` : ''))
    }
  }
  for (const s of skipped) console.log(`\nSKIP ${s.file}: ${s.reason}`)
}
