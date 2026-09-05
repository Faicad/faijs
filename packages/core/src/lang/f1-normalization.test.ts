/**
 * F1 — parser 黑名单化：表达式折叠 + 控制流错误码 + 往返稳定（normal-js-subset P1 验收）
 *
 * 设计文档：docs/plans/2026-08-29-faijs-near-term-landing-plan.md §4
 *          docs/plans/2026-08-29-faijs-normal-js-subset.md P1 / O1
 *
 * 验收判据（normal-js-subset §4 P1）：
 * - `cad.box(base + 20, base + 20, base + 20, { centered: true })`、`cad.box(20, 20, 20, { name: \`板-${n}\` })`、
 *   `cad.fai_drill(p, { depth: flag ? 5 : 0 })` 全部通过 parse（编译期折叠为字面量）。
 * - if/for/while/switch/try/动态 import() → 专用错误码 E_CONTROL_FLOW。
 * - 既有合法脚本 parse → codegen → parse 往返逐位相等（含新表达式形态，折叠后稳定）。
 */

import { describe, it, expect } from 'vitest'
import { parseScript, ParseError } from './parser'
import { scriptIRToCode } from './codegen'
import { codeToArgs } from './code-to-args'
import { statementInputs } from './types'
import { analyzeCode } from './statement-summary'
import { isExprRef } from './types'
import type { ExprIR } from './types'

// ── 表达式折叠（O1：编译期求值，IR 零改动） ──

describe('F1: 表达式折叠（parse 期静态求值为字面量）', () => {
  it('cad.box(base + 20, base + 20, base + 20, { centered: true }) → positional[0] === 120，hasComputedArgs = true', () => {
    const code = [
      'const base = 100',
      'let part0 = cad.box(base + 20, base + 20, base + 20, { centered: true })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[0].positional[0]).toBe(120)
    expect(script.statements[0].hasComputedArgs).toBe(true)
  })

  it('模板字符串折叠：cad.box(20, 20, 20, { name: `板-${n}` }) → "板-3"', () => {
    const code = [
      'const n = 3',
      'let part0 = cad.box(20, 20, 20, { name: `板-${n}` })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[0].args.name).toBe('板-3')
  })

  it('三元折叠：cad.fai_drill(p, { depth: flag ? 5 : 0 }) → depth === 5（p 是参数 input）', () => {
    const code = [
      'const flag = true',
      'const p = [0, 0, 0]',
      'let part0 = cad.box(10, 10, 10, { centered: true })',
      'part0 = cad.fai_drill(p, { depth: flag ? 5 : 0 })',
    ].join('\n')
    const { script } = parseScript(code)
    const drill = script.statements[1]
    expect(drill.args.depth).toBe(5)
    expect(statementInputs(drill)).toEqual(['p'])
    expect(drill.hasComputedArgs).toBe(true)
  })

  it('多元运算：* / % 与比较、&& || 折叠', () => {
    const code = [
      'const a = 4',
      'const b = 2',
      'let part0 = cad.box(a * b + 1, a * b + 1, a * b + 1, { centered: true, hidden: a > b && b < 10, ratio: a / b })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[0].positional[0]).toBe(9)
    expect(script.statements[0].args.hidden).toBe(true)
    expect(script.statements[0].args.ratio).toBe(2)
  })

  it('一元折叠：-base / !flag / ~x', () => {
    const code = [
      'const base = 5',
      'const flag = false',
      'let part0 = cad.box(-base, -base, -base, { centered: true, enabled: !flag, mask: ~base })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[0].positional[0]).toBe(-5)
    expect(script.statements[0].args.enabled).toBe(true)
    expect(script.statements[0].args.mask).toBe(-6)
  })

  it('数组展开折叠：cad.group({ members: [...ms] })', () => {
    const code = [
      'const ms = ["a", "b"]',
      'let part0 = cad.box(1, 1, 1, { centered: true })',
      'let g = cad.group({ members: [...ms] })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[1].args.members).toEqual(['a', 'b'])
    expect(script.statements[1].hasComputedArgs).toBe(true)
  })

  it('对象展开折叠：cad.box({ ...opts })', () => {
    const code = [
      'const opts = { width: 30, height: 20, depth: 40 }',
      'let part0 = cad.box({ ...opts })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[0].args.width).toBe(30)
    expect(script.statements[0].args.depth).toBe(40)
    expect(script.statements[0].args.height).toBe(20)
  })

  it('无参数字面量的表达式也折叠（纯字面量算术），但不是 computed（不引用参数）', () => {
    const code = 'let part0 = cad.box(20 + 4 * 3, 20 + 4 * 3, 20 + 4 * 3, { centered: true })'
    const { script } = parseScript(code)
    expect(script.statements[0].positional[0]).toBe(32)
    expect(script.statements[0].hasComputedArgs).toBeFalsy()
    expect(analyzeCode(code)[0].hasComputedArgs).toBe(false)
  })

  it('负数字面量（UnaryExpression -10）不误标为 computed（无参数引用 → 纯字面量）', () => {
    // 回归：实际 drill 语句 position:[0,10,-10] 中的 -10 是 UnaryExpression，
    // 旧实现在 parseValueExpr 折叠分支无差别置位 computed → drill 节点在时间线上
    // 被降级为只读「查看代码」，点击无法进入钻孔编辑回填。修复后仅参数引用标 computed。
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.fai_drill(part0, { diameter: 5, position: [0, 10, -10], faceNormal: [0, 1, 0] })',
    ].join('\n')
    const { script } = parseScript(code)
    const drill = script.statements[1]
    expect(drill.args.position).toEqual([0, 10, -10])
    expect(drill.args.faceNormal).toEqual([0, 1, 0])
    // IR 侧不置位（undefined）；宿主侧 analyzeCode 归一为 false。
    expect(drill.hasComputedArgs).toBeFalsy()
    expect(analyzeCode(code)[1].hasComputedArgs).toBe(false)
  })

  it('单参数负数字面量（文案标量 -10）不误判为 computed', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.fai_drill(part0, { offset: -10 })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[1].args.offset).toBe(-10)
    expect(script.statements[1].hasComputedArgs).toBeFalsy()
  })

  it('引用已声明参数的折叠表达式仍标 computed（三元 g ? 5 : 0）', () => {
    const code = [
      'const g = true',
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.fai_drill(part0, { depth: g ? 5 : 0 })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[1].args.depth).toBe(5)
    expect(script.statements[1].hasComputedArgs).toBe(true)
  })

  it('引用参数的一元折叠（-base）仍标 computed', () => {
    const code = [
      'const base = 5',
      'let part0 = cad.box(-base, -base, -base, { centered: true })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[0].positional[0]).toBe(-5)
    expect(script.statements[0].hasComputedArgs).toBe(true)
  })

  it('引用语句变量（shape）的表达式 → 降级为 ExprIR 运行时求值（控制流放松方案 §3.3）', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.box(part0 + 1, part0 + 1, part0 + 1, { centered: true })',
    ].join('\n')
    const { script } = parseScript(code)
    const size = script.statements[1].positional[0]
    expect(isExprRef(size)).toBe(true)
    expect((size as ExprIR).$expr.refs).toEqual(['part0'])
    expect(script.statements[1].hasComputedArgs).toBe(true)
  })
})

// ── 控制流专用错误码（V1.5） ──

describe('F1: 控制流专用错误码 E_CONTROL_FLOW', () => {
  const cases: Array<[string, string]> = [
    ['if', 'if (true) { let part0 = cad.box(1, 1, 1, { centered: true }) }'],
    ['for', 'for (let i = 0; i < 3; i++) { let part0 = cad.box(1, 1, 1, { centered: true }) }'],
    ['while', 'while (false) { let part0 = cad.box(1, 1, 1, { centered: true }) }'],
    ['do-while', 'do { let part0 = cad.box(1, 1, 1, { centered: true }) } while (false)'],
    ['switch', 'switch (x) { case 1: break }'],
    ['try', 'try { let part0 = cad.box(1, 1, 1, { centered: true }) } catch (e) {}'],
    ['throw', 'throw new Error("x")'],
    ['动态 import()', 'let part0 = await import("mod")'],
  ]

  for (const [label, code] of cases) {
    it(`${label} → code === E_CONTROL_FLOW`, () => {
      let err: ParseError | undefined
      try {
        parseScript(code)
      } catch (e) {
        err = e as ParseError
      }
      expect(err).toBeInstanceOf(ParseError)
      expect(err!.code).toBe('E_CONTROL_FLOW')
    })
  }

  it('eval / new Function → E_STATEMENT（安全红线）', () => {
    for (const code of ['eval("x")', 'new Function("x")']) {
      let err: ParseError | undefined
      try {
        parseScript(code)
      } catch (e) {
        err = e as ParseError
      }
      expect(err!.code).toBe('E_STATEMENT')
    }
  })

  it('export 声明 → E_STATEMENT', () => {
    let err: ParseError | undefined
    try {
      parseScript('export const x = 1')
    } catch (e) {
      err = e as ParseError
    }
    expect(err!.code).toBe('E_STATEMENT')
  })

  it('顶层 function 定义 → 合法（A1 语言层收尾后支持）', () => {
    const { script } = parseScript('function foo() { return 1 }')
    expect(script.functions).toHaveLength(1)
    expect(script.functions![0].name).toBe('foo')
  })

  it('CadRuntime.check 透传 code（E_CONTROL_FLOW 出现在 CheckResult.errors[0].code）', async () => {
    const { createRuntime } = await import('../cad-runtime/runtime')
    const { createBrowserPorts } = await import('../browser-host')
    const ports = await createBrowserPorts({} as never)
    const runtime = createRuntime(ports)
    const res = runtime.check('if (true) { let part0 = cad.box(1, 1, 1, { centered: true }) }')
    expect(res.ok).toBe(false)
    expect(res.errors[0]?.code).toBe('E_CONTROL_FLOW')
    expect(res.errors[0]?.stage).toBe('parse')
    runtime.dispose()
  })
})

// ── 语句形态黑名单化（多声明器 / 裸 cad 调用 / 参数作 input） ──

describe('F1: 语句形态放开（白名单 → 黑名单）', () => {
  it('多声明器：const a = 1, b = 2 → 两个参数', () => {
    const code = [
      'const a = 1, b = 2',
      'let part0 = cad.box(a + b, a + b, a + b, { centered: true })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.params).toHaveLength(2)
    expect(script.params[0].name).toBe('a')
    expect(script.params[1].name).toBe('b')
    expect(script.statements[0].positional[0]).toBe(3)
  })

  it('参数可直接作为 input（cad.fai_drill(p, ...)）', () => {
    const code = [
      'const p = [0, 0, 0]',
      'let part0 = cad.box(10, 10, 10, { centered: true })',
      'part0 = cad.fai_drill(part0, { diameter: 3, depth: 0, position: p })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[1].args.position).toEqual({ $param: 'p' })
  })

  it('裸 cad.<op>() 调用语句（无赋值）合法', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'cad.keepVisible(part0)',
    ].join('\n')
    const { script } = parseScript(code)
    const bare = script.statements[1]
    expect(bare.callee).toBe('keepVisible')
    expect(bare.hasAssignment).toBe(false)
    expect(bare.outputs).toEqual([])
  })

  it('var 声明仍拒绝（O2 排后）', () => {
    expect(() => parseScript('var x = 1')).toThrow(ParseError)
  })
})

// ── 往返稳定（parse → codegen → parse） ──

describe('F1: 表达式折叠后往返稳定', () => {
  function roundTrip(code: string): { args: Record<string, unknown>; callee: string; inputs: string[] } {
    const { script } = parseScript(code)
    const regenerated = scriptIRToCode(script)
    const reparsed = parseScript(regenerated).script
    const orig = script.statements[script.statements.length - 1]
    const again = reparsed.statements[reparsed.statements.length - 1]
    // 折叠后的字面量再次解析仍是同值（往返稳定，不再重新折叠）
    expect(again.args).toEqual(orig.args)
    expect(again.callee).toBe(orig.callee)
    expect(statementInputs(again)).toEqual(statementInputs(orig))
    return { args: again.args, callee: again.callee, inputs: statementInputs(again) }
  }

  it('二元 + 模板 + 三元折叠往返', () => {
    const code = [
      'const base = 100',
      'const n = 3',
      'const flag = true',
      'let part0 = cad.box({ width: base + 20, height: 20, depth: flag ? 5 : 0, name: `板-${n}` })',
    ].join('\n')
    const { args } = roundTrip(code)
    expect(args.width).toBe(120)
    expect(args.height).toBe(20)
    expect(args.depth).toBe(5)
    expect(args.name).toBe('板-3')
  })

  it('既有合法脚本往返逐位不变（S-5 不破）', () => {
    const code = [
      'let part0 = cad.box(20, 20, 20, { centered: true })',
      'let part1 = cad.sphere({ radius: 10 })',
      'let part2 = cad.union(part0, part1)',
      'part2 = cad.fai_drill(part2, { diameter: 5, depth: 0 })',
    ].join('\n')
    const { script } = parseScript(code)
    const regenerated = scriptIRToCode(script)
    const reparsed = parseScript(regenerated).script
    expect(reparsed.statements.length).toBe(script.statements.length)
    expect(reparsed.statements[2].callee).toBe('union')
    expect(reparsed.statements[2].args).toEqual({})
    expect(statementInputs(reparsed.statements[2])).toEqual(['part0', 'part1'])
    expect(reparsed.statements[3].args.diameter).toBe(5)
  })
})

// ── StatementSummary.hasComputedArgs（F1-E1 判定依据） ──

describe('F1: StatementSummary.hasComputedArgs', () => {
  it('计算参数 → true；纯字面量 → false', () => {
    const code = [
      'const base = 100',
      'let part0 = cad.box(base + 20, base + 20, base + 20, { centered: true })',
      'let part1 = cad.box(30, 30, 30, { centered: true })',
    ].join('\n')
    const summaries = analyzeCode(code)
    expect(summaries).toHaveLength(2)
    expect(summaries[0].hasComputedArgs).toBe(true)
    expect(summaries[1].hasComputedArgs).toBe(false)
    expect(summaries[0].callee).toBe('box')
  })

  it('折叠后重解析 → hasComputedArgs 变 false（源码已变成字面量）', () => {
    const code = 'const base = 100\nlet part0 = cad.box(base + 20, base + 20, base + 20, { centered: true })'
    const { script } = parseScript(code)
    const regenerated = scriptIRToCode(script)
    expect(regenerated).toContain('box(120, 120, 120')
    expect(analyzeCode(regenerated)[0].hasComputedArgs).toBe(false)
  })
})

// ── codeToArgs 折叠（编辑回填不抛错） ──

describe('F1: codeToArgs 表达式折叠', () => {
  it('二元表达式 → 折叠为字面值返回，不抛错（positional 槽逐实参折叠）', () => {
    const args = codeToArgs('cad.box(base + 20, base + 20, base + 20, { centered: true })')
    expect(args.positional).toEqual([20, 20, 20]) // 哨兵参数 base=0 → 0+20
    expect(args.args.centered).toBe(true)
  })

  it('纯字面量行行为不变', () => {
    const args = codeToArgs('part0 = cad.fai_drill(part0, { diameter: 5, depth: 0 })')
    expect(args.args.diameter).toBe(5)
    expect(args.args.depth).toBe(0)
  })

  it('模板字符串 → 折叠（尾随选项槽）', () => {
    const args = codeToArgs('cad.box(20, 20, 20, { name: `板-${n}` })')
    expect(args.args.name).toBe('板-0') // 哨兵参数 n=0
  })
})
