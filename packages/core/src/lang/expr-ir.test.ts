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
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: part0 ? 30 : 10 })',
    ].join('\n')
    const { script } = parseScript(code)
    const stmt = script.statements[1]
    const size = stmt.args.size
    expect(isExprRef(size)).toBe(true)
    const expr = (size as ExprIR).$expr
    expect(expr.text).toBe('part0 ? 30 : 10')
    expect(expr.refs).toEqual(['part0'])
    expect(expr.params).toEqual([])
    expect(stmt.hasComputedArgs).toBe(true)
  })

  it('数组元素含折叠失败表达式 → 整体 ExprIR（§3.3 示例 [w, h, r * 2 + 1] 精神）', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: [10, 20, part0 * 2 + 1] })',
    ].join('\n')
    const { script } = parseScript(code)
    const stmt = script.statements[1]
    const size = stmt.args.size
    expect(isExprRef(size)).toBe(true)
    const expr = (size as ExprIR).$expr
    expect(expr.text).toBe('[10, 20, part0 * 2 + 1]')
    expect(expr.refs).toEqual(['part0'])
    expect(stmt.hasComputedArgs).toBe(true)
  })

  it('对象参数整体不降级；属性值为折叠失败表达式时属性值递归降级为 ExprIR', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
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
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: n > 5 ? part0 : 10 })',
    ].join('\n')
    const { script } = parseScript(code)
    const stmt = script.statements[1]
    const size = stmt.args.size
    expect(isExprRef(size)).toBe(true)
    const expr = (size as ExprIR).$expr
    expect(expr.text).toBe('n > 5 ? part0 : 10')
    expect(expr.params).toEqual(['n'])
    expect(expr.refs).toEqual(['part0'])
  })

  it('逻辑表达式引用语句变量 → ExprIR', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
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
      'let part0 = cad.box({ size: n > 10 ? 5 : 8 })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[0].args.size).toBe(5)
    expect(isExprRef(script.statements[0].args.size)).toBe(false)
  })

  it('二元表达式仅引用参数 → 折叠（行为不变）', () => {
    const code = [
      'const w = 10',
      'let part0 = cad.box({ size: w * 2 })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[0].args.size).toBe(20)
  })

  it('数组仅含参数引用 → 不降级（保持 ParamRefIR 元素）', () => {
    const code = [
      'const w = 10',
      'let part0 = cad.box({ size: [w, 20, 5] })',
    ].join('\n')
    const { script } = parseScript(code)
    const size = script.statements[0].args.size
    expect(isExprRef(size)).toBe(false)
    expect(size).toEqual([{ $param: 'w' }, 20, 5])
  })

  it('数组仅含语句变量引用 → 不降级（保持 VarRefIR 元素，group members 零回归）', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: [part0, 20, 5] })',
    ].join('\n')
    const { script } = parseScript(code)
    const size = script.statements[1].args.size
    expect(isExprRef(size)).toBe(false)
    expect(Array.isArray(size)).toBe(true)
    expect(isVarRef((size as unknown[])[0] as never)).toBe(true)
  })

  it('嵌套调用仍走 CallRefIR（不进入 ExprIR）', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
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
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: cad.bboxCenter(part0) ? 1 : 2 })',
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
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: part0.positions ? 1 : 2 })',
    ].join('\n')
    const { script } = parseScript(code)
    const size = script.statements[1].args.size
    expect(isExprRef(size)).toBe(true)
    const expr = (size as ExprIR).$expr
    expect(expr.text).toBe('part0.positions ? 1 : 2')
    expect(expr.refs).toEqual(['part0'])
  })

  it('未知标识符 → E_REFERENCE', () => {
    const code = 'let part0 = cad.box({ size: unknownVar ? 1 : 2 })'
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
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: part0 ? 30 : 10 })',
    ].join('\n')
    const { code: compiled } = compileToModule(parseScript(code).script)
    expect(compiled).toContain('((part0) => part0 ? 30 : 10)(ctx.part0)')
  })

  it('数组参数 → ((part0) => [10, 20, part0 * 2 + 1])(ctx.part0)', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: [10, 20, part0 * 2 + 1] })',
    ].join('\n')
    const { code: compiled } = compileToModule(parseScript(code).script)
    expect(compiled).toContain('((part0) => [10, 20, part0 * 2 + 1])(ctx.part0)')
  })

  it('参数与变量混合 → 名称合并去重，保持声明顺序', () => {
    const code = [
      'const n = 10',
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: n > 5 ? part0 : 10 })',
    ].join('\n')
    const { code: compiled } = compileToModule(parseScript(code).script)
    expect(compiled).toContain('((n, part0) => n > 5 ? part0 : 10)(ctx.n, ctx.part0)')
  })
})

// ── codegen：往返 ──

describe('codegen: ExprIR 往返', () => {
  it('scriptIRToCode 打印 ExprIR 原文，parse → codegen → parse 语义稳定', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: part0 ? 30 : 10 })',
    ].join('\n')
    const { script } = parseScript(code)
    const printed = scriptIRToCode(script)
    expect(printed).toContain('size:(part0 ? 30 : 10)')
    // 再解析：仍是 ExprIR（文本稳定）
    const { script: reparsed } = parseScript(printed)
    const size = reparsed.statements[1].args.size
    expect(isExprRef(size)).toBe(true)
    expect((size as ExprIR).$expr.text).toBe('part0 ? 30 : 10')
  })

  it('数组 ExprIR 往返', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: [10, 20, part0 * 2 + 1] })',
    ].join('\n')
    const { script } = parseScript(code)
    const printed = scriptIRToCode(script)
    expect(printed).toContain('size:([10, 20, part0 * 2 + 1])')
    const { script: reparsed } = parseScript(printed)
    const size = reparsed.statements[1].args.size
    expect(isExprRef(size)).toBe(true)
    expect((size as ExprIR).$expr.text).toBe('[10, 20, part0 * 2 + 1]')
  })
})

// ── terminal-dag：ExprIR refs 消费判定 ──

describe('terminal-dag: ExprIR refs 按 C5 消费', () => {
  it('ExprIR 引用的变量被语句消费（consumes=true）', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: part0 ? 30 : 10 })',
    ].join('\n')
    const { script } = parseScript(code)
    const stmt = script.statements[1]
    expect(consumes(stmt, 'part0' as never)).toBe(true)
  })

  it('ExprIR 未引用的变量不被消费', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: 30 })',
      'let part2 = cad.box({ size: part1 ? 40 : 10 })',
    ].join('\n')
    const { script } = parseScript(code)
    const stmt = script.statements[2]
    expect(consumes(stmt, 'part1' as never)).toBe(true)
    expect(consumes(stmt, 'part0' as never)).toBe(false)
  })

  it('stmt.refs 含 ExprIR refs（deps 翻译依据）', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: part0 ? 30 : 10 })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[1].refs).toContain('part0')
  })
})
