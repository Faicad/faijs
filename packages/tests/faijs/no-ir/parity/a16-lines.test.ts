/**
 * A-16 对拍（删除门禁 1/3）：MetadataExtractor.lines == 现状 parseScript 投影
 *
 * 方案：2026-09-06-no-ir-dual-channel-runtime.md §6 验收 A-16 / R11
 *
 * 语料：
 * 1. packages/tests/faijs/ 全部 .fai.js fixture；
 * 2. 代表性合成行（computed/param-ref/call-ref/expr-ref/keep/解构/成员调用）。
 *
 * 断言：
 * - extractor.lines 与 legacy（parseScript 投影 = 现状 analyzeCode 语义）
 *   逐字段相等，**id 兼容 's'+lineNo 规则**：新 id 必须是 's'+行号，其余字段
 *   （callee/namespace/packageName/local/receiver/positional/args/outputs/
 *   outputKeys/refs/hasAssignment/hasComputedArgs/line）逐字相等；
 * - extractor.keep 与 legacy parseUserKeep 提取相等（target 集 + 归一 hidden）；
 * - 容器/扁平/import 形态的行号语义一致。
 *
 * parseScript 删除前双路径共存；P6 删除后本文件转快照断言。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractMetadata, type UiMetadata } from '@faicad/faijs-core/lang/metadata-extractor'
import { parseScript } from '@faicad/faijs-core/lang/parser'
import { parseUserKeep } from '@faicad/faijs-core/lang/keep'
import { argIRToHost } from '@faicad/faijs-core/lang/host-arg'
import type { StatementSummary } from '@faicad/faijs-core/lang/statement-summary'
import type { ArgIR } from '@faicad/faijs-core/lang/types'

const here = fileURLToPath(new URL('.', import.meta.url))
const fixturesRoot = join(here, '..', '..', '..')

function collectFiles(dir: string, out: string[]): void {
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent)
    if (statSync(p).isDirectory()) collectFiles(p, out)
    else if (ent.endsWith('.fai.js')) out.push(p)
  }
}

const fixtureFiles: string[] = []
collectFiles(fixturesRoot, fixtureFiles)

// ── legacy 参考实现（现状 analyzeCode 语义 = parseScript + 投影） ──
// 保留于测试侧：P6 删除 parseScript 前是 extractor 的唯一独立对照。

function mapIRRecord(record: Record<string, ArgIR>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(record)) out[k] = argIRToHost(v)
  return out
}

function legacyLines(code: string): StatementSummary[] {
  const { script, statementLines } = parseScript(code)
  const nsToPkg = new Map<string, string>()
  for (const imp of script.imports ?? []) {
    if (imp.kind === 'namespace') nsToPkg.set(imp.localName, imp.packageName)
  }
  return script.statements.map((s, i) => ({
    id: s.id,
    callee: s.callee,
    ...(s.local ? { local: true } : {}),
    ...(s.namespace !== undefined
      ? { namespace: s.namespace, ...(nsToPkg.get(s.namespace) !== undefined ? { packageName: nsToPkg.get(s.namespace) } : {}) }
      : {}),
    ...(s.receiver !== undefined ? { receiver: s.receiver } : {}),
    positional: (s.positional ?? []).map((a: ArgIR) => argIRToHost(a)),
    args: mapIRRecord(s.args) as Record<string, never>,
    outputs: [...s.outputs],
    ...(s.outputKeys !== undefined ? { outputKeys: [...s.outputKeys] } : {}),
    ...(s.refs !== undefined ? { refs: [...s.refs] } : {}),
    hasAssignment: s.hasAssignment ?? false,
    hasComputedArgs: s.hasComputedArgs ?? false,
    line: statementLines[i] ?? 0,
  }))
}

/** 逐字段比较（id 除外）；另断言 id = 's'+lineNo。 */
function expectLinesEqual(newLines: StatementSummary[], oldLines: StatementSummary[]): void {
  expect(newLines.length).toBe(oldLines.length)
  for (let i = 0; i < oldLines.length; i++) {
    const o = oldLines[i]
    const n = newLines[i]
    expect(String(n.id)).toBe(`s${n.line}`)
    expect(n.line).toBe(o.line)
    expect(n.callee).toBe(o.callee)
    expect(n.namespace).toBe(o.namespace)
    expect(n.packageName).toBe(o.packageName)
    expect(n.local).toBe(o.local)
    expect(n.receiver).toBe(o.receiver)
    expect(n.positional).toEqual(o.positional)
    expect(n.args).toEqual(o.args)
    expect(n.outputs).toEqual(o.outputs)
    expect(n.outputKeys).toEqual(o.outputKeys)
    expect(n.refs ?? []).toEqual(o.refs ?? [])
    expect(n.hasAssignment).toBe(o.hasAssignment)
    expect(n.hasComputedArgs).toBe(o.hasComputedArgs)
  }
}

/** legacy keep（parseUserKeep）→ extractor.keep 同构（逐语句按行号对齐）。 */
function legacyKeepByLine(code: string): Map<number, Array<{ target: string; hidden: boolean }>> {
  const { script, statementLines } = parseScript(code)
  const out = new Map<number, Array<{ target: string; hidden: boolean }>>()
  script.statements.forEach((s, i) => {
    const uk = parseUserKeep(s)
    if (uk.targets.length === 0) return
    const line = statementLines[i] ?? 0
    out.set(line, uk.targets.map((t) => ({
      target: String(t),
      hidden: uk.hidden.get(t) ?? uk.statementDefault,
    })))
  })
  return out
}

function expectKeepEqual(meta: UiMetadata, code: string): void {
  const expected = legacyKeepByLine(code)
  const actual = new Map<number, Array<{ target: string; hidden: boolean }>>()
  for (const [line, entries] of meta.keep) actual.set(line, entries)
  expect([...actual.keys()].sort((a, b) => a - b))
    .toEqual([...expected.keys()].sort((a, b) => a - b))
  for (const [line, entries] of expected) {
    expect(actual.get(line)).toEqual(entries)
  }
}

/** params 面 vs ScriptIR.params（按名对齐：值/类型）。行号是新增字段，ScriptIR 无 → 不比对。 */
function expectParamsEqual(meta: UiMetadata, code: string): void {
  const { script } = parseScript(code)
  const oldByName = new Map(script.params.map((p) => [p.name, p]))
  const newByName = new Map(meta.params.map((p) => [p.name, p]))
  expect([...newByName.keys()].sort()).toEqual([...oldByName.keys()].sort())
  for (const [name, op] of oldByName) {
    const np = newByName.get(name)
    expect(np, `param ${name}`).toBeDefined()
    // ScriptIR 参数恒为纯字面量（现状 parser 只收字面量）→ new 侧 computed=false
    expect(np!.computed).toBe(false)
    expect(JSON.stringify(np!.value)).toBe(JSON.stringify(op.value))
    expect(np!.type).toBe(op.type)
  }
}

/** imports 面 vs ScriptIR.imports（specifier/kind/localName/bindings/packageName）。 */
function expectImportsEqual(meta: UiMetadata, code: string): void {
  const { script } = parseScript(code)
  const old = (script.imports ?? []).map((i) => ({
    specifier: i.specifier,
    kind: i.kind,
    localName: i.localName,
    bindings: i.bindings ?? [i.localName],
    packageName: i.packageName,
  }))
  const neu = meta.imports.map((i) => ({
    specifier: i.specifier,
    kind: i.kind,
    localName: i.localName,
    bindings: i.bindings,
    packageName: i.packageName,
  }))
  expect(neu).toEqual(old)
}

const SYNTHETIC: string[] = [
  // 基础 op 行（位置实参 + 选项对象）
  'let part0 = cad.box(20, 20, 20, { centered: true })',
  'let part0 = cad.box(20, 20, 20, { centered: true, at: [10, 0, 0] })',
  'let part0 = cad.sphere({ radius: 10 })',
  // 裸重赋值
  'let part0 = cad.box(20, 20, 20, { centered: true })\npart0 = cad.translate(part0, { offset: [5, 0, 0] })',
  // 参数 + 位置参数引用（var-ref）
  'const size = 20\nlet part0 = cad.box(size, size, size, { centered: true })',
  // 对象值 param-ref
  'const radius = 10\nlet part1 = cad.sphere({ radius: radius, center: [30, 0, 0] })',
  // 纯字面量折叠（不标 computed）
  'let part0 = cad.box(20 + 4 * 3, 20 + 4 * 3, 20 + 4 * 3, { centered: true })',
  // 参数折叠（标 computed）
  'const base = 20\nlet part0 = cad.box(base + 20, base + 20, base + 20, { centered: true })',
  // 语句变量表达式 → expr-ref
  'let part0 = cad.box(20, 20, 20, { centered: true })\nlet part1 = cad.box(part0 + 1, part0 + 1, part0 + 1, { centered: true })',
  // keep / keepHidden
  'let part0 = cad.box(20, 20, 20, { centered: true })\nlet part1 = cad.union(part0, { keep: [part0], keepHidden: true })',
  // 显式 {shape, hidden:false} 条目
  'let part0 = cad.box(20, 20, 20, { centered: true })\nlet part1 = cad.union(part0, { keep: [{ shape: part0, hidden: false }] })',
  // 解构
  'let part0 = cad.box(30, 30, 30, { centered: true })\nconst { front: part1, back: part2 } = cad.fai_split(part0)',
  // 成员方法调用
  "let asm0 = cad.assembly({ name: 'A' })\nasm0.do_assemble()",
  // 参数行 + 注释 + 空行（行号语义）
  'const height = 10\n\nlet part0 = cad.box(height, height, height, { centered: true })',
  // 多个空行/注释
  '// header comment\n\nlet part0 = cad.box(20, 20, 20, { centered: true })\n// middle\n\npart0 = cad.scale(part0, 2)',
  // 负字面量
  'let part0 = cad.box(20, 20, 20, { centered: true })\nlet part1 = cad.fai_drill(part0, { diameter: 5, position: [0, 10, -10] })',
  // 模板字符串折叠
  'const n = 3\nlet part0 = cad.box(20, 20, 20, { name: `板-${n}` })',
  // 三元折叠
  'const g = true\nlet part0 = cad.box(20, 20, 20, { centered: true })\nlet part1 = cad.fai_drill(part0, { depth: g ? 5 : 0 })',
  // import + 命名空间调用
  "import * as mech from 'gear-lib-demo'\n\nlet part0 = cad.box(20, 20, 20, { centered: true })\nlet part1 = mech.makeHeadstock(part0, { axis: 'x' })",
  // 容器代码
  'export default async (cad) => {\n  let part0 = cad.box(20, 20, 20, { centered: true })\n  return { shape: part0, name: \'demo\' }\n}',
  // 本机函数定义 + 本机调用（行号含函数行）
  'function doubleIt(x) { return cad.scale(x, 2) }\nlet part0 = cad.box(20, 20, 20, { centered: true })\nlet part1 = doubleIt(part0)',
]

describe('A-16: fixture corpus — extractor.lines == legacy parseScript 投影', () => {
  it.each(fixtureFiles)('parity: %s', (file) => {
    const code = readFileSync(file, 'utf8')
    // 现状 analyzeCode 拒绝的形态（容器参数非 cad 等）→ extractor 单独验收
    let old: StatementSummary[]
    try {
      old = legacyLines(code)
    } catch {
      return
    }
    const meta = extractMetadata(code)
    expectLinesEqual(meta.lines, old)
    expectKeepEqual(meta, code)
    expectParamsEqual(meta, code)
    expectImportsEqual(meta, code)
  })
})

describe('A-16: 合成行 — extractor.lines == legacy parseScript 投影', () => {
  it.each(SYNTHETIC)('parity: %s', (code) => {
    const old = legacyLines(code)
    const meta = extractMetadata(code)
    expectLinesEqual(meta.lines, old)
    expectKeepEqual(meta, code)
    expectParamsEqual(meta, code)
    expectImportsEqual(meta, code)
  })
})
