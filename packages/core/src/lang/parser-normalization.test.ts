/**
 * parser-normalization — 语言正常化新语法形态规格测试（阶段 0，目标 IR 字段）
 *
 * 设计文档：docs/plans/2026-08-27-faijs-language-normalization-design.md §4.1/§4.3
 *
 * 这些用例按**目标 IR**（callee/receiver/outputKeys/VarRefIR/CallRefIR）断言。
 * 阶段 2（IR + parser 纯化）落地后转绿；在此之前保持红 = 规格已锁定。
 */

import { describe, it, expect } from 'vitest'
import { parseScript } from './parser'
import { isVarRef, isCallRef, type CallRefIR, type ArgIR } from './types'

describe('parser-normalization: boolean 归一取消', () => {
  it('cad.union(a,b) → callee === "union"，无 args.operation', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: 10 })',
      'let part2 = cad.union(part0, part1)',
    ].join('\n')
    const { script } = parseScript(code)
    const unionStmt = script.statements[2]
    expect(unionStmt.callee).toBe('union')
    expect(unionStmt.args.operation).toBeUndefined()
    expect(unionStmt.inputs).toHaveLength(2)
  })

  it('cad.subtract(a,b) → callee === "subtract"', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: 10 })',
      'let part2 = cad.subtract(part0, part1)',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[2].callee).toBe('subtract')
    expect(script.statements[2].inputs).toHaveLength(2)
  })
})

describe('parser-normalization: 任意 callee 的对象解构', () => {
  it('cad.split 解构 → outputKeys === ["front","back"]', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
      'const { front, back } = await cad.split(part0, { normal: [0,0,1], offset: 0 })',
    ].join('\n')
    const { script } = parseScript(code)
    const splitStmt = script.statements[1]
    expect(splitStmt.callee).toBe('split')
    expect(splitStmt.outputKeys).toEqual(['front', 'back'])
    expect(splitStmt.outputs).toHaveLength(2)
  })

  it('非 split callee 的解构也合法（如 decompose）', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
      'const { a, b } = cad.decompose(part0)',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[1].callee).toBe('decompose')
    expect(script.statements[1].outputKeys).toEqual(['a', 'b'])
  })
})

describe('parser-normalization: 任意成员调用', () => {
  it('asm1.add_constraint / asm1.do_assemble → receiver/callee', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
      'let asm1 = cad.assembly({ name: "A", members: [part0] })',
      'asm1.add_constraint({ type: "coincident" })',
      'asm1.do_assemble()',
    ].join('\n')
    const { script } = parseScript(code)
    const addConstraint = script.statements[2]
    expect(addConstraint.receiver).toBe('asm1')
    expect(addConstraint.callee).toBe('add_constraint')
    const doAssemble = script.statements[3]
    expect(doAssemble.receiver).toBe('asm1')
    expect(doAssemble.callee).toBe('do_assemble')
  })

  it('任意方法名（如 asm1.myMethod()）也合法（receiver 须已声明）', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
      'let asm1 = cad.assembly({ name: "A", members: [part0] })',
      'asm1.myMethod({ x: 1 })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[2].receiver).toBe('asm1')
    expect(script.statements[2].callee).toBe('myMethod')
  })
})

describe('parser-normalization: args 内嵌套调用 → CallRefIR', () => {
  it('cad.drill(part0, { at: cad.faceCenter(part2) }) → args.at 是 CallRefIR', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
      'let part2 = cad.box({ size: 5 })',
      'part0 = cad.drill(part0, { at: cad.faceCenter(part2), depth: 2 })',
    ].join('\n')
    const { script } = parseScript(code)
    const drillStmt = script.statements[2]
    const atArg = drillStmt.args.at
    expect(isCallRef(atArg)).toBe(true)
    const callRef = atArg as CallRefIR
    expect(callRef.$call.callee).toBe('faceCenter')
    expect(callRef.$call.args).toHaveLength(1)
    expect(isVarRef(callRef.$call.args[0])).toBe(true)
  })
})

describe('parser-normalization: members 走 VarRefIR', () => {
  it('cad.group({ members: [part0, part1] }) → members 是 VarRefIR 数组', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
      'let part1 = cad.box({ size: 10 })',
      'let g = cad.group({ members: [part0, part1] })',
    ].join('\n')
    const { script } = parseScript(code)
    const groupStmt = script.statements[2]
    const members = groupStmt.args.members as ArgIR[] | undefined
    expect(Array.isArray(members)).toBe(true)
    expect(members).toHaveLength(2)
    expect(isVarRef(members![0])).toBe(true)
    expect(isVarRef(members![1])).toBe(true)
  })
})

describe('parser-normalization: asset 走 CallRefIR', () => {
  it('cad.asset("cfg") 嵌套在 args 中 → CallRefIR', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
      'part0 = cad.drill(part0, { depth: cad.asset("cfg") })',
    ].join('\n')
    const { script } = parseScript(code)
    const drillStmt = script.statements[1]
    expect(isCallRef(drillStmt.args.depth)).toBe(true)
    const callRef = drillStmt.args.depth as CallRefIR
    expect(callRef.$call.callee).toBe('asset')
    expect(callRef.$call.args).toEqual(['cfg'])
  })
})

describe('parser-normalization: 裸重赋值保留', () => {
  it('part0 = cad.drill(part0, {...}) → callee==="drill"、inputs=[part0]', () => {
    const code = [
      'let part0 = cad.box({ size: 20 })',
      'part0 = cad.drill(part0, { diameter: 5 })',
    ].join('\n')
    const { script } = parseScript(code)
    const drillStmt = script.statements[1]
    expect(drillStmt.callee).toBe('drill')
    expect(drillStmt.inputs).toEqual(['part0'])
    expect(drillStmt.outputs).toEqual(['part0'])
  })
})

describe('parser-normalization: load 别名不再收敛', () => {
  it('cad.loadFile({ path }) → callee === "loadFile"（不收敛为 load）', () => {
    const code = [
      'let part0 = cad.loadFile({ path: "/tmp/x.step" })',
    ].join('\n')
    const { script } = parseScript(code)
    expect(script.statements[0].callee).toBe('loadFile')
  })
})
