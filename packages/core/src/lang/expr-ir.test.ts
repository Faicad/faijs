/**
 * ExprIR（运行时表达式）单元测试 — 控制流放松方案 Phase 1
 *
 * 覆盖（§3.3 / §4.3 / §5.4）：
 * - parser：折叠失败（引用语句变量）→ ExprIR 降级；纯参数/字面量仍静态折叠（零回归）
 * - parser：白名单文法（含 Array 递归）；白名单外（嵌套调用/成员）→ E_VALUE
 * - parser：ObjectExpression 不整体降级，属性值为折叠失败表达式时该属性值递归降级
 * - compile：箭头包装发射 `((names) => text)(ctx.names)`
 * - codegen：ExprIR 原文往返
 * - terminal-dag：ExprIR refs 按 C5 消费判定
 */

import { describe, it, expect } from 'vitest'
import { parseScript, ParseError } from './parser'
import { compileToModule } from './compile'
import { scriptIRToCode } from './codegen'
import { isExprRef, isVarRef } from './types'
import type { ExprIR } from './types'
import { consumes } from '../cad-runtime/terminal-dag'

// ── parser：ExprIR 降级 ──

describe('parser: ExprIR 降级（折叠失败引用语句变量）', () => {
  it('条件表达式引用语句变量 → args 值为 ExprIR，refs 收集', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(part0 ? 30 : 10, part0 ? 30 : 10, part0 ? 30 : 10, { centered: true })',
    ].join('\n')
    const { script } = parseScript(code)
    const stmt = script.statements[1]
    const size = stmt.positional[0]
    expect(isExprRef(size)).toBe(true)
    const expr = (size as ExprIR).$expr
    expect(expr.text).toBe('part0 ? 30 : 10')
    expect(expr.refs).toEqual(['part0'])
    expect(expr.params).toEqual([])
    expect(stmt.hasComputedArgs).toBe(true)
  })

  it('单个位置实参含折叠失败表达式 → 该实参降级为 ExprIR（§3.3 精神：整体数组降级取消，逐实参降级）', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(10, 20, part0 * 2 + 1, { centered: true })',
    ].join('\n')
    const { script } = parseScript(code)
    const stmt = script.statements[1]
    const size = stmt.positional[2]
    expect(isExprRef(size)).toBe(true)
    const expr = (size as ExprIR).$expr
    expect(expr.text).toBe('part0 * 2 + 1')
    expect(expr.refs).toEqual(['part0'])
    expect(stmt.hasComputedArgs).toBe(true)
  })

  it('对象参数整体不降级；属性值为折叠失败表达式时属性值递归降级为 ExprIR', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.translate(part0, { offset: { x: 1, y: part0 ? 30 : 10 } })',
    ].join('\n')
    const { script } = parseScript(code)
    const stmt = script.statements[1]
    const offset = stmt.args.offset
    // 对象本身不降级（保持对象形态）
    expect(isExprRef(offset)).toBe(false)
    expect(offset).toEqual({ x: 1, y: { $expr: { text: 'part0 ? 30 : 10', refs: ['part0'], params: [] } } })
  })

  it('表达式同时引用参数与语句变量 → params 与 refs 分列', () => {
    const code = [
      'const n = 10',
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(n > 5 ? part0 : 10, n > 5 ? part0 : 10, n > 5 ? part0 : 10, { centered: true })',
    ].join('\n')
    const { script } = parseScript(code)
    const stmt = script.statements[1]
    const size = stmt.positional[0]
    expect(isExprRef(size)).toBe(true)
    const expr = (size as ExprIR).$expr
    expect(expr.text).toBe('n > 5 ? part0 : 10')
    expect(expr.params).toEqual(['n'])
    expect(expr.refs).toEqual(['part0'])
  })

  it('逻辑表达式引用语句变量 → ExprIR', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.translate(part0, { offset: part0 && part0 ? [0,0,0] : [0,1,0] })',
    ].join('\n')
    const { script } = parseScript(code)
    const stmt = script.statements[1]
    expect(isExprRef(stmt.args.offset)).toBe(true)
  })
})

// ── parser：零回归（纯参数/字面量仍静态折叠） ──

describe('parser: 静态折叠零回归', () => {
  it('条件表达式仅引用参数 → 仍静态折叠为字面量（非 ExprIR）', () => {
    const code = [
      'const n = 20',
      'let part0 = cad.box(n > 10 ? 5 : 8, n > 10 ? 5 : 8, n > 10 ? 5 : 8, { centered: true })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[0].positional[0]).toBe(5)
    expect(isExprRef(script.statements[0].positional[0])).toBe(false)
  })

  it('二元表达式仅引用参数 → 折叠（行为不变）', () => {
    const code = [
      'const w = 10',
      'let part0 = cad.box(w * 2, w * 2, w * 2, { centered: true })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[0].positional[0]).toBe(20)
  })

  it('位置实参仅含参数引用 → 不降级（保持 ParamRefIR 元素）', () => {
    const code = [
      'const w = 10',
      'let part0 = cad.box(w, 20, 5, { centered: true })',
    ].join('\n')
    const { script } = parseScript(code)
    const p = script.statements[0].positional
    expect(isExprRef(p[0])).toBe(false)
    expect(p[0]).toEqual({ $ref: 'w' })
    expect(p[1]).toBe(20)
    expect(p[2]).toBe(5)
  })

  it('位置实参仅含语句变量引用 → 不降级（保持 VarRefIR 元素）', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(part0, 20, 5, { centered: true })',
    ].join('\n')
    const { script } = parseScript(code)
    const p = script.statements[1].positional
    expect(isExprRef(p[0])).toBe(false)
    expect(isVarRef(p[0] as never)).toBe(true)
  })

  it('嵌套调用仍走 CallRefIR（不进入 ExprIR）', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.translate(part0, { offset: cad.bboxCenter(part0) })',
    ].join('\n')
    const { script } = parseScript(code)
    const offset = script.statements[1].args.offset
    expect(offset).toMatchObject({ $call: { callee: 'bboxCenter' } })
  })
})

// ── parser：白名单外 → E_VALUE ──

describe('parser: ExprIR 白名单边界', () => {
  it('条件表达式内含嵌套调用 → E_VALUE', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(cad.bboxCenter(part0) ? 1 : 2, cad.bboxCenter(part0) ? 1 : 2, cad.bboxCenter(part0) ? 1 : 2, { centered: true })',
    ].join('\n')
    try {
      parseScript(code)
      expect.unreachable()
    } catch (e) {
      expect((e as ParseError).code).toBe('E_VALUE')
    }
  })

  it('成员访问已入白名单（true-JS-subset D2）→ ExprIR，refs 收集到根标识符', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(part0.positions ? 1 : 2, part0.positions ? 1 : 2, part0.positions ? 1 : 2, { centered: true })',
    ].join('\n')
    const { script } = parseScript(code)
    const size = script.statements[1].positional[0]
    expect(isExprRef(size)).toBe(true)
    const expr = (size as ExprIR).$expr
    expect(expr.text).toBe('part0.positions ? 1 : 2')
    expect(expr.refs).toEqual(['part0'])
  })

  it('未知标识符 → E_REFERENCE', () => {
    const code = 'let part0 = cad.box(unknownVar ? 1 : 2, unknownVar ? 1 : 2, unknownVar ? 1 : 2, { centered: true })'
    try {
      parseScript(code)
      expect.unreachable()
    } catch (e) {
      expect((e as ParseError).code).toBe('E_REFERENCE')
    }
  })
})

// ── compile：箭头包装发射 ──

describe('compile: ExprIR 箭头包装发射（§5.4）', () => {
  it('条件表达式 → ((part0) => text)(ctx.part0)', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(part0 ? 30 : 10, part0 ? 30 : 10, part0 ? 30 : 10, { centered: true })',
    ].join('\n')
    const { code: compiled } = compileToModule(parseScript(code).script)
    expect(compiled).toContain('((part0) => part0 ? 30 : 10)(ctx.part0)')
  })

  it('单个位置实参含语句变量 → 逐实参 ExprIR += ((part0) => part0 * 2 + 1)(ctx.part0)', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(10, 20, part0 * 2 + 1, { centered: true })',
    ].join('\n')
    const { code: compiled } = compileToModule(parseScript(code).script)
    expect(compiled).toContain('((part0) => part0 * 2 + 1)(ctx.part0)')
  })

  it('参数与变量混合 → 名称合并去重，保持声明顺序', () => {
    const code = [
      'const n = 10',
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(n > 5 ? part0 : 10, n > 5 ? part0 : 10, n > 5 ? part0 : 10, { centered: true })',
    ].join('\n')
    const { code: compiled } = compileToModule(parseScript(code).script)
    expect(compiled).toContain('((n, part0) => n > 5 ? part0 : 10)(ctx.n, ctx.part0)')
  })
})

// ── codegen：往返 ──

describe('codegen: ExprIR 往返', () => {
  it('scriptIRToCode 打印 ExprIR 原文，parse → codegen → parse 语义稳定', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(part0 ? 30 : 10, part0 ? 30 : 10, part0 ? 30 : 10, { centered: true })',
    ].join('\n')
    const { script } = parseScript(code)
    const printed = scriptIRToCode(script)
    expect(printed).toContain('(part0 ? 30 : 10)')
    // 再解析：仍是 ExprIR（文本稳定）
    const { script: reparsed } = parseScript(printed)
    const size = reparsed.statements[1].positional[0]
    expect(isExprRef(size)).toBe(true)
    expect((size as ExprIR).$expr.text).toBe('part0 ? 30 : 10')
  })

  it('数组 ExprIR 往返', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(10, 20, part0 * 2 + 1, { centered: true })',
    ].join('\n')
    const { script } = parseScript(code)
    const printed = scriptIRToCode(script)
    expect(printed).toContain('(part0 * 2 + 1)')
    const { script: reparsed } = parseScript(printed)
    const size = reparsed.statements[1].positional[2]
    expect(isExprRef(size)).toBe(true)
    expect((size as ExprIR).$expr.text).toBe('part0 * 2 + 1')
  })
})

// ── terminal-dag：ExprIR refs 消费判定 ──

describe('terminal-dag: ExprIR refs 按 C5 消费', () => {
  it('ExprIR 引用的变量被语句消费（consumes=true）', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(part0 ? 30 : 10, part0 ? 30 : 10, part0 ? 30 : 10, { centered: true })',
    ].join('\n')
    const { script } = parseScript(code)
    const stmt = script.statements[1]
    expect(consumes(stmt, 'part0' as never)).toBe(true)
  })

  it('ExprIR 未引用的变量不被消费', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(30, 30, 30, { centered: true })',
      'let part2 = cad.box(part1 ? 40 : 10, part1 ? 40 : 10, part1 ? 40 : 10, { centered: true })',
    ].join('\n')
    const { script } = parseScript(code)
    const stmt = script.statements[2]
    expect(consumes(stmt, 'part1' as never)).toBe(true)
    expect(consumes(stmt, 'part0' as never)).toBe(false)
  })

  it('stmt.refs 含 ExprIR refs（deps 翻译依据）', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(part0 ? 30 : 10, part0 ? 30 : 10, part0 ? 30 : 10, { centered: true })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[1].refs).toContain('part0')
  })
})
