/**
 * gen-l3-surface — L3 投影生成器（E5，P13 机制验证点）
 *
 * 设计文档：docs/plans/2026-09-02-faijs-api-surface-completion.md §E5 / §5.2
 *
 * 输入：api/surface/arg-spec.ts（ARG_SPEC：人工签名适配表，唯一人工维护点）
 *       api/surface/upstream-surface.json（brepjs 基线清单，用于校验符号存在）
 * 产物：api/generated/<module>.ts（按模块分片；P13a 首片 topology.ts）
 *
 * 产出规则（对齐 §5.2 / E5 分类表）：
 *   kind 'type'   → `export type { X } from '<vendored rel>'`（re-export）
 *   kind 'pure'   → `export { x } from '<vendored rel>'`（直接 re-export，不进 defineOp）
 *   kind 'brep-op'→ defineOp({ brep: (...args) => 借入→调 vendored→Result 翻转→adopt })
 *   kind 'query'  → 普通导出函数（输入 faijs Shape 借入 → 调 vendored → 返回纯数据；
 *                    不进 defineOp——返回非 Shape，先例 = api/geom.ts）
 *   kind 'skip'   → 仅登记（本表之外不生成，符号已在 exclusions/divergence 处置）
 *
 * P13a 只生成 ARG_SPEC 首批样本（4 条）；全量铺开在 P14（逐模块扩充 ARG_SPEC）。
 *
 * 运行：npx tsx packages/core/scripts/gen-l3-surface.ts
 */

import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'url'
import { ARG_SPEC, type ArgSpecEntry, type ProjectionKind } from '../src/api/surface/arg-spec'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SURFACE_JSON = path.resolve(__dirname, '..', 'src', 'api', 'surface', 'upstream-surface.json')
const VENDORED_ROOT_REL = '../../vendored/brepjs/' // from api/generated/ -> src/vendored/brepjs/
const OUT_DIR = path.resolve(__dirname, '..', 'src', 'api', 'generated')

/** module 分片名（首片 topology）。 */
const MODULE = 'topology'
const OUTPUT = path.join(OUT_DIR, `${MODULE}.ts`)
export const generatedOutputPath = OUTPUT

interface SurfaceSymbol {
  name: string
  kind: 'value' | 'type'
  module: string
  file: string
}

function loadSurfaceSymbols(): SurfaceSymbol[] {
  const raw = JSON.parse(fs.readFileSync(SURFACE_JSON, 'utf-8')) as { symbols: SurfaceSymbol[] }
  return raw.symbols.filter((s) => s.module === MODULE)
}

/** 'topology/shapeFns.js#Bounds3D' -> { file: 'topology/shapeFns.js', exportName: 'Bounds3D' } */
function parseSource(source: string): { file: string; exportName: string } {
  const idx = source.indexOf('#')
  if (idx < 0) throw new Error(`[gen-l3-surface] bad source '${source}' (expected '<file>.js#<Export>')`)
  return { file: source.slice(0, idx), exportName: source.slice(idx + 1) }
}

function vendoredImportSpec(file: string): string {
  // api/generated/topology.ts -> ../../vendored/brepjs/<file>（.ts 源与 .js 说明符并存于 brepjs 树）
  return `${VENDORED_ROOT_REL}${file}`
}

// ── per-kind 模板 ──

function renderType(entry: ArgSpecEntry): string {
  const { file, exportName } = parseSource(entry.source)
  return `export type { ${exportName} } from '${vendoredImportSpec(file)}'`
}

function renderPure(entry: ArgSpecEntry): string {
  const { file, exportName } = parseSource(entry.source)
  return `export { ${exportName} } from '${vendoredImportSpec(file)}'`
}

/**
 * brep-op 模板：defineOp({ brep })。几何输入（geometryArgs）经 borrowBrepjsShape
 * 借入 brepjs handle；vendored 调用 Result 翻转（returnsResult: err → throw）；
 * 产物 adoptBrepjsProduct 转入 faijs Shape。参数透传保持 brepjs 位置形态（E2 新符号无
 * faijs 旧形态，直接以 brepjs 签名暴露——sheetmetal 迁移目标，§U7 移植库可搬运）。
 */
function renderBrepOp(entry: ArgSpecEntry, surfaceName?: string): string {
  const { file, exportName } = parseSource(entry.source)
  const vendoredImport = `__vendored_${exportName}`
  const geometryArgs = new Set(entry.geometryArgs ?? [])
  // 按调用时的 args 逐位重建 brepjs 位置参数：几何输入借入 brepjs handle，
  // 其余（数值/options 等值参）原样透传——arity 由调用方决定，不静态假设。
  const borrowLine =
    geometryArgs.size > 0
      ? `    const __args = args.map((__a, __i) => (${JSON.stringify([...geometryArgs])}.includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))`
      : `    const __args = args`
  // callBrepjs 保留 ReturnType（Result 保持 .ok/.value），并规避固定 arity 的 spread TS2556。
  const callExpr = `callBrepjs(${vendoredImport}, __args)`
  const resultVar = '__r'
  const unwrap = entry.returnsResult === false
    ? `    return adoptBrepjsProduct(${resultVar})`
    : `    if (!${resultVar}.ok) throw new Error('[faijs/generated] ${entry.name}: ' + (${resultVar}.error?.message ?? 'vendored op failed'))\n    return adoptBrepjsProduct(${resultVar}.value)`

  // faijs 消费方以位置参数调用；defineOp 的 brep 实现接收原始 args。
  const lines = [
    `/**`,
    ` * ${entry.name} — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。`,
    ` * ${entry.args ?? ''}`,
    ` * 桥接：几何输入借入 brepjs handle → 调 vendored → ${entry.returnsResult === false ? '产物 adopt' : 'Result 翻转 → adopt'}（E5 模板）。`,
    ` */`,
    `export const ${entry.name} = defineOp({`,
    `  brep: (...args: unknown[]) => {`,
    borrowLine,
    `    const ${resultVar} = ${callExpr}`,
    unwrap,
    `  },`,
    `  consumes: ${JSON.stringify(entry.consumes ?? 'all')}`,
    `})`,
  ]
  return lines.join('\n')
}

/**
 * query 模板：普通导出函数（先例 api/geom.ts——查询返回非 Shape，不走 defineOp）。
 * 输入 faijs Shape（geometryArgs[0]）借入 brepjs；返回纯数据原样透传。
 * 满足 export-JSDoc 门禁：显式返回标注（entry.returnType，需在导入面可引用）
 * + `@param`/`@returns` 描述。
 */
function renderQuery(entry: ArgSpecEntry): string {
  const { file, exportName } = parseSource(entry.source)
  const vendoredImport = `__vendored_${exportName}`
  const borrowLine = `  const g = borrowBrepjsShape(shape as Shape)`
  // returnType 缺省时无法给明确的返回标注（门禁拒绝推断返回），query 条目必须显式声明。
  if (!entry.returnType) {
    throw new Error(`[gen-l3-surface] query '${entry.name}' 缺少 returnType（export-JSDoc 门禁要求显式返回标注）`)
  }
  const returnType = entry.returnType
  const callLine = `  return ${vendoredImport}(g as never)`
  return [
    `/**`,
    ` * ${entry.name} — brepjs 投影查询（生成文件，禁手改；来源 api/surface/arg-spec.ts）。`,
    ` * ${entry.args ?? ''}`,
    ` * 输入 faijs Shape 借入 brepjs handle，返回纯数据（consumes 语义由查询表达式承载）。`,
    ` *`,
    ` * @param shape - 被测量的 faijs Shape（其 brep 槽位被借入 vendored 树）。`,
    ` * @returns ${returnType} 纯数据结果（非 Shape，不进 defineOp）。`,
    ` */`,
    `export function ${entry.name}(shape: Shape): ${returnType} {`,
    borrowLine,
    callLine,
    `}`,
  ].join('\n')
}

function renderImports(entries: ArgSpecEntry[]): string {
  const imports: string[] = [
    `import { defineOp } from '../../sdk'`,
    `import type { Shape } from '../../mesh/types'`,
    `import { borrowBrepjsShape, adoptBrepjsProduct, callBrepjs } from '../internal/l3-bridge'`,
  ]
  const vendored = new Set<string>()
  // type/pure 由自身的 `export … from …` 承担（不产生本地绑定）；只有
  // brep-op/query 需要本地别名值 import（__vendored_*，供实现体引用），
  // query 还需把 returnType 以 `import type` 引入作用域供返回标注使用。
  const needLocalImport = (k: ProjectionKind) => k === 'brep-op' || k === 'query'
  for (const e of entries) {
    if (e.kind === 'skip' || !needLocalImport(e.kind)) continue
    const { file, exportName } = parseSource(e.source)
    const key = `${file}#${exportName}`
    if (!vendored.has(key)) {
      vendored.add(key)
      imports.push(`import { ${exportName} as __vendored_${exportName} } from '${vendoredImportSpec(file)}'`)
    }
    if (e.kind === 'query' && e.returnType) {
      const returnKey = `${file}#type:${e.returnType}`
      if (!vendored.has(returnKey)) {
        vendored.add(returnKey)
        imports.push(`import type { ${e.returnType} } from '${vendoredImportSpec(file)}'`)
      }
    }
  }
  return imports.join('\n')
}

// ── 主入口 ──

/**
 * Pure generation: returns the generated `api/generated/<module>.ts` source
 * for the current ARG_SPEC, without touching the filesystem.
 * Shared by `main()` (writes the artifact) and the P13 mechanism test
 * (compares against the committed artifact — sync guard, api-dts-sync pattern).
 *
 * @throws when an ARG_SPEC entry is missing from the surface baseline (U7).
 * @returns the full generated module source (header + imports + per-kind bodies).
 */
export function generate(): string {
  const surfaceSymbols = loadSurfaceSymbols()
  const byName = new Map(surfaceSymbols.map((s) => [s.name, s]))
  const entries = ARG_SPEC.filter((e) => e.kind !== 'skip')

  // 校验：每个待生成条目必须在 surface 基线中存在（U7 零遗漏的反向护栏）
  const missing = entries.filter((e) => !byName.has(e.name))
  if (missing.length > 0) {
    throw new Error(
      `[gen-l3-surface] arg-spec 条目不在 topology surface 基线中: ${missing.map((m) => m.name).join(', ')}`,
    )
  }

  const header = `/**\n * generated/${MODULE}.ts — 生成文件，禁手改。\n * 由 packages/core/scripts/gen-l3-surface.ts 从 api/surface/arg-spec.ts 生成（E5/P13）。\n * topology 模块 ${entries.length} 个投影符号（ARG_SPEC 首批样本；全量在 P14 扩充）。\n */\n`
  const chunks: string[] = []
  for (const e of entries) {
    if (e.kind === 'type') chunks.push(renderType(e))
    else if (e.kind === 'pure') chunks.push(renderPure(e))
    else if (e.kind === 'brep-op') chunks.push(renderBrepOp(e, byName.get(e.name)?.name))
    else if (e.kind === 'query') chunks.push(renderQuery(e))
  }
  const body = renderImports(entries) + '\n\n' + chunks.join('\n\n') + '\n'
  return header + body
}

function main(): void {
  const output = generate()
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUTPUT, output, 'utf-8')
  const count = ARG_SPEC.filter((e) => e.kind !== 'skip').length
  console.log(`[gen-l3-surface] wrote ${count} projections -> ${path.relative(process.cwd(), OUTPUT)}`)
}

// Only run main() when executed directly (not when imported by tests)
const directRun = fileURLToPath(import.meta.url) === (process.argv[1] ? path.resolve(process.argv[1]) : '')
if (directRun) {
  main()
}
