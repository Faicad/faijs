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
export const PROJECTED_MODULES = ['topology', 'measurement', 'text', 'projection', 'query', 'ns', 'gear', '2d', 'io', 'operations', 'core', 'sketching', 'kernel'] as const

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
 * brep-op 模板（P23 起）：`compatOp(projectBrepOp(…), spec)` 一行/符号（§4.3.2）。
 *
 * P14 之前是「逐 op 展开 defineOp」；P23 改为走 P21 的双形态投影包装
 * （{@link projectBrepOp}：单内核断言 + D11 对象形态→位置形态归一 + callBrepjs），
 * 再由 {@link compatOp} 套上语句边界六步契约（静态分派门 → 借入 → Result
 * unwrap → 收养）。每符号一行，机制只有一份（§4.2）。
 */
function renderBrepOp(entry: ArgSpecEntry): string {
  const { exportName } = parseSource(entry.source)
  const vendoredName = `__vendored_${exportName}`
  const formClass = entry.formClass ?? 'A'
  return [
    `/**`,
    ` * ${entry.name} — brepjs 投影（生成文件，禁手改；来源 api/surface/arg-spec.ts）。`,
    ` * ${entry.args ?? ''}`,
    ` * 桥接：compatOp(projectBrepOp(…))——单内核断言 + D11 归一 + 语句边界六步契约（§4.3.2）。`,
    ` */`,
    `export const ${entry.name} = compatOp(`,
    `  projectBrepOp('${entry.name}', ${JSON.stringify(entry.params ?? [])}, '${formClass}', ${vendoredName}),`,
    `  { name: '${entry.name}', consumes: ${JSON.stringify(entry.consumes ?? 'all')} },`,
    `)`,
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

/** 组装某模块的 import 区（按需装配，避免未使用 import 触发 lint/tsc）。
 *  P23 起 brep-op 经 compatOp(projectBrepOp(…)) 包装——借入/收养/调用都收在
 *  compat-op/compat-projection 内，生成文件自身只需要 query 的桥接工具。 */
function renderImports(entries: ArgSpecEntry[]): string[] {
  const hasBrep = entries.some((e) => e.kind === 'brep-op')
  const hasQuery = entries.some((e) => e.kind === 'query')

  const lines: string[] = []
  if (hasBrep) {
    lines.push(`import { compatOp } from '../internal/compat-op'`)
    lines.push(`import { projectBrepOp } from '../internal/compat-projection'`)
  }
  if (hasQuery) {
    lines.push(`import { borrowBrepjsShape, callBrepjs } from '../internal/l3-bridge'`)
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

// ── P23：cad 脚本面同源接线（§4.2 ② / B1 三源一致） ──

/** script-face 生成文件路径。 */
export const SCRIPT_FACE_FILE = path.join(OUT_DIR, 'script-face.ts')
/** script-face 清单生成文件路径（gen-symbol-table 的单一数据源）。 */
export const SCRIPT_FACE_MANIFEST_FILE = path.join(OUT_DIR, 'script-face-manifest.ts')

/** P23 script-face 条目（arg-spec 里标记了 scriptFace 的语句级 op）。 */
export function scriptFaceEntries(): ArgSpecEntry[] {
  return ARG_SPEC.filter((e) => e.kind === 'brep-op' && e.scriptFace === true)
}

/**
 * 生成 `api/generated/script-face.ts`：脚本面 op 的命名 re-export + 命名空间对象。
 * `api-namespace.ts` 与 `api/index.ts` 都从这里取（B1：同源）。
 */
export function generateScriptFace(): string {
  const entries = scriptFaceEntries()
  if (entries.length === 0) throw new Error('[gen-l3-surface] script-face 条目为空（arg-spec 未标记 scriptFace）')
  const byModule = new Map<string, ArgSpecEntry[]>()
  for (const e of entries) {
    const m = moduleOf(e)
    if (!byModule.has(m)) byModule.set(m, [])
    byModule.get(m)!.push(e)
  }
  const lines: string[] = [
    '/**',
    ' * generated/script-face.ts — 生成文件，禁手改。',
    ' * 由 packages/core/scripts/gen-l3-surface.ts 依据 api/surface/arg-spec.ts 的',
    ' * `scriptFace: true` 条目生成（P23 §4.2 ②：cad 脚本面 = faijs 特有 dual op + 本清单）。',
    ' * 单一来源（B1）：api-namespace / api/index / gen-symbol-table 都从这里取，',
    ' * 不允许手写第二份清单。',
    ' */',
    '',
  ]
  for (const [m, list] of byModule) {
    lines.push(`import { ${list.map((e) => e.name).join(', ')} } from './${m}'`)
    lines.push(`export { ${list.map((e) => e.name).join(', ')} } from './${m}'`)
  }
  lines.push('')
  lines.push('/** cad 脚本面新增 op 的命名空间对象（api-namespace 展开进 cad）。 */')
  lines.push('export const scriptFaceOps = {')
  for (const e of entries) lines.push(`  ${e.name},`)
  lines.push('} as const')
  lines.push('')
  return lines.join('\n')
}

/**
 * 生成 `api/generated/script-face-manifest.ts`：脚本面清单数据。
 * `gen-symbol-table.ts` 与三源一致测试都消费它（check() 符号表同源，§6.1 B1）。
 */
export function generateScriptFaceManifest(): string {
  const entries = scriptFaceEntries()
  const lines: string[] = [
    '/**',
    ' * generated/script-face-manifest.ts — 生成文件，禁手改。',
    ' * 由 packages/core/scripts/gen-l3-surface.ts 依据 api/surface/arg-spec.ts 生成。',
    ' * cad 脚本面新增 op 清单（P23 B1 三源一致：导出面 ≡ cad 面 ≡ check() 符号表）。',
    ' */',
    '',
    '/** 一条 cad 脚本面新增 op。 */',
    'export interface ScriptFaceOp {',
    '  /** faijs 面导出名（= brepjs 符号名）。 */',
    '  name: string',
    '  /** 所属分片模块（生成文件名）。 */',
    '  module: string',
    '  /** defineOp/compatOp 的 consumes 声明（缺省 \'all\'）。 */',
    "  consumes: 'all' | 'none'",
    '}',
    '',
    '/** Cad script-face op manifest (B1: single source for cad namespace, check() symbol table). */',
    'export const SCRIPT_FACE_OPS: readonly ScriptFaceOp[] = [',
  ]
  for (const e of entries) {
    const consumes = e.consumes ?? 'all'
    if (consumes !== 'all' && consumes !== 'none') {
      throw new Error(`[gen-l3-surface] script-face 条目 ${e.name} 的 consumes 必须是 'all'|'none'（got ${JSON.stringify(consumes)}）`)
    }
    lines.push(`  { name: '${e.name}', module: '${moduleOf(e)}', consumes: '${consumes}' },`)
  }
  lines.push(']')
  lines.push('')
  return lines.join('\n')
}

/** P13 兼容：generate() == topology（顶层模块，旧调用不变）。 */
export function generate(): string {
  assertIntersectStaysSkip()
  return generateModule('topology')
}

/**
 * §4.8 生成期守卫：`topology/api.js#intersect` 永远不允许进入 brep-op /
 * scriptFace。faijs 的 cad.intersect 是 variadic、async、带 keepHidden 时间线副
 * 作用、roleTable 合流的 dual-op；brepjs 的 intersect 是二元同步 Result，仅驻留
 * compat 面。若上游 intersect 被投出，必须先改名 faijs 面（含 UI ops 与存量迁移）。
 */
function assertIntersectStaysSkip(): void {
  for (const e of ARG_SPEC) {
    if (e.source !== 'topology/api.js#intersect') continue
    if (e.kind !== 'skip' || e.scriptFace === true) {
      throw new Error(
        '[gen-l3-surface] §4.8 守卫被触发：' +
          'topology/api.js#intersect 被标记为 ' +
          `${e.kind}${e.scriptFace === true ? ' / scriptFace:true' : ''}。` +
          'faijs 侧的 intersect 必须先改名为 intersect_all（含 UI ops 与存量迁移）才允许投影。',
      )
    }
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const requested = args.length > 0 ? new Set(args) : null
  assertIntersectStaysSkip()
  fs.mkdirSync(OUT_DIR, { recursive: true })
  for (const m of PROJECTED_MODULES) {
    if (requested && !requested.has(m)) continue
    const out = generatedOutputPath(m)
    fs.writeFileSync(out, generateModule(m), 'utf-8')
    const projected = ARG_SPEC.filter((e) => (e.module ?? 'topology') === m && e.kind !== 'skip').length
    console.log(`[gen-l3-surface] wrote ${m} (${projected} projections) -> ${path.relative(process.cwd(), out)}`)
  }
  // P23：cad 脚本面接线产物（§4.2 ② / B1 三源一致）
  fs.writeFileSync(SCRIPT_FACE_FILE, generateScriptFace(), 'utf-8')
  console.log(`[gen-l3-surface] wrote script-face -> ${path.relative(process.cwd(), SCRIPT_FACE_FILE)}`)
  fs.writeFileSync(SCRIPT_FACE_MANIFEST_FILE, generateScriptFaceManifest(), 'utf-8')
  console.log(`[gen-l3-surface] wrote script-face-manifest -> ${path.relative(process.cwd(), SCRIPT_FACE_MANIFEST_FILE)}`)
}

// 仅在直接运行时执行（测试 import 时跳过）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}