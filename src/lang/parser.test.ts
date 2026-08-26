/**
 * parser 单元测试 — 文本 → PartScript（扁平代码格式）
 *
 * 覆盖：
 * - apiVersion 解析
 * - 语句解析（创建/变换/特征类）
 * - boolean op（cad.union/subtract/intersect）
 * - ParamRef / GeomRef 解析
 * - terminal shapes 自动推导
 * - 错误处理（行号报告）
 * - 往返：codegen → parser → 相同语义
 */

import { describe, it, expect } from 'vitest'
import { parseScript, ParseError, getApiVersion, computeTerminalShapes } from './parser'
import { scriptToCode } from './codegen'
import type { PartScript, CadStatement } from './types'
import { asStmtId, asPartName } from '../identity'

// ── 测试辅助 ──

function makeStmt(
  partial: Omit<Partial<CadStatement>, 'id' | 'inputs' | 'outputs'> & { id?: string; inputs?: string[]; outputs?: string[] },
): CadStatement {
  const { id, inputs, outputs, ...rest } = partial
  return {
    id: asStmtId(id ?? 'st_part1_1'),
    op: 'box',
    args: {},
    inputs: (inputs ?? []).map(asPartName),
    outputs: outputs?.map(asPartName),
    hasAssignment: true,
    ...rest,
  }
}

// ── apiVersion ──

describe('parser: apiVersion', () => {
  it('从文本头部解析 apiVersion', () => {
    expect(getApiVersion('// apiVersion: 1\nconst part0_v0 = cad.box({ size: 20 })')).toBe(1)
    expect(getApiVersion('// apiVersion: 2\nconst part0_v0 = cad.box({ size: 20 })')).toBe(2)
  })

  it('无 apiVersion 时默认为 1', () => {
    expect(getApiVersion('const part0_v0 = cad.box({ size: 20 })')).toBe(1)
  })
})

// ── 基本解析 ──

describe('parser: 基本语句', () => {
  it('解析单条 box 语句（扁平格式）', () => {
    const code = `const part0_v0 = cad.box({ size: 20 })`
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(1)
    expect(script.statements[0].op).toBe('box')
    expect(script.statements[0].args.size).toBe(20)
    expect(script.statements[0].inputs).toEqual([])
    expect(script.statements[0].id).toBe('part0_v0')
  })

  it('解析 vec3 参数', () => {
    const code = `const part0_v0 = cad.box({ size: [10,20,30] })`
    const { script } = parseScript(code)
    expect(script.statements[0].args.size).toEqual([10, 20, 30])
  })

  it('解析字符串参数', () => {
    const code = `const part0_v0 = cad.load({ key: 'model.3mf' })`
    const { script } = parseScript(code)
    expect(script.statements[0].op).toBe('load')
    expect(script.statements[0].args.key).toBe('model.3mf')
  })

  it('解析多参数语句', () => {
    const code = `const part0_v0 = cad.cone({ radiusBottom:5, radiusTop:0, height:10, segments:32 })`
    const { script } = parseScript(code)
    expect(script.statements[0].args.radiusBottom).toBe(5)
    expect(script.statements[0].args.radiusTop).toBe(0)
    expect(script.statements[0].args.height).toBe(10)
    expect(script.statements[0].args.segments).toBe(32)
  })
})

// ── 依赖链 ──

describe('parser: 依赖链', () => {
  it('解析带 input 的语句', () => {
    const code = `const part0_v0 = cad.box({ size: 20 })
const part0_v1 = cad.translate(part0_v0, { offset:[10,0,0] })`
    const { script, varToId } = parseScript(code)
    expect(script.statements).toHaveLength(2)
    expect(script.statements[1].op).toBe('translate')
    expect(script.statements[1].inputs).toEqual(['part0_v0'])
    expect(varToId.get('part0_v0')).toBe('part0_v0')
    expect(varToId.get('part0_v1')).toBe('part0_v1')
  })

  it('解析多级依赖（含 await 异步 op）', () => {
    const code = `const part0_v0 = cad.box({ size: 20 })
const part0_v1 = cad.translate(part0_v0, { offset:[0,0,5] })
const part0_v2 = await cad.drill(part0_v1, { diameter:5, depth:0 })`
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(3)
    expect(script.statements[1].inputs).toEqual(['part0_v0'])
    expect(script.statements[2].inputs).toEqual(['part0_v1'])
    expect(script.statements[2].op).toBe('drill')
  })
})

// ── boolean op ──

describe('parser: boolean op', () => {
  it('解析 cad.union(a, b)', () => {
    const code = `const part0_v0 = cad.box({ size: 20 })
const part0_v1 = cad.sphere({ radius: 10 })
const part0_v2 = await cad.union(part0_v0, part0_v1)`
    const { script } = parseScript(code)
    expect(script.statements[2].op).toBe('boolean')
    expect(script.statements[2].args.operation).toBe('union')
    expect(script.statements[2].inputs).toEqual(['part0_v0', 'part0_v1'])
  })

  it('解析 cad.subtract(a, b)', () => {
    const code = `const part0_v0 = cad.box({ size: 20 })
const part0_v1 = cad.sphere({ radius: 10 })
const part0_v2 = await cad.subtract(part0_v0, part0_v1)`
    const { script } = parseScript(code)
    expect(script.statements[2].args.operation).toBe('subtract')
  })
})

// ── ParamRef / GeomRef ──

describe('parser: ParamRef 与 GeomRef', () => {
  it('解析 ParamRef（裸标识符引用参数）', () => {
    const code = `const size = 20
const part0_v0 = cad.box({ size: size })`
    const { script } = parseScript(code)
    expect(script.params).toHaveLength(1)
    expect(script.params[0].name).toBe('size')
    expect(script.params[0].value).toBe(20)
    expect(script.statements[0].args.size).toEqual({ $param: 'size' })
  })

  it('解析 GeomRef cad.bboxCenter(var)', () => {
    const code = `const part0_v0 = cad.box({ size: 20 })
const part0_v1 = cad.box({ size: cad.bboxCenter(part0_v0) })`
    const { script } = parseScript(code)
    expect(script.statements[1].args.size).toEqual({
      $geom: { of: 'part0_v0', feature: 'bboxCenter' },
    })
  })

  it('解析 GeomRef cad.faceCenter(var, [anchor])', () => {
    const code = `const part0_v0 = cad.box({ size: 20 })
const part0_v1 = cad.box({ size: cad.faceCenter(part0_v0, [0,0,10]) })`
    const { script } = parseScript(code)
    const ref = script.statements[1].args.size as { $geom: { of: string; feature: string; anchor?: { point: number[] } } }
    expect(ref.$geom.feature).toBe('faceCenter')
    expect(ref.$geom.of).toBe('part0_v0')
    expect(ref.$geom.anchor?.point).toEqual([0, 0, 10])
  })
})

// ── terminal shapes 自动推导 ──

describe('parser: terminal shapes 自动推导', () => {
  it('单条语句 → 无 terminalShapes（单终端等价为 meta）', () => {
    const code = `const part0_v0 = cad.box({ size: 20 })`
    const { script } = parseScript(code)
    expect(script.terminalShapes).toBeUndefined()
  })

  it('两条独立语句 → 两个终端', () => {
    const code = `const part0_v0 = cad.box({ size: 20 })
const part1_v0 = cad.sphere({ radius: 10 })`
    const { script } = parseScript(code)
    expect(script.terminalShapes).toBeDefined()
    expect(script.terminalShapes).toHaveLength(2)
    expect(script.terminalShapes![0].id).toBe('part0_v0')
    expect(script.terminalShapes![1].id).toBe('part1_v0')
  })

  it('依赖链 → 最后一条是终端', () => {
    const code = `const part0_v0 = cad.box({ size: 20 })
const part0_v1 = cad.translate(part0_v0, { offset:[10,0,0] })`
    const { script } = parseScript(code)
    // 只有一个终端（part0_v1），不返回数组
    expect(script.terminalShapes).toBeUndefined()
  })

  it('split 解构 → 两个终端', () => {
    const code = `const part0_v0 = cad.box({ size: 20 })
const { front: part1_v0, back: part2_v0 } = await cad.split(part0_v0, { normal:[0,0,1], offset:0 })`
    const { script } = parseScript(code)
    expect(script.terminalShapes).toBeDefined()
    expect(script.terminalShapes).toHaveLength(2)
    expect(script.terminalShapes![0].id).toBe('part1_v0')
    expect(script.terminalShapes![1].id).toBe('part2_v0')
  })
})

// ── split 解构 ──

describe('parser: split 解构', () => {
  it('解析 const { front: part1_v0, back: part2_v0 } = await cad.split(...)', () => {
    const code = `const part0_v0 = cad.box({ size: 20 })
const { front: part1_v0, back: part2_v0 } = await cad.split(part0_v0, { normal:[0,0,1], offset:0 })`
    const { script, varToId } = parseScript(code)
    expect(script.statements).toHaveLength(2)
    const splitStmt = script.statements[1]
    expect(splitStmt.op).toBe('split')
    expect(splitStmt.outputs).toEqual(['part1_v0', 'part2_v0'])
    expect(splitStmt.inputs).toEqual(['part0_v0'])
    expect(varToId.get('part1_v0')).toBe('part1_v0')
    expect(varToId.get('part2_v0')).toBe('part2_v0')
  })

  it('split 解构只允许 front 和 back 两个键', () => {
    const code = `const part0_v0 = cad.box({ size: 20 })
const { front: part1_v0, left: part2_v0 } = await cad.split(part0_v0, { normal:[0,0,1], offset:0 })`
    expect(() => parseScript(code)).toThrow(/only allows "front" and "back"/)
  })

  it('split 解构必须恰好两个属性', () => {
    const code = `const part0_v0 = cad.box({ size: 20 })
const { front: part1_v0 } = await cad.split(part0_v0, { normal:[0,0,1], offset:0 })`
    expect(() => parseScript(code)).toThrow(/exactly 2 properties/)
  })

  it('解构只允许 cad.split（不允许其他 op）', () => {
    const code = `const part0_v0 = cad.box({ size: 20 })
const { front: part1_v0, back: part2_v0 } = await cad.drill(part0_v0, { diameter:5, depth:0 })`
    expect(() => parseScript(code)).toThrow(/only allowed for cad\.split/)
  })
})

// ── 错误处理 ──

describe('parser: 错误处理', () => {
  it('旧格式 param 关键字 → ParseError', () => {
    expect(() => parseScript('param size = 20')).toThrow(ParseError)
  })

  it('非 async 箭头函数 → ParseError（旧格式 export default (cad) => {}）', () => {
    expect(() => parseScript('export default (cad) => {}')).toThrow(ParseError)
  })

  it('未知变量引用 → ParseError', () => {
    const code = `const part0_v0 = cad.box({ size: 20 })
const part0_v1 = cad.translate(partUnknown, { offset:[0,0,0] })`
    expect(() => parseScript(code)).toThrow(/unknown variable/)
  })

  it('if 语句 → ParseError', () => {
    const code = `if (true) { const part0_v0 = cad.box({ size: 20 }) }`
    expect(() => parseScript(code)).toThrow(ParseError)
  })
})

// ── computeTerminalShapes 单元测试 ──

describe('computeTerminalShapes', () => {
  it('空语句列表 → undefined', () => {
    expect(computeTerminalShapes([])).toBeUndefined()
  })

  it('单条语句 → undefined（单终端）', () => {
    const stmts = [makeStmt({ id: 'part0_v0', op: 'box', args: { size: 20 } })]
    expect(computeTerminalShapes(stmts)).toBeUndefined()
  })

  it('两条独立语句 → 两个终端', () => {
    const stmts = [
      makeStmt({ id: 'part0_v0', op: 'box', args: { size: 20 } }),
      makeStmt({ id: 'part1_v0', op: 'sphere', args: { radius: 10 } }),
    ]
    const result = computeTerminalShapes(stmts)
    expect(result).toBeDefined()
    expect(result).toHaveLength(2)
    expect(result![0].id).toBe('part0_v0')
    expect(result![1].id).toBe('part1_v0')
  })

  it('依赖链 → 最后一条是终端', () => {
    const stmts = [
      makeStmt({ id: 'part0_v0', op: 'box', args: { size: 20 } }),
      makeStmt({ id: 'part0_v1', op: 'translate', args: { offset: [1, 0, 0] }, inputs: ['part0_v0'] }),
    ]
    // 只有一个终端 part0_v1，所以返回 undefined
    expect(computeTerminalShapes(stmts)).toBeUndefined()
  })

  it('split 解构 → 两个终端', () => {
    const stmts = [
      makeStmt({ id: 'part0_v0', op: 'box', args: { size: 20 } }),
      makeStmt({
        id: 'part1_v0',
        op: 'split',
        args: { side: 'front' },
        inputs: ['part0_v0'],
        outputs: ['part1_v0', 'part2_v0'],
      }),
    ]
    const result = computeTerminalShapes(stmts)
    expect(result).toBeDefined()
    expect(result).toHaveLength(2)
    expect(result![0].id).toBe('part1_v0')
    expect(result![1].id).toBe('part2_v0')
  })
})

// ── 往返测试（codegen → parser → 相同语义） ──

describe('parser: 往返 codegen → parser', () => {
  it('单条 box 往返', () => {
    const script: PartScript = {
      params: [],
      statements: [makeStmt({ id: 'part0_v0', op: 'box', args: { size: 20 } })],
    }
    const code = scriptToCode(script)
    const { script: parsed } = parseScript(code)
    expect(parsed.statements).toHaveLength(1)
    expect(parsed.statements[0].op).toBe('box')
    expect(parsed.statements[0].args.size).toBe(20)
  })

  it('带依赖链往返', () => {
    const script: PartScript = {
      params: [],
      statements: [
        makeStmt({ id: 'part0_v0', op: 'box', args: { size: 20 } }),
        makeStmt({ id: 'part0_v1', op: 'translate', args: { offset: [10, 0, 0] }, inputs: ['part0_v0'] }),
      ],
    }
    const code = scriptToCode(script)
    const { script: parsed } = parseScript(code)
    expect(parsed.statements).toHaveLength(2)
    expect(parsed.statements[1].op).toBe('translate')
    expect(parsed.statements[1].inputs).toEqual([parsed.statements[0].id])
    expect(parsed.statements[1].args.offset).toEqual([10, 0, 0])
  })

  it('带 boolean op 往返', () => {
    const script: PartScript = {
      params: [],
      statements: [
        makeStmt({ id: 'part0_v0', op: 'box', args: { size: 20 } }),
        makeStmt({ id: 'part0_v1', op: 'sphere', args: { radius: 10 } }),
        makeStmt({ id: 'part0_v2', op: 'boolean', args: { operation: 'union', sourcePartNames: ['s0', 's1'] }, inputs: ['part0_v0', 'part0_v1'] }),
      ],
    }
    const code = scriptToCode(script)
    const { script: parsed } = parseScript(code)
    expect(parsed.statements).toHaveLength(3)
    expect(parsed.statements[2].op).toBe('boolean')
    expect(parsed.statements[2].args.operation).toBe('union')
    expect(parsed.statements[2].inputs).toEqual([
      parsed.statements[0].id,
      parsed.statements[1].id,
    ])
  })
})

// ── load 旧 op 名兼容 ──

describe('parser: load 旧 op 名兼容', () => {
  it('解析 cad.loadFile({ path, format }) → 映射为 load', () => {
    const code = `const part0_v0 = await cad.loadFile({ path: '/Users/me/models/bracket.step', format: 'step' })`
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(1)
    expect(script.statements[0].op).toBe('load')
    expect(script.statements[0].args.path).toBe('/Users/me/models/bracket.step')
    expect(script.statements[0].args.format).toBe('step')
  })

  it('旧 cad.load({ fileRef }) → fileRef 转为 key', () => {
    const code = `const part0_v0 = await cad.load({ fileRef: 'box_boss.3mf' })`
    const { script } = parseScript(code)
    expect(script.statements[0].op).toBe('load')
    expect(script.statements[0].args.key).toBe('box_boss.3mf')
    expect(script.statements[0].args.fileRef).toBeUndefined()
  })
})
