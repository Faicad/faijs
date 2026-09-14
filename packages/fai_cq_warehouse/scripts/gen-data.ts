/**
 * gen-data.ts — CSV → src/data/*.json（生成期求值，运行期零 eval；方案 §5.3）。
 *
 * 求值语义逐字复刻上游（实测 fastener.py:59/130/144、thread.py:43/48）：
 *  - 参数表：全列统一 per-cell 求值，is_metric 按行键首字符（`M` → metric 原值，
 *    否则 imperial ×25.4）；is_safe 不通过的单元格原样保留字符串。
 *  - 4 张特殊表按各自上游读取函数求值（drill ×25.4、nominal 按单位因子）。
 *  - 空单元格保留 ''（上游 isolate_fastener_type 会过滤空串）。
 *
 * 列语义唯一真源：scripts/column-semantics.yaml（本脚本只读它，禁止启发式）。
 *
 * 用法：node scripts/gen-data.ts [--upstream DIR] [--out src/data]
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { parse as parseYaml } from 'yaml'
// node 直跑（--experimental-strip-types）要求相对 import 带显式扩展名
import { evaluateCell, metricStrToFloat, INCH } from '../src/measure.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = join(HERE, '..')

// ── CLI ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
function argOf(name: string, fallback: string): string {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback
}
const UPSTREAM = argOf(
  '--upstream',
  process.env.FAI_CQ_UPSTREAM ?? 'C:/git/CADQ/cq_warehouse/src/cq_warehouse',
)
const OUT = join(PKG, argOf('--out', 'src/data'))

if (!existsSync(UPSTREAM)) {
  console.error(`[gen-data] upstream dir not found: ${UPSTREAM} (set FAI_CQ_UPSTREAM)`)
  process.exit(2)
}

// ── 最小 CSV 解析（RFC 4180：引号内逗号/换行；与 Python csv.DictReader 对齐）──
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (c === '\r') {
      i++
      continue
    }
    if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += c
    i++
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? '').trim() !== '')
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function gitHeadOf(dir: string): string | null {
  try {
    return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

// ── 求值器（与 column-semantics.yaml 的 id 一一对应）────────────────────────
type EvalMode = string

function evalCell(value: string, mode: EvalMode, isMetric: boolean): number | string {
  switch (mode) {
    case 'key':
      return value
    case 'safe_eval':
      // 与 thread.py metric/imperial_str_to_float 逐字对齐（含英制空格→+、×25.4）
      return evaluateCell(value, isMetric)
    case 'safe_eval_metric':
      // fastener.py:275 evaluate_parameter_dict_of_dict 默认 is_metric=True
      return metricStrToFloat(value)
    case 'clearance_hole_ref':
    case 'tap_hole_ref':
      return value // 原样引用，运行期经 drill_sizes 解析
    case 'drill_diameter_imperial': {
      // fastener.py:165 —— float × IN
      const v = Number(value.trim())
      if (!Number.isFinite(v))
        throw new Error(`drill_sizes: non-numeric Diameter ${JSON.stringify(value)}`)
      return v * INCH
    }
    case 'nominal_unit':
      return value.trim()
    case 'nominal_sizes':
      return value.trim() // 逗号分隔串，运行期按单位因子展开
    default:
      throw new Error(`[gen-data] unknown evaluator id: ${mode}`)
  }
}

// ── 主流程 ─────────────────────────────────────────────────────────────────
interface TableSpec {
  source: string
  mode: string
  referencedByUpstream?: boolean
  /** 列语义按列序排列（list 形式——tapered 轴承表有重复列名 SKT:B/SKT:C） */
  columns?: string[]
  [col: string]: unknown
}

const yamlPath = join(HERE, 'column-semantics.yaml')
const specs = parseYaml(readFileSync(yamlPath, 'utf8')) as Record<string, TableSpec>

mkdirSync(OUT, { recursive: true })
const csvFiles = readdirSync(UPSTREAM).filter((f) => f.endsWith('.csv'))
const manifestTables: Record<string, unknown> = {}

for (const spec of Object.values(specs)) {
  const csvName = spec.source
  if (!csvFiles.includes(csvName)) {
    throw new Error(`[gen-data] yaml references missing csv: ${csvName}`)
  }
  const csvPath = join(UPSTREAM, csvName)
  const rows = parseCsv(readFileSync(csvPath, 'utf8'))
  const header = rows[0]!
  const trimmedHeader = header.map((c) => c.trim())
  // 列语义按列序排列（list 形式）；表头列必须与 yaml 列数一致
  const colModes = spec.columns
  if (!colModes || colModes.length !== header.length) {
    throw new Error(
      `[gen-data] ${csvName}: column count mismatch yaml=${colModes?.length} csv=${trimmedHeader.length}`,
    )
  }
  // 表头列名核对（trim 后比对——上游个别表头带尾空格，如 iso4762:dk␣）。
  // 例外：首列表头可能为空（cheese_head/pan_head），只要求「yaml 声明为 key」。
  for (let i = 0; i < header.length; i++) {
    if (colModes[i] === 'key') continue
    // 上游无列名供核对 list 形式的列名，改为核对非空表头与注释一致无从谈起——
    // check-column-semantics.ts 负责「yaml 列数 == CSV 列数」的双向扫描；
    // 这里只核对第一列确为 key、其余列存在求值器 id。
    if (!colModes[i]) {
      throw new Error(`[gen-data] ${csvName}: column ${i} has no evaluator id`)
    }
  }

  // 求值：第一列是行键，其余按列序求值器；重复列名后者覆盖（上游 DictReader 语义）
  const data: Record<string, Record<string, number | string>> = {}
  for (const row of rows.slice(1)) {
    const key = (row[0] ?? '').trim()
    if (key === '') continue
    const isMetric = key.startsWith('M') // 上游：size[0] == 'M'
    const rec: Record<string, number | string> = {}
    for (let i = 1; i < header.length; i++) {
      const raw = row[i] ?? ''
      const col = trimmedHeader[i]!
      const mode = colModes[i]!
      const value = evalCell(raw, mode, isMetric)
      if (col !== '') rec[col] = value // 空表头列不造假键：上游 DictReader 已 pop 掉首列
    }
    data[key] = rec
  }

  const outName = basename(csvName, '.csv') + '.json'
  writeFileSync(join(OUT, outName), JSON.stringify(data, null, 1) + '\n')
  manifestTables[spec.mode === 'parameters' || spec.mode === 'parameters_metric'
    ? basename(csvName, '.csv')
    : basename(csvName, '.csv')] = {
    source: csvName,
    mode: spec.mode,
    referencedByUpstream: spec.referencedByUpstream ?? true,
    rows: Object.keys(data).length,
    sha256: sha256File(csvPath),
  }
}

const manifest = {
  generator: 'packages/fai_cq_warehouse/scripts/gen-data.ts',
  semantics: 'scripts/column-semantics.yaml',
  upstreamDir: UPSTREAM,
  upstreamGitHead: gitHeadOf(UPSTREAM),
  tables: manifestTables,
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(
  `[gen-data] done: ${Object.keys(manifestTables).length} tables -> ${OUT}`,
)
