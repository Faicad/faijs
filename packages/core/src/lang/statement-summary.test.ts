/**
 * analyzeCode / codeToArgs — 宿主摘要与编辑回填配套测试（IR 剥离阶段 0）
 *
 * 设计文档：3d_editor docs/plans/2026-08-28-ir-strip-source-code-generation-plan.md §4.2/§4.6
 *
 * 契约：
 * - analyzeCode 与 parser 结果逐字段一致（id/callee/inputs/outputs/outputKeys/refs/receiver）
 * - line 为源码行号（1-based，含扁平封装偏移）
 * - codeToArgs 提取单语句行 args（与 parse 语义一致）
 */

import { describe, it, expect } from 'vitest'
import { analyzeCode } from './statement-summary'
import { codeToArgs } from './code-to-args'
import { parseScript } from './parser'
import { statementInputs } from './types'

const BOX_DRILL_SPLIT = [
  'let part0 = cad.box({ size: 20 })',
  'part0 = cad.fai_drill(part0, { diameter: 5 })',
  'const { front: part1, back: part2 } = cad.fai_split(part0, { normal: [0,0,1], offset: 0 })',
].join('\n')

describe('analyzeCode: 与 parser 结果逐字段一致', () => {
  it('box/drill/split 序列：id/callee/inputs/outputs/outputKeys 一致', () => {
    const summaries = analyzeCode(BOX_DRILL_SPLIT)
    const { script } = parseScript(BOX_DRILL_SPLIT)

    expect(summaries).toHaveLength(script.statements.length)
    for (let i = 0; i < summaries.length; i++) {
      const s = summaries[i]
      const ir = script.statements[i]
      expect(s.id).toBe(ir.id)
      expect(s.callee).toBe(ir.callee)
      expect(s.inputs).toEqual(statementInputs(ir))
      expect(s.outputs).toEqual(ir.outputs)
      expect(s.outputKeys).toEqual(ir.outputKeys)
      expect(s.hasAssignment).toBe(ir.hasAssignment ?? false)
    }
  })

  it('drill 复用名：outputs=[part0], hasAssignment=true（裸重赋值）', () => {
    const summaries = analyzeCode(BOX_DRILL_SPLIT)
    const drill = summaries[1]
    expect(drill.callee).toBe('fai_drill')
    expect(drill.inputs).toEqual(['part0'])
    expect(drill.outputs).toEqual(['part0'])
    expect(drill.hasAssignment).toBe(true)
  })

  it('split 解构：双输出 + outputKeys=[front, back]', () => {
    const summaries = analyzeCode(BOX_DRILL_SPLIT)
    const split = summaries[2]
    expect(split.callee).toBe('fai_split')
    expect(split.inputs).toEqual(['part0'])
    expect(split.outputs).toEqual(['part1', 'part2'])
    expect(split.outputKeys).toEqual(['front', 'back'])
  })

  it('成员方法调用：receiver/hasAssignment=false/outputs=[]', () => {
    const code = [
      'let asm0 = cad.assembly({ name: \'A\' })',
      'asm0.do_assemble()',
    ].join('\n')
    const summaries = analyzeCode(code)
    expect(summaries).toHaveLength(2)
    const asmCall = summaries[1]
    expect(asmCall.callee).toBe('do_assemble')
    expect(asmCall.receiver).toBe('asm0')
    expect(asmCall.hasAssignment).toBe(false)
    expect(asmCall.outputs).toEqual([])
  })

  it('refs 与 parser 收集一致（$param/VarRef）', () => {
    const code = [
      'const size = 20',
      'let part0 = cad.box({ size: size })',
    ].join('\n')
    const summaries = analyzeCode(code)
    const { script } = parseScript(code)
    expect(summaries[0].refs).toEqual(script.statements[0].refs)
  })
})

describe('analyzeCode: line 为源码行号', () => {
  it('扁平代码：每条语句的 line 与文本行一致（1-based）', () => {
    const summaries = analyzeCode(BOX_DRILL_SPLIT)
    expect(summaries[0].line).toBe(1)
    expect(summaries[1].line).toBe(2)
    expect(summaries[2].line).toBe(3)
  })

  it('参数行占用行号时语句行号顺延', () => {
    const code = [
      'const height = 10',
      '',
      'let part0 = cad.box({ size: height })',
    ].join('\n')
    const summaries = analyzeCode(code)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].line).toBe(3)
  })
})

describe('looseLocalCalls: 单行提取放行本机函数调用（D15 回归）', () => {
  // codeToArgs 不传 looseLocalCalls 时对裸本机函数调用行抛 E_REFERENCE（3d_editor createPartsFromResult
  // 单行提取场景），looseLocalCalls: true 则放行为 local 调用候选，由调用方在完整上下文校验。
  it('无 looseLocalCalls → 裸本机 callee 抛 E_REFERENCE', () => {
    expect(() => parseScript('let n = 0\nlet part1 = makeArray({ n })')).toThrow(
      /function "makeArray" does not exist/,
    )
  })

  it('无 looseLocalCalls → 无赋值副作用调用也抛 E_REFERENCE', () => {
    expect(() => parseScript('myHelper({ x: 1 })')).toThrow(
      /function "myHelper" does not exist/,
    )
  })

  it('looseLocalCalls: true → 本机函数调用行放行', () => {
    const { script } = parseScript('let n = 0\nlet part1 = makeArray({ n })', { looseLocalCalls: true })
    expect(script.statements).toHaveLength(1)
    expect(script.statements[0].callee).toBe('makeArray')
  })

  it('looseLocalCalls: true → 无赋值副作用调用放行', () => {
    const { script } = parseScript('myHelper({ x: 1 })', { looseLocalCalls: true })
    expect(script.statements).toHaveLength(1)
    expect(script.statements[0].callee).toBe('myHelper')
  })
})

describe('codeToArgs: 单语句行 args 提取（true-JS-subset §4.6.3 新契约 { positional, args }）', () => {
  it('普通语句行', () => {
    expect(codeToArgs('let part0 = cad.box({ size: 20 })')).toEqual({ positional: [], args: { size: 20 } })
  })

  it('裸重赋值行', () => {
    expect(codeToArgs('part0 = cad.fai_drill(part0, { diameter: 5 })')).toEqual({
      positional: [{ $ref: 'part0' }],
      args: { diameter: 5 },
    })
  })

  it('解构行', () => {
    expect(codeToArgs('const { front: a, back: b } = cad.fai_split(part0, { normal: [0,0,1] })'))
      .toEqual({ positional: [{ $ref: 'part0' }], args: { normal: [0, 0, 1] } })
  })

  it('成员方法调用行', () => {
    expect(codeToArgs('asm0.add_constraint({ type: \'flush\' })')).toEqual({
      positional: [],
      args: { type: 'flush' },
    })
  })

  it('无 args 的语句返回 { positional: [], args: {} }', () => {
    expect(codeToArgs('asm0.do_assemble()')).toEqual({ positional: [], args: {} })
  })

  it('嵌套值形态保留（数组/对象/字符串）', () => {
    const args = codeToArgs("let part0 = cad.text({ text: 'hi', at: [1, 2, 0], opts: { bold: true } })")
    expect(args).toEqual({
      positional: [],
      args: { text: 'hi', at: [1, 2, 0], opts: { bold: true } },
    })
  })

  it('位置实参为字面量（true-JS-subset：`cad.box(10, 20, 30)`）', () => {
    expect(codeToArgs('let part0 = cad.box(10, 20, 30)')).toEqual({
      positional: [10, 20, 30],
      args: {},
    })
  })

  it('位置实参为变量引用 → {$ref} 标记（宿主降级只读）', () => {
    expect(codeToArgs('part0 = cad.union(part0, part1)')).toEqual({
      positional: [{ $ref: 'part0' }, { $ref: 'part1' }],
      args: {},
    })
  })

  it('本机函数调用行（looseLocalCalls）', () => {
    expect(codeToArgs('let part1 = makeArray({ n })')).toEqual({ positional: [], args: { n: { $param: 'n' } } })
  })

  it('本机函数调用行 — 无赋值副作用调用', () => {
    expect(codeToArgs('myHelper({ x: 1 })')).toEqual({ positional: [], args: { x: 1 } })
  })

  it('本机函数调用行 — 复合对象参数', () => {
    expect(codeToArgs('makeArray({ n: 4, tag: "hello" })')).toEqual({
      positional: [],
      args: { n: 4, tag: 'hello' },
    })
  })

  it('非法行抛 ParseError', () => {
    expect(() => codeToArgs('this is not valid js !!')).toThrow()
  })
})
