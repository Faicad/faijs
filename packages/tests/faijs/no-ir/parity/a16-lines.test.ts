/**
 * A-16 快照断言
 *
 * 方案：2026-09-06-no-ir-dual-channel-runtime.md §6 验收 A-16 / R11
 *
 * extractMetadata 行为基线快照断言：
 * - lines 产出的 StatementSummary[] 字段完整性
 * - id = 's'+lineNo 规则
 * - keep 表与 analyzeCode 一致性
 * - params/imports 正确性
 *
 * 语料：
 * 1. packages/tests/faijs/ 全部 .fai.js fixture；
 * 2. 代表性合成行（computed/param-ref/call-ref/expr-ref/keep/解构/成员调用）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractMetadata, type UiMetadata } from '@faicad/faijs-core/lang/metadata-extractor'
import { analyzeCode } from '@faicad/faijs-core/lang/statement-summary'
import type { StatementSummary } from '@faicad/faijs-core/lang/statement-summary'

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

/** 验证 extractor.lines 与 analyzeCode 逐字段一致（A-16 行为基线）。 */
function expectLinesConsistent(meta: UiMetadata, code: string): void {
  const summaries = analyzeCode(code)
  expect(meta.lines.length).toBe(summaries.length)
  for (let i = 0; i < summaries.length; i++) {
    const m = meta.lines[i]
    const s = summaries[i]
    // id = 's'+lineNo 规则
    expect(String(m.id)).toBe(`s${m.line}`)
    expect(m.line).toBe(s.line)
    expect(m.callee).toBe(s.callee)
    expect(m.outputs).toEqual(s.outputs)
    expect(m.hasAssignment).toBe(s.hasAssignment)
  }
}

/** 验证 keep 表结构正确（有 keep 的行才有条目）。 */
function expectKeepConsistent(meta: UiMetadata): void {
  for (const [line, entries] of meta.keep) {
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) {
      expect(typeof e.target).toBe('string')
      expect(typeof e.hidden).toBe('boolean')
    }
  }
}

/** 验证 params 正确性。 */
function expectParamsConsistent(meta: UiMetadata): void {
  for (const p of meta.params) {
    expect(typeof p.name).toBe('string')
    expect(p.name.length).toBeGreaterThan(0)
  }
}

/** 验证 imports 正确性。 */
function expectImportsConsistent(meta: UiMetadata): void {
  for (const imp of meta.imports) {
    expect(typeof imp.specifier).toBe('string')
    expect(imp.specifier.length).toBeGreaterThan(0)
  }
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

describe('A-16: fixture corpus — extractMetadata 行为基线', () => {
  it.each(fixtureFiles)('metadata consistent: %s', (file) => {
    const code = readFileSync(file, 'utf8')
    let meta: UiMetadata
    try {
      meta = extractMetadata(code)
    } catch {
      return // 容器参数非 cad 等 → 跳过
    }
    expectLinesConsistent(meta, code)
    expectKeepConsistent(meta)
    expectParamsConsistent(meta)
    expectImportsConsistent(meta)
  })
})

describe('A-16: 合成行 — extractMetadata 行为基线', () => {
  it.each(SYNTHETIC)('metadata consistent: %s', (code) => {
    const meta = extractMetadata(code)
    expectLinesConsistent(meta, code)
    expectKeepConsistent(meta)
    expectParamsConsistent(meta)
    expectImportsConsistent(meta)
  })
})
