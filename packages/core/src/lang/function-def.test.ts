/**
 * A1 — 顶层函数定义（faijs 0.5.2，语言层收尾）
 *
 * 实施文档：docs/plans/2026-08-29-faijs-module-runtime-plan.md §7.2 A1
 *
 * 验收：
 * 1. `function` + import + 命名空间调用 parse → codegen → parse 往返逐位相等
 * 2. 控制流仍报 E_CONTROL_FLOW（含函数体内）
 * 3. eval / new / export 仍被拒
 * 4. 函数定义不污染 DAG 终端集（不进 statements）
 *
 * Run: npx vitest run src/lang/function-def.test.ts
 */

import { describe, it, expect } from 'vitest'
import { parseScript, ParseError } from './parser'
import { scriptIRToCode } from './codegen'
import { computeLeafTerminals } from '../cad-runtime/terminal-dag'
import { asPartName, type PartName } from '../identity'

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
})

describe('A1: round-trip (parse → codegen → parse)', () => {
  it('function + import + namespace call round-trips bit-identical', () => {
    const code = [
      "import * as mech from 'mech-lib'",
      'function makeHeadstock(h) {',
      '  let part0 = mech.makeBracket({ height: h })',
      '  return part0',
      '}',
      'let part1 = cad.box({ size: 20 })',
      'let part2 = cad.union(part1, part1)',
    ].join('\n')

    const { script } = parseScript(code)
    const regenerated = scriptIRToCode(script)
    const reparsed = parseScript(regenerated).script

    // 函数段逐位相等
    expect(reparsed.functions).toEqual(script.functions)
    // import 段逐位相等
    expect(reparsed.imports).toEqual(script.imports)
    // 几何语句逐位相等
    expect(reparsed.statements.length).toBe(script.statements.length)
    expect(reparsed.statements.map((s) => s.callee)).toEqual(script.statements.map((s) => s.callee))
    expect(reparsed.statements[0].inputs).toEqual(script.statements[0].inputs)
    expect(reparsed.statements[0].args).toEqual(script.statements[0].args)
  })

  it('multiple functions round-trip preserving order', () => {
    const code = [
      'function a(x) {',
      '  return x',
      '}',
      'function b(y) {',
      '  let p = cad.box({ size: y })',
      '  return p',
      '}',
      'let part0 = cad.sphere({ radius: 3 })',
    ].join('\n')
    const { script } = parseScript(code)
    const reparsed = parseScript(scriptIRToCode(script)).script
    expect(reparsed.functions!.map((f) => f.name)).toEqual(['a', 'b'])
    expect(reparsed.functions).toEqual(script.functions)
  })
})

describe('A1: blacklist still enforced (incl. function bodies)', () => {
  it('control flow in function body → E_CONTROL_FLOW', () => {
    const code = [
      'function bad(x) {',
      '  if (x > 0) {',
      '    return x',
      '  }',
      '}',
    ].join('\n')
    let err: ParseError | undefined
    try {
      parseScript(code)
    } catch (e) {
      err = e as ParseError
    }
    expect(err).toBeInstanceOf(ParseError)
    expect(err!.code).toBe('E_CONTROL_FLOW')
  })

  it('top-level control flow still E_CONTROL_FLOW (unchanged)', () => {
    const code = 'let part0 = cad.box({ size: 1 })\nfor (let i = 0; i < 3; i++) {}'
    let err: ParseError | undefined
    try {
      parseScript(code)
    } catch (e) {
      err = e as ParseError
    }
    expect(err!.code).toBe('E_CONTROL_FLOW')
  })

  it('eval in function body → E_STATEMENT', () => {
    const code = 'function bad() {\n  return eval("1+1")\n}'
    let err: ParseError | undefined
    try {
      parseScript(code)
    } catch (e) {
      err = e as ParseError
    }
    expect(err!.code).toBe('E_STATEMENT')
  })

  it('new expression in function body → E_STATEMENT', () => {
    const code = 'function bad() {\n  let p = new Foo()\n  return p\n}'
    let err: ParseError | undefined
    try {
      parseScript(code)
    } catch (e) {
      err = e as ParseError
    }
    expect(err!.code).toBe('E_STATEMENT')
  })

  it('export in function body → rejected', () => {
    // export 只能出现在模块顶层：函数体内的 export 被 acorn 以 SyntaxError 拒绝
    // （扁平封装后函数体在 export default 内部，'export' may appear only at top level）
    const code = 'function bad() {\n  export const x = 1\n}'
    expect(() => parseScript(code)).toThrow(ParseError)
  })
})
