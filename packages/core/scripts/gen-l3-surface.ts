/**
 * gen-l3-surface — L3 投影生成器（E5，P13 机制 / P14 全量分片）
 *
 * 设计文档：docs/plans/2026-09-02-faijs-api-surface-completion.md §E5 / §5.2
 *
 * 输入：api/surface/arg-spec.ts（ARG_SPEC：人工签名适配表，唯一人工维护点）
 *       api/surface/upstream-surface.json（brepjs 基线清单，用于校验符号存在）
 * 产物：api/generated/<module>.ts（按模块分片；从 PROJECTED_MODULES 逐个生成）
 *
 * 产物形态（对齐 §5.2 / E5 分类表）：
 *   kind 'type'   → `export type { X } from '<vendored rel>'`（re-export）
 *   kind 'pure'   → `export { x } from '<vendored rel>'`（直接 re-export，不进 defineOp）
 *   kind 'brep-op'→ defineOp({ brep: (...args) => 借入→调 vendored→Result 翻转→adopt })
 *   kind 'query'  → 普通导出函数（faijs Shape 借入 → 调 vendored → 返回纯数据；
 *                   返回非 Shape，不进 defineOp——先例 = api/geom.ts）
 *   kind 'skip'   → 仅登记（不生成，divergence：语义 faijs 面无法表达）
 *
 * 运行：npx tsx packages/core/scripts/gen-l3-surface.ts [module...]（缺省 = all）
 */

import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'url'
import { ARG_SPEC, type ArgSpecEntry } from '../src/api/surface/arg-spec'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SURFACE_JSON = path.resolve(__dirname, '..', 'src', 'api', 'surface', 'upstream-surface.json')
const VENDORED_ROOT_REL = '../../vendored/brepjs/' // from api/generated/ -> src/vendored/brepjs/
const OUT_DIR = path.resolve(__dirname, '..', 'src', 'api', 'generated')

/** 已登记分片的模块名（写产物 + 机制测试遍历对象）。 */
export const PROJECTED_MODULES = ['topology', 'measurement', 'text', 'projection'] as const

/** 模块 → 产物文件路径。 */
export function generatedOutputPath(module: string): string {
  return path.join(OUT_DIR, `${module}.ts`)
}

interface SurfaceSymbol {
  name: string
  kind: 'value' | 'type'
  module: string
  file: string
}

function loadSurfaceSymbols(): SurfaceSymbol[] {
  const raw = JSON.parse(fs.readFileSync(SURFACE_JSON, 'utf-8')) as { symbols: SurfaceSymbol[] }
  return raw.symbols
}

/** 'topology/shShapeFns.js#Bounds3D' -> { file, exportName } */
function parseSource(source: string): { file: string; exportName: string } {
  const by = source.lastIndexOf('#')
  if (by < 0) throw new Error(`[gen-l3-surface] bad source '${source}' (expected '<file>.js#<Export>')`)
  return { file: source.slice(0, by), exportName: source.slice(by + 1) }
}

function vendoredImportSpec(file: string): string {
  // api/generated/<module>.ts -> ../../vendored/brepjs/<file>
  return `${VENDORED_ROOT_REL}${file}`
}

/** 条目所属模块（缺省 topology，P13 兼容）。 */
const moduleOf = (e: ArgSpecEntry): string => e.module ?? 'topology'

const BUILTIN_TYPES = new Set(['number', 'string', 'boolean', 'bigint', 'symbol', 'undefined', 'null', 'object', 'void', 'unknown', 'any', 'never'])

/** query 返回值根类型名（用于 `import type`）；内置/空则返回 undefined。 */
function returnTypeImport(e: ArgSpecEntry): string | undefined {
  if (e.kind !== 'query' || !e.returnType) return undefined
  const rt = e.returnType.replace(/\[\]$/, '') // T[] → T
  if (BUILTIN_TYPES.has(rt)) return undefined
  return rt
}

// ── per-kind 渲染 ──

function renderType(entry: ArgSpecEntry): string {
  const { file, exportName } = parseSource(entry.source)
  return `export type { ${exportName} } from '${vendoredImportSpec(file)}'`
}

function renderPure(entry: ArgSpecEntry): string {
  const { file, exportName } = parseSource(entry.source)
  return `export { ${exportName} } from '${vendoredImportSpec(file)}'`
}

/**
 * brep-op 模板：defineOp({ brep })。几何输入（geometryArgs 索引）经 borrowBrepjsShape
 * 借入 brepjs handle；vendored 调用经 callBrepjs（Result 保持 .ok/.value，规避 arity）；
 * returnsResult 非 false 时 Result 翻转（err → throw），产物 adoptBrepjsProduct 转入 faijs Shape。
 */
function renderBrepOp(entry: ArgSpecEntry): string {
  const { exportName } = parseSource(entry.source)
  const vendoredName = `__vendored_${exportName}`
  const geometry = new Set(entry.geometryArgs ?? [])
  const borrowLine =
    geometry.size > 0
      ? `    const __args = args.map((__a, __i) => (${JSON.stringify([...geometry])}.includes(__i) ? borrowBrepjsShape(__a as Shape) : __a))`
      : `    const __args = args`
  const callExpr = `callBrepjs(${vendoredName}, __args)`
  const unwrap =
    entry.returnsResult === false
      ? `    return adoptBrepjsProduct(__r)`
      : `    if (!__r.ok) throw new Error('[faijs/generated] ${entry.name}: ' + (__r.error?.message ?? 'vendored op failed'))\n    return adoptBrepjsProduct(__r.value)`

  return [
    `/**`,
    ` * ${entry.name} — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。`,
    ` * ${entry.args ?? ''}`,
    ` * 桥接：几何输入借入 brepjs handle → 调 vendored → ${entry.returnsResult === false ? '产物 adopt' : 'Result 翻转 → adopt'}（E5 模板）。`,
    ` */`,
    `export const ${entry.name} = defineOp({`,
    `  brep: (...args: unknown[]) => {`,
    borrowLine,
    `    const __r = ${callExpr}`,
    unwrap,
    `  },`,
    `  consumes: ${JSON.stringify(entry.consumes ?? 'all')}`,
    `})`,
  ].join('\n')
}

/**
 * query 模板：普通导出函数（先例 api/geom.ts——查询返回纯数据，不进 defineOp）。
 * arguments 由 queryParams 描述（缺省单参 shape）。geometryArgs 索引的 faijs Shape 借入
 * brepjs handle；geometryCollectionArgs 索引是 Shape 数组，逐元素借入；其余数值/选项原样透传。
 * 返回类型必须显式标注 + `@returns`（export-JSDoc 门禁）。
 */
function renderQuery(entry: ArgSpecEntry): string {
  const { exportName } = parseSource(entry.source)
  if (!entry.returnType) {
    throw new Error(`[gen-l3-surface] query '${entry.name}' 缺少 returnType（export-JSDoc 门禁要求显式返回标注）`)
  }
  const returnType: string = entry.returnType.endsWith('[]') ? `${entry.returnType.slice(0, -2)}[]` : entry.returnType
  const geomAt = new Set(entry.geometryArgs ?? [])
  const arrayAt = new Set(entry.geometryCollectionArgs ?? [])
  const params = entry.queryParams ?? [{ name: 'shape', type: 'Shape' }]

  // faiss 面签名：几何位类型 = Shape / Shape[]，其余按 params[].type
  const faParams = params.map((p, i) => {
    const type = geomAt.has(i) ? 'Shape' : arrayAt.has(i) ? 'Shape[]' : p.type
    return `${p.name}${p.optional ? '?' : ''}: ${type}`
  })

  // 调用实参：几何位（单 Shape）借入；数组位逐元素借入；其余原样
  const argItems = params.map((p, i) => {
    if (geomAt.has(i)) return `borrowBrepjsShape(${p.name} as Shape)`
    if (arrayAt.has(i)) return `(${p.name} as Shape[]).map((s) => borrowBrepjsShape(s))`
    return p.name
  })
  const callExpr = `callBrepjs(__vendored_${exportName}, [${argItems.join(', ')}])`
  const body =
    entry.returnsResult === false
      ? `  return ${callExpr}`
      : `  const __r = ${callExpr}\n  if (!__r.ok) throw new Error('[faijs/generated] ${entry.name}: query failed')\n  return __r.value`

  const docParams = params.map((p, i) => {
    const kind = geomAt.has(i) ? '可形状参数' : arrayAt.has(i) ? 'Shape 数组' : '数值/选项参数'
    return ` * @param ${p.name} - ${kind}（${p.docs ?? '原样透传'}）`
  })

  return [
    `/**`,
    ` * ${entry.name} — 查询（返回纯数据，非 Shape）生成文件，勿手改；来源 api/surface/arg-spec.ts。`,
    ` * ${entry.args ?? ''}`,
    ` * 输入 faijs Shape 借入 brepjs handle → 调 vendored → 返回纯数据（consumes 语义由查询表达式承载）。`,
    ` *`,
    ...docParams,
    ` * @returns ${returnType} — 纯数据结果（非 Shape）。`,
    ` */`,
    `export function ${entry.name}(${faParams.join(', ')}): ${returnType} {`,
    body,
    `}`,
  ].join('\n')
}

/** 组装某模块的 import 区（按需装配，避免未使用 import 触发 lint/tsc）。 */
function renderImports(entries: ArgSpecEntry[]): string[] {
  const hasBrep = entries.some((e) => e.kind === 'brep-op')
  const hasQuery = entries.some((e) => e.kind === 'query')
  const needsBridge = hasBrep || hasQuery

  const lines: string[] = []
  if (hasBrep) lines.push(`import { defineOp } from '../../sdk'`)
  if (needsBridge) {
    const bridgeParts = ['borrowBrepjsShape']
    if (hasBrep) bridgeParts.push('adoptBrepjsProduct')
    bridgeParts.push('callBrepjs')
    lines.push(`import { ${bridgeParts.join(', ')} } from '../internal/l3-bridge'`)
    lines.push(`import type { Shape } from '../../mesh/types'`)
  }
  const seenValue = new Set<string>()
  const seenType = new Set<string>()
  for (const e of entries) {
    if (e.kind === 'skip') continue
    const { file, exportName } = parseSource(e.source)
    if (e.kind !== 'type' && e.kind !== 'pure') {
      const vk = `${file}#${exportName}`
      if (!seenValue.has(vk)) {
        seenValue.add(vk)
        lines.push(`import { ${exportName} as __vendored_${exportName} } from '${vendoredImportSpec(file)}'`)
      }
    }
    if (e.kind === 'query') {
      const root = returnTypeImport(e)
      if (root && !seenType.has(`${file}#${root}`)) {
        seenType.add(`${file}#${root}`)
        lines.push(`import type { ${root} } from '${vendoredImportSpec(file)}'`)
      }
    }
  }
  return lines
}

function renderModuleHeader(module: string, count: number, skipped: number): string {
  return `/**\n * generated/${module}.ts — 生成文件，勿手改。\n * 由 packages/core/scripts/gen-l3-surface.ts 依据 api/surface/arg-spec.ts 生成（E5/P14 分片）。\n * ${module} 模块：${count} 个投影符号${skipped > 0 ? `；另有 ${skipped} 个 skip 登记` : ''}。\n */\n`
}

/**
 * 纯生成某一模块产物（不落盘），供 main() 与机制测试共同使用。
 * @throws 条目缺失于 surface 基线（U7 反向护栏）
 */
export function generateModule(module: string): string {
  const symbols = loadSurfaceSymbols()
  const inModule = symbols.filter((s) => s.module === module)
  const base = new Map(inModule.map((s) => [s.name, s]))
  // 只取本模块条目（缺省 module=topology），skip 不产出
  const entries = ARG_SPEC.filter((e) => moduleOf(e) === module)
  const missing = entries.filter((e) => e.kind !== 'skip' && !base.has(e.name))
  if (missing.length > 0) {
    throw new Error(`[gen-l3-surface] ${module} 中条目缺失: ${missing.map((m) => m.name).join(', ')}`)
  }

  const projected = entries.filter((e) => e.kind !== 'skip')
  const skipped = entries.filter((e) => e.kind === 'skip')
  const header = renderModuleHeader(module, projected.length, skipped.length)
  const chunks: string[] = []
  for (const e of projected) {
    switch (e.kind) {
      case 'type': chunks.push(renderType(e)); break
      case 'pure': chunks.push(renderPure(e)); break
      case 'brep-op': chunks.push(renderBrepOp(e)); break
      case 'query': chunks.push(renderQuery(e)); break
    }
  }
  const imports = renderImports(projected)
  return header + (imports.length > 0 ? imports.join('\n') + '\n\n' : '') + chunks.join('\n\n') + '\n'
}

/** P13 兼容：generate() == topology（顶层模块，旧调用不变）。 */
export function generate(): string {
  return generateModule('topology')
}

function main(): void {
  const args = process.argv.slice(2)
  const requested = args.length > 0 ? new Set(args) : null
  fs.mkdirSync(OUT_DIR, { recursive: true })
  for (const m of PROJECTED_MODULES) {
    if (requested && !requested.has(m)) continue
    const out = generatedOutputPath(m)
    fs.writeFileSync(out, generateModule(m), 'utf-8')
    const projected = ARG_SPEC.filter((e) => (e.module ?? 'topology') === m && e.kind !== 'skip').length
    console.log(`[gen-l3-surface] wrote ${m} (${projected} projections) -> ${path.relative(process.cwd(), out)}`)
  }
}

// 仅在直接运行时执行（测试 import 时跳过）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}