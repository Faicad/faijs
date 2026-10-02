/**
 * check-column-semantics.ts — column-semantics.yaml 的自洽性双向扫描（方案 §5.3.1）。
 *
 *  正向：上游目录里每张 CSV 的每一列，在 yaml 的 columns 列表里都必须有条目
 *        （漏一列 → 红）；yaml 引用了不存在的 CSV → 红。
 *  反向：yaml 里每条 columns 条目都必须是已知求值器 id（悬空 id → 红）；
 *        每张表必须声明 source 与 mode；mode 必须已知。
 *
 * 用法：node --experimental-strip-types scripts/check-column-semantics.ts [--upstream DIR]
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const argOf = (name: string, fb: string) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fb
}
const UPSTREAM = argOf(
  '--upstream',
  process.env.FAI_CQ_UPSTREAM ?? 'C:/git/CADQ/cq_warehouse/src/cq_warehouse',
)

const KNOWN_MODES = new Set([
  'parameters',
  'parameters_metric',
  'clearance_holes',
  'tap_holes',
  'drill_sizes',
  'nominal_screw_lengths',
])
const KNOWN_EVALUATORS = new Set([
  'key',
  'safe_eval',
  'safe_eval_metric',
  'clearance_hole_ref',
  'tap_hole_ref',
  'drill_diameter_imperial',
  'nominal_unit',
  'nominal_sizes',
])

const errors: string[] = []

const specs = parseYaml(
  readFileSync(join(HERE, 'column-semantics.yaml'), 'utf8'),
) as Record<string, { source: string; mode: string; columns?: string[] }>

const csvFiles = existsSync(UPSTREAM)
  ? readdirSync(UPSTREAM).filter((f) => f.endsWith('.csv'))
  : []
if (csvFiles.length === 0) {
  console.error(`[check-column-semantics] no CSVs found under ${UPSTREAM} (set FAI_CQ_UPSTREAM)`)
  process.exit(2)
}

// 反向：yaml → CSV
const yamlSources = new Set<string>()
for (const [table, spec] of Object.entries(specs)) {
  yamlSources.add(spec.source)
  if (!csvFiles.includes(spec.source))
    errors.push(`yaml table ${table}: source ${spec.source} does not exist upstream`)
  if (!KNOWN_MODES.has(spec.mode))
    errors.push(`yaml table ${table}: unknown mode ${spec.mode}`)
  if (!spec.columns || spec.columns.length === 0)
    errors.push(`yaml table ${table}: missing columns list`)
  else
    for (const ev of spec.columns)
      if (!KNOWN_EVALUATORS.has(ev))
        errors.push(`yaml table ${table}: unknown evaluator id ${ev}`)
  if (spec.columns && spec.columns[0] !== 'key')
    errors.push(`yaml table ${table}: first column must be the key evaluator`)
}

// 正向：CSV → yaml
for (const csv of csvFiles) {
  if (!yamlSources.has(csv)) {
    errors.push(`upstream csv ${csv} has no yaml entry`)
    continue
  }
  const header = readFileSync(join(UPSTREAM, csv), 'utf8')
    .split(/\r?\n/)[0]!
    .split(',')
  const entry = Object.entries(specs).find(([, s]) => s.source === csv)!
  const cols = entry[1].columns ?? []
  if (cols.length !== header.length)
    errors.push(
      `${csv}: column count mismatch yaml=${cols.length} csv=${header.length}`,
    )
}

if (errors.length > 0) {
  for (const e of errors) console.error(`[check-column-semantics] FAIL: ${e}`)
  process.exit(1)
}
console.log(
  `[check-column-semantics] ok: ${Object.keys(specs).length} yaml tables / ${csvFiles.length} upstream CSVs, all columns covered`,
)
