/**
 * 装配链式调用解析测试 — E15.1
 */
import { describe, it, expect } from 'vitest'
import { parseScript } from './parser'
import { scriptToCode, statementToLine } from './codegen'

describe('E15.1: 装配链式调用解析', () => {
  it('解析 const/let assem1 = cad.assemble({...})', () => {
    const code = `
      const part0_v0 = cad.box({ size: 20 })
      const part1_v0 = cad.box({ size: 10 })
      let assem1 = cad.assemble({
        name: 'MyAssembly',
        members: ['part0_v0', 'part1_v0'],
        constraints: []
      })
    `
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(3)

    // 第三条语句应该是 assemble 结构型语句
    const assembleStmt = script.statements[2]
    expect(assembleStmt.op).toBe('assemble')
    expect(assembleStmt.assemblyVar).toBe('assem1')
    expect(assembleStmt.args.name).toBe('MyAssembly')
    expect(assembleStmt.args.members).toEqual(['part0_v0', 'part1_v0'])
  })

  it('解析 assem1.add_constraint({...})', () => {
    const code = `
      const part0_v0 = cad.box({ size: 20 })
      const part1_v0 = cad.box({ size: 10 })
      let assem1 = cad.assemble({ name: 'A', members: ['part0_v0', 'part1_v0'], constraints: [] })
      assem1.add_constraint({
        type: 'face_mate',
        fixedPartName: 'part0_v0',
        movingPartName: 'part1_v0',
        fixedFace: { faceId: 'face_0', surfaceType: 'plane' },
        movingFace: { faceId: 'face_2', surfaceType: 'plane' }
      })
    `
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(4)

    const addConstraintStmt = script.statements[3]
    expect(addConstraintStmt.op).toBe('add_constraint')
    expect(addConstraintStmt.assemblyTarget).toBe('assem1')
    expect(addConstraintStmt.args.type).toBe('face_mate')
    expect(addConstraintStmt.args.fixedPartName).toBe('part0_v0')
    expect(addConstraintStmt.args.movingPartName).toBe('part1_v0')
  })

  it('解析 assem1.do_assemble()', () => {
    const code = `
      const part0_v0 = cad.box({ size: 20 })
      const part1_v0 = cad.box({ size: 10 })
      let assem1 = cad.assemble({ name: 'A', members: ['part0_v0', 'part1_v0'], constraints: [] })
      assem1.add_constraint({ type: 'face_mate', fixedPartName: 'part0_v0', movingPartName: 'part1_v0', fixedFace: { faceId: 'face_0', surfaceType: 'plane' }, movingFace: { faceId: 'face_2', surfaceType: 'plane' } })
      assem1.do_assemble()
    `
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(5)

    const doAssembleStmt = script.statements[4]
    expect(doAssembleStmt.op).toBe('do_assemble')
    expect(doAssembleStmt.assemblyTarget).toBe('assem1')
  })

  it('拒绝未声明的装配变量', () => {
    const code = `
      const part0_v0 = cad.box({ size: 20 })
      unknown_var.add_constraint({ type: 'face_mate' })
    `
    expect(() => parseScript(code)).toThrow(/unknown assembly variable/)
  })

  it('拒绝 let 用于非 assemble/group/assembly 场景', () => {
    const code = `
      let foo = cad.box({ size: 20 })
    `
    expect(() => parseScript(code)).toThrow(/let.*only.*cad\.assemble|let.*only.*cad\.group|let.*only.*cad\.assembly/)
  })

  it('完整链式调用 roundtrip', () => {
    const code = `
      const part0_v0 = cad.box({ size: 20 })
      const part1_v0 = cad.box({ size: 10 })
      let assem1 = cad.assemble({ name: 'A', members: ['part0_v0', 'part1_v0'], constraints: [] })
      assem1.add_constraint({ type: 'face_mate', fixedPartName: 'part0_v0', movingPartName: 'part1_v0', fixedFace: { faceId: 'face_0', surfaceType: 'plane' }, movingFace: { faceId: 'face_2', surfaceType: 'plane' } })
      assem1.do_assemble()
    `
    const { script } = parseScript(code)

    // 重新生成代码
    const regenerated = scriptToCode(script)

    // 验证再生成包含链式调用语法
    expect(regenerated).toContain('const assem1 = cad.assemble(')
    expect(regenerated).toContain('assem1.add_constraint(')
    expect(regenerated).toContain('assem1.do_assemble()')
  })

  it('statementToLine 正确生成链式调用', () => {
    const code = `
      const part0_v0 = cad.box({ size: 20 })
      let assem1 = cad.assemble({ name: 'A', members: ['part0_v0'] })
      assem1.do_assemble()
    `
    const { script } = parseScript(code)

    const assembleLine = statementToLine(script.statements[1])
    expect(assembleLine).toContain('const assem1 = cad.assemble(')

    const doAssembleLine = statementToLine(script.statements[2])
    expect(doAssembleLine).toBe('assem1.do_assemble()')
  })
})
