/**
 * A1 / Phase 2 — 顶层函数定义 + 本机函数调用（控制流放松方案）
 *
 * 实施文档：docs/plans/2026-08-29-faijs-module-runtime-plan.md §7.2 A1
 *          docs/plans/2026-09-01-faijs-control-flow-functions-design.md §3 / §4
 *
 * 验收（Phase 2）：
 * 1. 函数体放行控制流（if/for/while/switch/try/throw/break/continue/labeled/var/嵌套函数）
 * 2. 安全红线保持（eval / new / import / export / class / with / 动态 import()）
 * 3. 体内禁止本机函数调用（裸 callee → E_STATEMENT，D10）
 * 4. 本机调用四形态（赋值 / 重赋值 / 解构 / 无赋值）+ ABI 绑定（§3.6：E_ARG）
 * 5. parse 期查重（D14：E_STATEMENT）；未知函数名 parse 期 E_REFERENCE（D15）
 * 6. bodyHash / bodyRange 生成
 * 7. 往返逐位相等（含控制流函数体 / 本机调用四形态）
 *
 * Run: npx vitest run src/lang/function-def.test.ts
 */

import { describe, it, expect } from 'vitest'
import { parseScript, ParseError } from './parser'
import { scriptIRToCode } from './codegen'
import { compileToModule } from './compile'
import { analyzeCode } from './statement-summary'
import { statementInputs } from './types'
import { computeLeafTerminals } from '../cad-runtime/terminal-dag'
import { asPartName, type PartName } from '../identity'

/** 断言 parseScript 抛出指定 code 的 ParseError。 */
function expectParseError(code: string, errCode: string, msg?: RegExp): ParseError {
  try {
    parseScript(code)
  } catch (e) {
    expect(e).toBeInstanceOf(ParseError)
    expect((e as ParseError).code).toBe(errCode)
    if (msg) expect((e as ParseError).message).toMatch(msg)
    return e as ParseError
  }
  throw new Error(`expected ParseError(${errCode}), got none`)
}

describe('A1: parse top-level function definitions', () => {
  it('collects function name, params and verbatim body', () => {
    const code = [
      'function makeBracket(width) {',
      '  let part0 = cad.box({ size: [width, 10, 4] })',
      '  return part0',
      '}',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.functions).toHaveLength(1)
    const fn = script.functions![0]
    expect(fn.name).toBe('makeBracket')
    expect(fn.params).toEqual(['width'])
    expect(fn.body).toContain('let part0 = cad.box({ size: [width, 10, 4] })')
  })

  it('function definitions are not geometry statements (no DAG pollution)', () => {
    const code = [
      'function helper(w) {',
      '  let part0 = cad.box({ size: w })',
      '  return part0',
      '}',
      'let part1 = cad.sphere({ radius: 5 })',
      'let part2 = cad.box({ size: 1 })',
    ].join('\n')
    const { script } = parseScript(code)
    // 函数不进 statements——只产生几何语句
    expect(script.statements.map((s) => s.callee)).toEqual(['sphere', 'box'])

    // DAG 终端集不包含函数名（函数不产生 shape 变量）；两个独立 shape 都是终端
    const terminals = computeLeafTerminals(script, new Set<PartName>(['part1', 'part2'].map(asPartName)))
    expect(terminals.map((t) => String(t.id)).sort()).toEqual(['part1', 'part2'])
  })

  it('bodyHash is deterministic and bodyRange covers the function body', () => {
    const code = [
      'function f(x) {',
      '  let p = cad.box({ size: x })',
      '  return p',
      '}',
    ].join('\n')
    const { script } = parseScript(code)
    const fn = script.functions![0]
    expect(fn.bodyHash).toMatch(/^[0-9a-f]{8}$/)
    // 同 body 两次 parse → 同 hash（确定性）
    const { script: again } = parseScript(code)
    expect(again.functions![0].bodyHash).toBe(fn.bodyHash)
    // bodyRange：覆盖函数体原文（切片还原 body）
    const sliced = code.slice(fn.bodyRange!.start, fn.bodyRange!.end)
    expect(sliced).toBe(fn.body)
  })
})

describe('Phase2: 函数体放行控制流（§3.1 / §3.2）', () => {
  it('if/for/while/switch/try/throw/break/continue/labeled 全部放行', () => {
    const code = [
      'function gear(count) {',
      '  let parts = []',
      '  for (let i = 0; i < count; i++) {',
      '    if (i % 2 === 0) {',
      '      parts.push(cad.box({ size: i }))',
      '    } else {',
      '      continue',
      '    }',
      '  }',
      '  while (parts.length > 10) { parts.pop() }',
      '  do { parts.pop() } while (parts.length > 5)',
      '  switch (count) { case 1: break; default: break }',
      '  try { throw "boom" } catch (e) {}',
      '  outer: for (let i = 0; i < 2; i++) { break outer }',
      '  var legacy = 1',
      '  return parts',
      '}',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.functions).toHaveLength(1)
    expect(script.functions![0].name).toBe('gear')
  })

  it('嵌套函数定义放行（定义可、调用禁——D10 禁体内本机调用）', () => {
    const code = [
      'function outer(x) {',
      '  function inner(y) {',
      '    return y * 2',
      '  }',
      '  let p = cad.box({ size: x })',
      '  return p',
      '}',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.functions![0].name).toBe('outer')
    expect(script.functions![0].body).toContain('function inner(y)')
  })

  it('安全红线仍拒：eval / new / import / export / class / with / 动态 import()', () => {
    expectParseError('function f() { return eval("1") }', 'E_STATEMENT', /eval/)
    expectParseError('function f() { let p = new Foo() }', 'E_STATEMENT', /new/)
    expectParseError('function f() { return import("x") }', 'E_CONTROL_FLOW', /import/)
    // with：模块严格模式下 acorn 直接 SyntaxError（E_SYNTAX，方案 §3.1「始终禁止（严格模式非法）」）；
    // 防御性 WithStatement 检查（E_CONTROL_FLOW）覆盖非严格场景——两者都是拒绝路径
    try {
      parseScript('function f() { with (obj) {} }')
      expect.unreachable()
    } catch (e) {
      expect((e as ParseError).code).toMatch(/E_SYNTAX|E_CONTROL_FLOW/)
    }
    expectParseError('function f() { class C {} }', 'E_STATEMENT', /class/)
    // export 只能出现在模块顶层：acorn 以 SyntaxError 拒绝
    expect(() => parseScript('function f() { export const x = 1 }')).toThrow(ParseError)
  })

  it('体内禁止本机函数调用（裸 callee → E_STATEMENT，D10）', () => {
    const code = [
      'function helper(x) { return x }',
      'function bad(x) {',
      '  return helper(x)',
      '}',
    ].join('\n')
    expectParseError(code, 'E_STATEMENT', /inside a function body/)
  })
})

describe('Phase2: 本机函数调用四形态 + ABI（§3.4 / §3.6）', () => {
  const code = [
    'function makeGear(count, pitch) {',
    '  let parts = []',
    '  for (let i = 0; i < count; i++) { parts.push(cad.box({ size: pitch })) }',
    '  return parts[0]',
    '}',
    'let part0 = cad.box({ size: 20 })',
    'let part1 = makeGear({ count: 8, pitch: 5 })',
    'let part2 = makeGear(part0, { pitch: 5 })',
    'part2 = makeGear(part2, { pitch: 3 })',
    'const { front: part3, back: part4 } = makeGear(part0, { pitch: 2 })',
  ].join('\n')

  it('赋值形态：位置实参 → inputs；对象键 → args；local: true', () => {
    const { script } = parseScript(code)
    // let part1 = makeGear({ count: 8, pitch: 5 })：无位置实参
    const stmt1 = script.statements[1]
    expect(stmt1.local).toBe(true)
    expect(stmt1.callee).toBe('makeGear')
    expect(statementInputs(stmt1)).toEqual([])
    expect(stmt1.args.count).toBe(8)
    expect(stmt1.args.pitch).toBe(5)
    expect(stmt1.outputs).toEqual([asPartName('part1')])
    // let part2 = makeGear(part0, { pitch: 5 })：位置实参 part0 → inputs
    const stmt2 = script.statements[2]
    expect(stmt2.local).toBe(true)
    expect(statementInputs(stmt2)).toEqual([asPartName('part0')])
    expect(stmt2.args).toEqual({ pitch: 5 })
  })

  it('重赋值形态：part2 = makeGear(part2, {...}) → local 重赋值', () => {
    const { script } = parseScript(code)
    const stmt3 = script.statements[3]
    expect(stmt3.local).toBe(true)
    expect(statementInputs(stmt3)).toEqual([asPartName('part2')])
    expect(stmt3.args.pitch).toBe(3)
  })

  it('解构形态：const { front, back } = makeGear(...) → local + outputKeys', () => {
    const { script } = parseScript(code)
    const stmt4 = script.statements[4]
    expect(stmt4.local).toBe(true)
    expect(stmt4.outputKeys).toEqual(['front', 'back'])
    expect(stmt4.outputs).toEqual([asPartName('part3'), asPartName('part4')])
  })

  it('无赋值调用形态：裸调用（副作用）', () => {
    const sideEffect = [
      'function sideEffect(a) { cad.sphere({ radius: a }) }',
      'let part0 = cad.box({ size: 1 })',
      'sideEffect(part0)',
    ].join('\n')
    const { script } = parseScript(sideEffect)
    expect(script.statements[1].local).toBe(true)
    expect(script.statements[1].outputs).toEqual([])
    expect(script.statements[1].hasAssignment).toBe(false)
  })

  it('ABI：位置实参超位 → E_ARG', () => {
    const code = [
      'function f(a, b) { return a }',
      'let part0 = cad.box({ size: 1 })',
      'let part1 = f(part0, part0, part0)',
    ].join('\n')
    expectParseError(code, 'E_ARG', /at most 2 positional/)
  })

  it('ABI：对象键不在形参表 → E_ARG', () => {
    const code = [
      'function f(a, b) { return a }',
      'let part0 = cad.box({ size: 1 })',
      'let part1 = f(part0, { nope: 1 })',
    ].join('\n')
    expectParseError(code, 'E_ARG', /no parameter named "nope"/)
  })

  it('ABI：对象键与位置实参占用冲突 → E_ARG', () => {
    const code = [
      'function f(a, b) { return a }',
      'let part0 = cad.box({ size: 1 })',
      'let part1 = f(part0, { a: 2 })',
    ].join('\n')
    expectParseError(code, 'E_ARG', /already bound by a positional/)
  })

  it('ABI：keep 键不参与校验（可传保留指令）', () => {
    const code = [
      'function f(a) { return a }',
      'let part0 = cad.box({ size: 1 })',
      'let part1 = f(part0, { keep: ["part0"] })',
    ].join('\n')
    const { script } = parseScript(code)
    // keep 键剥离校验但仍保留在 args（字符串字面量形态，与 cad.* 调用一致）
    expect(script.statements[1].args.keep).toEqual(['part0'])
  })

  it('未知函数名 → parse 期 E_REFERENCE（D15）', () => {
    const code = 'let part0 = cad.box({ size: 1 })\nlet part1 = noSuchFn(part0)'
    expectParseError(code, 'E_REFERENCE', /does not exist/)
  })

  it('重复函数名 → parse 期 E_STATEMENT（D14）', () => {
    const code = [
      'function f(x) { return x }',
      'function f(y) { return y }',
    ].join('\n')
    expectParseError(code, 'E_STATEMENT', /already defined/)
  })

  it('函数提升：定义在语句之后仍可调用', () => {
    const code = [
      'let part0 = cad.box({ size: 1 })',
      'let part1 = laterFn(part0, { k: 2 })',
      'function laterFn(a, k) { return a }',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[1].local).toBe(true)
    expect(script.statements[1].callee).toBe('laterFn')
  })
})

describe('Phase2: compile 发射（§5.1 / §5.2 / §5.3）', () => {
  it('模块含包装器（__ctx/__ns/形参按名）+ localFns 导出 + 命名空间绑定', () => {
    const code = [
      "import * as mech from 'mech-lib'",
      'function makeGear(count, pitch) {',
      '  let parts = []',
      '  for (let i = 0; i < count; i++) { parts.push(cad.box({ size: pitch })) }',
      '  return parts[0]',
      '}',
      'let part0 = cad.box({ size: 20 })',
      'let part1 = makeGear({ count: 8, pitch: 5 })',
    ].join('\n')
    const { script } = parseScript(code)
    const { code: compiled } = compileToModule(script)
    expect(compiled).toContain('async function makeGear(__ctx, __ns, count, pitch)')
    expect(compiled).toContain('const cad = __ns.cad')
    expect(compiled).toContain('const mech = __ns.mech')
    expect(compiled).toContain('export const localFns = { makeGear }')
    // ABI 发射：makeGear({count:8,pitch:5}) → await localFns.makeGear(ctx, ns, 8, 5)（形参序）
    expect(compiled).toContain('await localFns.makeGear(ctx, ns, 8, 5)')
  })

  it('位置实参 + args 对象按形参序发射', () => {
    const code = [
      'function pattern(input, count) {',
      '  return cad.sphere({ radius: count })',
      '}',
      'let part0 = cad.box({ size: 20 })',
      'let part1 = pattern(part0, { count: 6 })',
    ].join('\n')
    const { script } = parseScript(code)
    const { code: compiled } = compileToModule(script)
    expect(compiled).toContain('await localFns.pattern(ctx, ns, ctx.part0, 6)')
  })

  it('解构消费发射：const { front, back } = await localFns... + 写 ctx', () => {
    const code = [
      'function splitFn(input, mode) {',
      '  return { front: input, back: input }',
      '}',
      'let part0 = cad.box({ size: 20 })',
      'const { front: part1, back: part2 } = splitFn(part0, { mode: "x" })',
    ].join('\n')
    const { script } = parseScript(code)
    const { code: compiled } = compileToModule(script)
    expect(compiled).toContain('const { front, back } = await localFns.splitFn(ctx, ns, ctx.part0, "x")')
    expect(compiled).toContain('ctx.part1 = front')
    expect(compiled).toContain('ctx.part2 = back')
  })

  it('未绑定形参 → undefined', () => {
    const code = [
      'function f(a, b, c) { return a }',
      'let part0 = cad.box({ size: 1 })',
      'let part1 = f(part0, { c: 3 })',
    ].join('\n')
    const { script } = parseScript(code)
    const { code: compiled } = compileToModule(script)
    // 位置实参 part0 → a；对象键 c → c；b 未绑定 → undefined
    expect(compiled).toContain('await localFns.f(ctx, ns, ctx.part0, undefined, 3)')
  })
})

describe('Phase2: analyzeCode / 往返', () => {
  it('analyzeCode 增 local 字段', () => {
    const code = [
      'function f(a) { return a }',
      'let part0 = cad.box({ size: 1 })',
      'let part1 = f(part0)',
    ].join('\n')
    const summaries = analyzeCode(code)
    // statements[0] = cad.box（非 local）；statements[1] = f()（local）
    expect(summaries[0].local).toBeUndefined()
    expect(summaries[1].local).toBe(true)
    expect(summaries[1].namespace).toBeUndefined()
  })

  it('控制流函数体 + 本机调用四形态往返逐位相等', () => {
    const code = [
      'function makeGear(count, pitch) {',
      '  let parts = []',
      '  for (let i = 0; i < count; i++) { parts.push(cad.box({ size: pitch })) }',
      '  return parts[0]',
      '}',
      'let part0 = cad.box({ size: 20 })',
      'let part1 = makeGear({ count: 8, pitch: 5 })',
      'let part2 = makeGear(part0, { pitch: 5 })',
      'part2 = makeGear(part2, { pitch: 3 })',
      'const { front: part3, back: part4 } = makeGear(part0, { pitch: 2 })',
    ].join('\n')
    const { script } = parseScript(code)
    const printed = scriptIRToCode(script)
    const { script: reparsed } = parseScript(printed)
    expect(reparsed.functions).toEqual(script.functions)
    expect(reparsed.statements).toEqual(script.statements)
  })
})
