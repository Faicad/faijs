/**
 * gen-l3-surface — L3 投影生成器（E5，P13 机制 / P14 全量分片）
 *
 * 输入：api/surface/arg-spec.ts（ARG_SPEC：人工签名适配表，唯一人工维护点）

 * 产物：api/generated/<module>.ts（按模块分片；从 PROJECTED_MODULES 逐个生成）
 *
 * 产物形态（core 第一方实现，2026-10-07 清理 vendored 死分支）：
 *   kind 'brep-op'→ defineOp({ brep: __own_* })——直连 core 自有实现（api/brep-operations/）
 *   kind 'query'  → 普通导出函数（getBrepApi().* 直连引擎，CORE_QUERY_EXPR；
 *                   返回纯数据，不进 defineOp——先例 = api/geom.ts）
 *   kind 'faijs'  → re-export 自手写 api/ 模块（P25 自研符号）
 *   kind 'skip'   → 仅登记（不生成，divergence：语义 faijs 面无法表达）
 *   （历史 kind 'type' / 'pure' 已无条目，出现即抛错）
 *
 * 运行：npx tsx packages/core/scripts/gen-l3-surface.ts [module...]（缺省 = all）
 */

import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'url'
import { ARG_SPEC, type ArgSpecEntry } from '../src/api/surface/arg-spec'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)


const OUT_DIR = path.resolve(__dirname, '..', 'src', 'api', 'generated')

/** 已登记分片的模块名（写产物 + 机制测试遍历对象）。 */
export const PROJECTED_MODULES = ['topology', 'measurement', 'text', 'projection', 'query', 'ns', 'gear', '2d', 'io', 'operations', 'core', 'sketching', 'kernel', 'view'] as const

/** 模块 → 产物文件路径。 */
export function generatedOutputPath(module: string): string {
  return path.join(OUT_DIR, `${module}.ts`)
}


/** 'topology/shShapeFns.js#Bounds3D' -> { file, exportName } */
function parseSource(source: string): { file: string; exportName: string } {
  const by = source.lastIndexOf('#')
  if (by < 0) throw new Error(`[gen-l3-surface] bad source '${source}' (expected '<file>.js#<Export>')`)
  return { file: source.slice(0, by), exportName: source.slice(by + 1) }
}

/** 条目所属模块（缺省 topology，P13 兼容）。 */
const moduleOf = (e: ArgSpecEntry): string => e.module ?? 'topology'

// ── per-kind 渲染 ──

/**
 * faijs 自研符号（P25，kind 'faijs'）：手写实现模块（api/view/）re-export 进 L3 面。
 *
 * 与 type/pure 的差异：source 指向**手写 API 模块**（api/view/index.js）而非 vendored
 * 树——生成器不产实现、不做 vendored import；条目也不进 upstream-surface 基线
 * （faijs 自研符号，generateModule 的 U7 反向护栏对 'faijs' 跳过）。
 *
 * 相对路径：api/generated/<module>.ts -> api/view/index.js（同一 api/ 层）。
 */
function renderFaijs(entry: ArgSpecEntry): string {
  const { file, exportName } = parseSource(entry.source)
  return `export { ${exportName} } from '../${file}'`
}

/**
 * brep-op 模板：`defineOp({ brep: __own_<exportName>, … })` 直连 core 自有实现
 * （api/brep-operations/）。全部 brep-op 条目均直连 core 自有实现；
 * D11 归一在自有实现内部完成。
 */
function renderBrepOp(entry: ArgSpecEntry): string {
  const { exportName } = parseSource(entry.source)
  // Phase 2.2 guard: brep-op + scriptFace=true requires naming declaration.
  if (entry.scriptFace === true && !entry.naming) {
    throw new Error(
      `[gen-l3-surface] brep-op '${entry.name}' has scriptFace=true but no naming declaration (Phase 2.2 guard). ` +
      `Add a 'naming' field with the op's Provenance (plan §4.4).`,
    )
  }
  const namingLit = entry.naming ? `, naming: ${JSON.stringify(entry.naming)}` : ''
  const capsLit = entry.capabilities?.length ? `, capabilities: ${JSON.stringify(entry.capabilities)}` : ''
  const enginesLit = entry.engines?.length ? `, engines: ${JSON.stringify(entry.engines)}` : ''
  const outputsLit = entry.outputs?.length ? `, outputs: ${JSON.stringify(entry.outputs)}` : ''
  const schemaLit = entry.schema ? `, schema: ${JSON.stringify(entry.schema)}` : ''
  const slotMapLit = entry.slotMap ? `, slotMap: ${JSON.stringify(entry.slotMap)}` : ''
  // P26 (unit-system D8): dimension declarations thread into the defineOp
  // so the static dimension stage can read them.
  const paramDimsLit = entry.paramDims ? `, paramDims: ${JSON.stringify(entry.paramDims)}` : ''
  const retDimLit = entry.retDim ? `, retDim: ${JSON.stringify(entry.retDim)}` : ''

  const ownName = `__own_${exportName}`
  return [
    `/**`,
    ` * ${entry.name} — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。`,
    ` * ${entry.args ?? ''}`,
    ` * 桥接：defineOp({ brep: ${ownName} })——core 直连 occt 引擎（§5.4），`,
    ` * D11 归一在自有实现内部完成（api/brep-operations/）。`,
    ` */`,
    `export const ${entry.name} = defineOp({`,
    `  brep: ${ownName},`,
    `  name: '${entry.name}'${namingLit}${capsLit}${enginesLit}${outputsLit}${schemaLit}${slotMapLit}${paramDimsLit}${retDimLit},`,
    `})`,
  ].join('\n')
}

/**
 * §5.5 第 2 条：query → core 引擎直连（getBrepApi）。hN = brepOf(params[N])。
 * 名字 → 返回值表达式（returnType 与之一致）。
 */
const CORE_QUERY_EXPR: Record<string, string> = {
  measureVolumeProps: `{ volume: getBrepApi().getVolume(h0), centerOfMass: getBrepApi().getCenterOfMass(h0) }`,
  measureSurfaceProps: `{ area: getBrepApi().getSurfaceArea(h0) }`,
  measureLinearProps: `{ length: getBrepApi().getLength(h0) }`,
  measureVolume: `getBrepApi().getVolume(h0)`,
  measureArea: `getBrepApi().getSurfaceArea(h0)`,
  measureLength: `getBrepApi().getLength(h0)`,
  inspectMassProps: `{ volume: getBrepApi().getVolume(h0), area: getBrepApi().getSurfaceArea(h0), centerOfMass: getBrepApi().getCenterOfMass(h0) }`,
  isValid: `getBrepApi().isValid(h0)`,
  isSameShape: `getBrepApi().isSame(h0, h1)`,
  getBounds: `getBrepApi().getBoundingBox(h0)`,
}

/**
 * query 模板：普通导出函数（先例 api/geom.ts——查询返回纯数据，不进 defineOp）。
 * arguments 由 queryParams 描述（缺省单参 shape）。全部 query 条目均
 * `getBrepApi().*` 直连 occt 引擎（CORE_QUERY_EXPR），无来源实现中转。
 * 返回类型必须显式标注 + `@returns`（export-JSDoc 门禁）。
 */
function renderQuery(entry: ArgSpecEntry): string {
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

  // query —— core 引擎直连
  const expr = CORE_QUERY_EXPR[entry.name]
  if (!expr) {
    throw new Error(`[gen-l3-surface] query '${entry.name}' 缺 core 引擎映射（CORE_QUERY_EXPR）`)
  }
  const docParams = params.map((p, i) => {
    const kind = geomAt.has(i) ? '可形状参数' : arrayAt.has(i) ? 'Shape 数组' : '数值/选项参数'
    return ` * @param ${p.name} - ${kind}（${p.docs ?? '原样透传'}）`
  })
  const handleVars = params
    .map((p, i) => (geomAt.has(i) ? `  const h${i} = brepOf(${p.name} as Shape) as BrepHandle` : ''))
    .filter((line) => line.length > 0)
    .join('\n')
  return [
    `/**`,
    ` * ${entry.name} — 查询（core，生成文件，勿手改；来源 api/surface/arg-spec.ts）。`,
    ` * ${entry.args ?? ''}`,
    ` * 桥接：getBrepApi().* 直连 occt 引擎（§5.5 第 2 条）——无来源实现中转。`,
    ` *`,
    ...docParams,
    ` * @returns ${returnType} — 纯数据结果（非 Shape）。`,
    ` */`,
    `export function ${entry.name}(${faParams.join(', ')}): ${returnType} {`,
    handleVars,
    `  return ${expr}`,
    `}`,
  ].join('\n')
}

/** 组装某模块的 import 区（按需装配，避免未使用 import 触发 lint/tsc）。
 *  全部 brep-op / query 条目均直连 core：brep-op 直连 ../brep-operations/（或手写
 *  api/ 模块）自有实现；query 经 getBrepApi 直连引擎，无需来源实现中转。 */
function renderImports(entries: ArgSpecEntry[]): string[] {
  const hasBrep = entries.some((e) => e.kind === 'brep-op')
  const hasQuery = entries.some((e) => e.kind === 'query')

  const lines: string[] = []
  if (hasBrep) {
    lines.push(`import { defineOp } from '../../define-op'`)
  }
  if (hasQuery) {
    lines.push(`import { brepOf } from '../../shape'`)
    lines.push(`import { getBrepApi } from '../../brep/handle-bridge'`)
    lines.push(`import type { BrepHandle } from '../../brep/engine/types'`)
    lines.push(`import type { Shape } from '../../mesh/types'`)
  }
  const seenValue = new Set<string>()
  for (const e of entries) {
    if (e.kind === 'skip' || e.kind === 'faijs') continue
    // query 无符号 import（getBrepApi 直连，顶部已声明）
    if (e.kind === 'query') continue
    const { file, exportName } = parseSource(e.source)
    const vk = `${file}#${exportName}`
    if (!seenValue.has(vk)) {
      seenValue.add(vk)
      // core 自有实现：api/generated/<module>.ts -> api/brep-operations/<file>（去 .ts 后缀）
      const rel = file.endsWith('.ts') ? file.slice(0, -3) : file
      lines.push(`import { ${exportName} as __own_${exportName} } from '../${rel}'`)
    }
  }
  return lines
}

function renderModuleHeader(module: string, count: number, skipped: number): string {
  return `/**\n * generated/${module}.ts — 生成文件，勿手改。\n * 由 packages/core/scripts/gen-l3-surface.ts 依据 api/surface/arg-spec.ts 生成（E5/P14 分片）。\n * ${module} 模块：${count} 个投影符号${skipped > 0 ? `；另有 ${skipped} 个 skip 登记` : ''}。\n * A6（2026-10-06）口径指认：本文件是 brepjs 投影面的**增量**清单；脚本面全集的\n * 权威来源是 generated/script-face.ts + gen-symbol-table 产物\n * lang/symbol-table.generated.ts（cad 脚本面 95 op）。两个清单回答不同问题，\n * 互不为超集——禁止用本文件的名字反推脚本面能力。\n */\n`
}

/**
 * 纯生成某一模块产物（不落盘），供 main() 与机制测试共同使用。
 */
export function generateModule(module: string): string {
  // 只取本模块条目（缺省 module=topology），skip 不产出
  const entries = ARG_SPEC.filter((e) => moduleOf(e) === module)

  const projected = entries.filter((e) => e.kind !== 'skip')
  const skipped = entries.filter((e) => e.kind === 'skip')
  const header = renderModuleHeader(module, projected.length, skipped.length)
  const chunks: string[] = []
  for (const e of projected) {
    switch (e.kind) {
      case 'brep-op': chunks.push(renderBrepOp(e)); break
      case 'query': chunks.push(renderQuery(e)); break
      case 'faijs': chunks.push(renderFaijs(e)); break
      default:
        throw new Error(`[gen-l3-surface] unsupported projection kind '${e.kind}' for '${e.name}' (arg-spec must not contain type/pure entries)`)
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

/** P23/P25 script-face 条目（arg-spec 里标记了 scriptFace 的 op：语句级 brep-op +
 *  faijs 自研视图投影 op（返回纯数据的查询类，如 projectView/projectSheet/viewCamera）。 */
export function scriptFaceEntries(): ArgSpecEntry[] {
  return ARG_SPEC.filter((e) => e.scriptFace === true && e.kind !== 'skip')
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
    '  /** Phase 5（D11）：平台 op 的平台身份（中立 op 缺省）。 */',
    "  engines?: readonly string[]",
    '  /** P26 (unit-system D8)：参数量纲声明（参数名 → DimName）。 */',
    '  paramDims?: Record<string, string>',
    '  /** P26 (unit-system D8)：返回值量纲。 */',
    '  retDim?: string',
    '}',
    '',
    '/** Cad script-face op manifest (B1: single source for cad namespace, check() symbol table). */',
    'export const SCRIPT_FACE_OPS: readonly ScriptFaceOp[] = [',
  ]
  for (const e of entries) {
    const enginesLit = e.engines?.length ? `, engines: ${JSON.stringify(e.engines)}` : ''
    const paramDimsLit = e.paramDims ? `, paramDims: ${JSON.stringify(e.paramDims)}` : ''
    const retDimLit = e.retDim ? `, retDim: ${JSON.stringify(e.retDim)}` : ''
    lines.push(`  { name: '${e.name}', module: '${moduleOf(e)}'${enginesLit}${paramDimsLit}${retDimLit} },`)
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

/** 写出生成文件：去尾随空行（whitespace 门禁：EOF 无多余空行）。 */
function writeGenFile(out: string, content: string): void {
  fs.writeFileSync(out, content.trimEnd() + '\n', 'utf-8')
}

function main(): void {
  const args = process.argv.slice(2)
  const requested = args.length > 0 ? new Set(args) : null
  assertIntersectStaysSkip()
  fs.mkdirSync(OUT_DIR, { recursive: true })
  for (const m of PROJECTED_MODULES) {
    if (requested && !requested.has(m)) continue
    const out = generatedOutputPath(m)
    writeGenFile(out, generateModule(m))
    const projected = ARG_SPEC.filter((e) => (e.module ?? 'topology') === m && e.kind !== 'skip').length
    console.log(`[gen-l3-surface] wrote ${m} (${projected} projections) -> ${path.relative(process.cwd(), out)}`)
  }
  // P23：cad 脚本面接线产物（§4.2 ② / B1 三源一致）
  writeGenFile(SCRIPT_FACE_FILE, generateScriptFace())
  console.log(`[gen-l3-surface] wrote script-face -> ${path.relative(process.cwd(), SCRIPT_FACE_FILE)}`)
  writeGenFile(SCRIPT_FACE_MANIFEST_FILE, generateScriptFaceManifest())
  console.log(`[gen-l3-surface] wrote script-face-manifest -> ${path.relative(process.cwd(), SCRIPT_FACE_MANIFEST_FILE)}`)
}

// 仅在直接运行时执行（测试 import 时跳过）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}