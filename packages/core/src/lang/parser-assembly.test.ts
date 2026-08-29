/**
 * 装配链式调用解析测试 — E15.1
 */
import { describe, it, expect } from 'vitest'
import { parseScript } from './parser'
import { scriptToCode, statementToLine } from './codegen'

describe('E15.1: 装配链式调用解析', () => {
  it('解析 const/let assem1 = cad.assembly({...})', () => {
    const code = `
      let part0 = cad.box({ size: 20 })
      let part1 = cad.box({ size: 10 })
      let assem1 = cad.assembly({
        name: 'MyAssembly',
        members: ['part0', 'part1'],
        constraints: []
      })
    `
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(3)

    // 第三条语句应该是 assembly 结构型语句
    const assemblyStmt = script.statements[2]
    expect(assemblyStmt.callee).toBe('assembly')
    expect(assemblyStmt.args.name).toBe('MyAssembly')
    expect(assemblyStmt.args.members).toEqual(['part0', 'part1'])
  })

  it('解析 assem1.add_constraint({...})', () => {
    const code = `
      let part0 = cad.box({ size: 20 })
      let part1 = cad.box({ size: 10 })
      let assem1 = cad.assembly({ name: 'A', members: ['part0', 'part1'], constraints: [] })
      assem1.add_constraint({
        type: 'face_mate',
        fixedPartName: 'part0',
        movingPartName: 'part1',
        fixedFace: { surfaceType: 'plane' },
        movingFace: { surfaceType: 'plane' }
      })
    `
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(4)

    const addConstraintStmt = script.statements[3]
    expect(addConstraintStmt.callee).toBe('add_constraint')
    expect(addConstraintStmt.receiver).toBe('assem1')
    expect(addConstraintStmt.args.type).toBe('face_mate')
    expect(addConstraintStmt.args.fixedPartName).toBe('part0')
    expect(addConstraintStmt.args.movingPartName).toBe('part1')
  })

  it('解析 assem1.do_assemble()', () => {
    const code = `
      let part0 = cad.box({ size: 20 })
      let part1 = cad.box({ size: 10 })
      let assem1 = cad.assembly({ name: 'A', members: ['part0', 'part1'], constraints: [] })
      assem1.add_constraint({ type: 'face_mate', fixedPartName: 'part0', movingPartName: 'part1', fixedFace: { surfaceType: 'plane' }, movingFace: { surfaceType: 'plane' } })
      assem1.do_assemble()
    `
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(5)

    const doAssembleStmt = script.statements[4]
    expect(doAssembleStmt.callee).toBe('do_assemble')
    expect(doAssembleStmt.receiver).toBe('assem1')
  })

  it('拒绝未声明的装配变量', () => {
    const code = `
      let part0 = cad.box({ size: 20 })
      unknown_var.add_constraint({ type: 'face_mate' })
    `
    expect(() => parseScript(code)).toThrow(/unknown variable "unknown_var"/)
  })

  it('Phase 3: let 允许用于普通 cad.op()（单入单出复用名时 codegen 产生 let 重赋值）', () => {
    const code = `
      let foo = cad.box({ size: 20 })
    `
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(1)
    expect(script.statements[0].callee).toBe('box')
  })

  it('完整链式调用 roundtrip', () => {
    const code = `
      let part0 = cad.box({ size: 20 })
      let part1 = cad.box({ size: 10 })
      let assem1 = cad.assembly({ name: 'A', members: ['part0', 'part1'], constraints: [] })
      assem1.add_constraint({ type: 'face_mate', fixedPartName: 'part0', movingPartName: 'part1', fixedFace: { surfaceType: 'plane' }, movingFace: { surfaceType: 'plane' } })
      assem1.do_assemble()
    `
    const { script } = parseScript(code)

    // 重新生成代码
    const regenerated = scriptToCode(script)

    // 验证再生成包含链式调用语法
    expect(regenerated).toContain('cad.assembly(')
    expect(regenerated).toContain('assem1.add_constraint(')
    expect(regenerated).toContain('assem1.do_assemble()')
  })

  it('statementToLine 正确生成链式调用', () => {
    const code = `
      let part0 = cad.box({ size: 20 })
      let assem1 = cad.assembly({ name: 'A', members: ['part0'] })
      assem1.do_assemble()
    `
    const { script } = parseScript(code)

    const assemblyLine = statementToLine(script.statements[1])
    expect(assemblyLine).toContain('cad.assembly(')

    const doAssembleLine = statementToLine(script.statements[2])
    expect(doAssembleLine).toBe('assem1.do_assemble()')
  })
})
