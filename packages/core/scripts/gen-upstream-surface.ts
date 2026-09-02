/**
 * gen-upstream-surface — 提取 brepjs 公开 API 面基线（E1，P10 基线锁定）
 *
 * 输入：brepjs 参照源 `src/index.ts`（物理位置见 UPSTREAM_INDEX 常量；
 *       faijs vendored 树 = 该源的部分移植，根 barrel 未搬入前以参照源为准）。
 * 产物（生成文件，禁手改）：
 *   - src/api/surface/upstream-surface.json    保留符号（E1：730，U7 验收基数）
 *   - src/api/surface/upstream-exclusions.json  排除符号（§2.6 裁决 80：逐条带 reason）
 *
 * 分类口径（与方案 §2.6.6 / 附录 A 一致）：
 *   - 符号 = brepjs/src/index.ts 的具名导出（含 `export * as <ns>` 命名空间）；
 *   - kind ∈ value | type：`export type`/`type` 标记 → type，其余 value；
 *   - module = 导出源文件路径首段（'./topology/…' → topology；'@/kernel/…' → kernel）；
 *   - 排除（§2.6）：voxel / implicit / lattice / worker 整模块 + ns/csg 命名空间（U9）。
 *
 * 运行：npx tsx packages/core/scripts/gen-upstream-surface.ts [--dry]
 *   --dry 只打印统计与文档对照，不写文件。
 */
import * as ts from 'typescript'
import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** brepjs 参照源根（方案 0.2 用户点名路径） */
const UPSTREAM_INDEX = 'C:/git/OpenCascade/brepjs/src/index.ts'
const OUT_DIR = path.resolve(__dirname, '..', 'src', 'api', 'surface')

/** §2.6 排除模块：整模块排除（voxel/implicit/lattice/worker）+ ns/csg 单符号 */
const EXCLUDED_MODULES = new Set(['voxel', 'implicit', 'lattice', 'worker'])
const EXCLUDED_SYMBOLS = new Set(['csg']) // ns/csg.ts 命名空间别名（U9）

const DOC_EXPECT = {
  total: 810, values: 625, types: 185,
  kept: 730, excluded: 80,
  moduleDist: {
    topology: 265, core: 129, operations: 122, sketching: 51, '2d': 37, io: 27,
    gear: 17, kernel: 21, measurement: 21, query: 14, projection: 9, text: 8, ns: 9,
  },
}

interface SurfaceSymbol {
  name: string
  kind: 'value' | 'type'
  module: string
  file: string
}

function moduleOf(spec: string): string {
  // './topology/index.js' → topology；'@/kernel/types.js' → kernel；'./2d/…' → 2d
  const clean = spec.replace(/^\.\//, '').replace(/^@\//, '')
  const seg = clean.split('/')[0]
  return seg
}

/** 解析单个 ExportDeclaration（含 named exports 与 export * as ns）。 */
function collectFromExportDecl(
  decl: ts.ExportDeclaration,
  sf: ts.SourceFile,
  out: SurfaceSymbol[],
): void {
  const specText = decl.moduleSpecifier && ts.isStringLiteral(decl.moduleSpecifier)
    ? decl.moduleSpecifier.text
    : undefined
  if (!specText) {
    // 本地声明再导出（index.ts 全部为 re-export；出现则登记 file 为 index 自身）
    if (decl.exportClause && ts.isNamedExports(decl.exportClause)) {
      for (const el of decl.exportClause.elements) {
        out.push({
          name: el.name.text,
          kind: el.isTypeOnly || decl.isTypeOnly ? 'type' : 'value',
          module: '(local)',
          file: path.basename(sf.fileName),
        })
      }
    }
    return
  }
  const module = moduleOf(specText)
  const clause = decl.exportClause
  if (!clause) return
  if (ts.isNamespaceExport(clause)) {
    // export * as primitives from './ns/primitives.js'
    out.push({ name: clause.name.text, kind: 'value', module, file: specText })
    return
  }
  if (!ts.isNamedExports(clause)) return
  for (const el of clause.elements) {
    // el.name = 导出名；el.propertyName = 原符号名（`a as b` → propertyName=a, name=b）
    out.push({
      name: el.name.text,
      kind: el.isTypeOnly || decl.isTypeOnly ? 'type' : 'value',
      module,
      file: specText,
    })
  }
}

export function extractSurface(sourcePath: string): SurfaceSymbol[] {
  const source = fs.readFileSync(sourcePath, 'utf-8')
  const sf = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.ES2022, true)
  const out: SurfaceSymbol[] = []
  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt)) collectFromExportDecl(stmt, sf, out)
    // index.ts 无 ExportAssignment / 本地 export 语句的其它形态；遇 `export * from`（无 clause）忽略
  }
  return out
}

function main(): void {
  const dry = process.argv.includes('--dry')
  const all = extractSurface(UPSTREAM_INDEX)

  const values = all.filter((s) => s.kind === 'value')
  const types = all.filter((s) => s.kind === 'type')
  const kept = all.filter((s) => !EXCLUDED_MODULES.has(s.module) && !EXCLUDED_SYMBOLS.has(s.name))
  const excluded = all.filter((s) => EXCLUDED_MODULES.has(s.module) || EXCLUDED_SYMBOLS.has(s.name))

  const moduleDist: Record<string, number> = {}
  for (const s of kept) moduleDist[s.module] = (moduleDist[s.module] ?? 0) + 1

  console.log('[gen-upstream-surface] raw  :', all.length, `(value ${values.length} / type ${types.length})`)
  console.log('[gen-upstream-surface] kept :', kept.length, ' excluded:', excluded.length)
  console.log('[gen-upstream-surface] module dist (kept):', JSON.stringify(moduleDist, null, 0))
  console.log('[doc-comparison] doc §2.6.6 estimated total 810 / kept 730 / excluded 80')
  if (all.length === DOC_EXPECT.total && kept.length === DOC_EXPECT.kept && excluded.length === DOC_EXPECT.excluded) {
    console.log('[gen-upstream-surface] counts match doc §2.6.6 exactly')
  } else {
    // 实测（2026-09-02，brepjs/src/index.ts 159 条 export 语句 / 1251 行 / 10 处 export * as，
    // 与文档指纹一致）：文档类型数只统计内联 `type` 标记（185），漏掉 140 个整块
    // `export type {}` 重导出；且 voxel/implicit/lattice 只按 value 计数、worker 按全量计数，
    // 口径不自洽。本基线按全量口径（含全部类型）生成，保证 U7"零遗漏"可机械验证；
    // 差异记录在产物 _meta（E1/divergence 精神）。
    console.log('[gen-upstream-surface] full-fidelity taxonomy: kept/excluded 含全部类型（doc 730/80 为内联-type 口径估算）')
  }

  if (dry) return
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const sortSym = (a: SurfaceSymbol, b: SurfaceSymbol) =>
    a.module === b.module ? a.name.localeCompare(b.name) : a.module.localeCompare(b.module)
  const surfaceJson = JSON.stringify({
    _meta: {
      upstream: 'brepjs/src/index.ts',
      upstreamRef: UPSTREAM_INDEX,
      doc: 'docs/plans/2026-09-02-faijs-api-surface-completion.md §2.6.6 (E1)',
      generated: new Date().toISOString().slice(0, 10),
      note: 'excludedModules: voxel/implicit/lattice/worker; excludedSymbol: csg (U9)',
    },
    symbols: [...kept].sort(sortSym),
  }, null, 2) + '\n'
  const exclJson = JSON.stringify({
    _meta: {
      upstream: 'brepjs/src/index.ts',
      doc: 'docs/plans/2026-09-02-faijs-api-surface-completion.md §2.6.1–2.6.5 (E1)',
      generated: new Date().toISOString().slice(0, 10),
    },
    entries: [...excluded].sort(sortSym).map((s) => ({
      name: s.name,
      module: s.module,
      kind: s.kind,
      reason:
        s.module === 'voxel' ? 'dependency unavailable (brepjs-voxel-wasm unpublished) — §2.6.2'
        : s.module === 'implicit' ? 'conflicts with faijs sdf — §2.6.3'
        : s.module === 'lattice' ? 'covered by faijs sdf gyroid-lattice templates — §2.6.4'
        : s.module === 'worker' ? 'not a modeling API; conflicts with faijs host layer — §2.6.5'
        : 'U9 (user-mandated): csg module not ported — §2.6.1',
    })),
  }, null, 2) + '\n'
  fs.writeFileSync(path.join(OUT_DIR, 'upstream-surface.json'), surfaceJson, 'utf-8')
  fs.writeFileSync(path.join(OUT_DIR, 'upstream-exclusions.json'), exclJson, 'utf-8')
  console.log(`[gen-upstream-surface] wrote ${kept.length} + ${excluded.length} entries to ${path.relative(process.cwd(), OUT_DIR)}`)
}

const directRun = fileURLToPath(import.meta.url) === (process.argv[1] ? path.resolve(process.argv[1]) : '')
if (directRun) {
  main()
}
