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
import { parseScript, ParseError, getApiVersion } from './parser'
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
    outputs: (outputs ?? [id ?? 'part0']).map(asPartName),
    hasAssignment: true,
    ...rest,
  }
}

// ── apiVersion ──

describe('parser: apiVersion', () => {
  it('从文本头部解析 apiVersion', () => {
    expect(getApiVersion('// apiVersion: 1\nconst part0 = cad.box({ size: 20 })')).toBe(1)
    expect(getApiVersion('// apiVersion: 2\nconst part0 = cad.box({ size: 20 })')).toBe(2)
  })

  it('无 apiVersion 时默认为 1', () => {
    expect(getApiVersion('const part0 = cad.box({ size: 20 })')).toBe(1)
  })
})

// ── 基本解析 ──

describe('parser: 基本语句', () => {
  it('解析单条 box 语句（扁平格式）', () => {
    const code = `let part0 = cad.box({ size: 20 })`
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(1)
    expect(script.statements[0].op).toBe('box')
    expect(script.statements[0].args.size).toBe(20)
    expect(script.statements[0].inputs).toEqual([])
    expect(script.statements[0].id).toBe('s1')
    // Phase 3: box 是 creator op，分配新名 part0（而非变量名 part0）
    expect(script.statements[0].outputs).toEqual(['part0'])
  })

  it('解析 vec3 参数', () => {
    const code = `let part0 = cad.box({ size: [10,20,30] })`
    const { script } = parseScript(code)
    expect(script.statements[0].args.size).toEqual([10, 20, 30])
  })

  it('解析字符串参数', () => {
    const code = `let part0 = cad.load({ key: 'model.3mf' })`
    const { script } = parseScript(code)
    expect(script.statements[0].op).toBe('load')
    expect(script.statements[0].args.key).toBe('model.3mf')
  })

  it('解析多参数语句', () => {
    const code = `let part0 = cad.cone({ radiusBottom:5, radiusTop:0, height:10, segments:32 })`
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
    const code = `let part0 = cad.box({ size: 20 })
part0 = cad.translate(part0, { offset:[10,0,0] })`
    const { script, varToId } = parseScript(code)
    expect(script.statements).toHaveLength(2)
    expect(script.statements[1].op).toBe('translate')
    // Phase 3: translate 是单入单出，复用输入名 part0
    expect(script.statements[1].inputs).toEqual(['part0'])
    expect(varToId.get('part0')).toBe('part0')
  })

  it('解析多级依赖（含 await 异步 op）', () => {
    const code = `let part0 = cad.box({ size: 20 })
part0 = cad.translate(part0, { offset:[0,0,5] })
part0 = await cad.drill(part0, { diameter:5, depth:0 })`
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(3)
    // Phase 3: 复用输入名
    expect(script.statements[1].inputs).toEqual(['part0'])
    expect(script.statements[2].inputs).toEqual(['part0'])
    expect(script.statements[2].op).toBe('drill')
  })
})

// ── boolean op ──

describe('parser: boolean op', () => {
  it('解析 cad.union(a, b)', () => {
    const code = `let part0 = cad.box({ size: 20 })
let part1 = cad.sphere({ radius: 10 })
let part2 = await cad.union(part0, part1)`
    const { script } = parseScript(code)
    expect(script.statements[2].op).toBe('boolean')
    expect(script.statements[2].args.operation).toBe('union')
    // Phase 3: boolean 是多入新名 → part1；但 inputs 引用的是上游的 outputs
    expect(script.statements[2].inputs).toEqual(['part0', 'part1'])
  })

  it('解析 cad.subtract(a, b)', () => {
    const code = `let part0 = cad.box({ size: 20 })
let part1 = cad.sphere({ radius: 10 })
let part2 = await cad.subtract(part0, part1)`
    const { script } = parseScript(code)
    expect(script.statements[2].args.operation).toBe('subtract')
  })
})

// ── ParamRef / GeomRef ──

describe('parser: ParamRef 与 GeomRef', () => {
  it('解析 ParamRef（裸标识符引用参数）', () => {
    const code = `const size = 20
let part0 = cad.box({ size: size })`
    const { script } = parseScript(code)
    expect(script.params).toHaveLength(1)
    expect(script.params[0].name).toBe('size')
    expect(script.params[0].value).toBe(20)
    expect(script.statements[0].args.size).toEqual({ $param: 'size' })
  })

  it('解析 GeomRef cad.bboxCenter(var)', () => {
    const code = `let part0 = cad.box({ size: 20 })
let part1 = cad.box({ size: cad.bboxCenter(part0) })`
    const { script } = parseScript(code)
    expect(script.statements[1].args.size).toEqual({
      $geom: { of: 'part0', feature: 'bboxCenter' },
    })
  })

  it('解析 GeomRef cad.faceCenter(var, [anchor])', () => {
    const code = `let part0 = cad.box({ size: 20 })
let part1 = cad.box({ size: cad.faceCenter(part0, [0,0,10]) })`
    const { script } = parseScript(code)
    const ref = script.statements[1].args.size as { $geom: { of: string; feature: string; anchor?: { point: number[] } } }
    expect(ref.$geom.feature).toBe('faceCenter')
    expect(ref.$geom.of).toBe('part0')
    expect(ref.$geom.anchor?.point).toEqual([0, 0, 10])
  })
})

// ── outputs 与终端（Phase 3: parser 不再自动计算终端，终端判定移入 runtime.collectResult） ──

describe('parser: outputs / 终端语义（Phase 3）', () => {
  it('单条语句 → 无 terminalShapes（parser 不再自动计算；运行期从 outputs 过滤）', () => {
    const code = `let part0 = cad.box({ size: 20 })`
    const { script } = parseScript(code)
    expect(script.terminalShapes).toBeUndefined()
    // outputs 承载变量名（partName），供运行期终端判定
    expect(script.statements[0].outputs).toEqual(['part0'])
  })

  it('两条独立语句 → 两个独立 outputs（part0/part1，运行期各为终端）', () => {
    const code = `let part0 = cad.box({ size: 20 })
let part1 = cad.sphere({ radius: 10 })`
    const { script } = parseScript(code)
    expect(script.terminalShapes).toBeUndefined()
    // Phase 3: box/sphere 分配新名 part0/part1
    expect(script.statements[0].outputs).toEqual(['part0'])
    expect(script.statements[1].outputs).toEqual(['part1'])
  })

  it('依赖链（复用名）→ 单 outputs 条目（part0 始终是同一模型）', () => {
    const code = `let part0 = cad.box({ size: 20 })
part0 = cad.translate(part0, { offset:[10,0,0] })`
    const { script } = parseScript(code)
    expect(script.terminalShapes).toBeUndefined()
    // 单入单出复用输入名 → 两条语句 outputs 都是 part0
    expect(script.statements[0].outputs).toEqual(['part0'])
    expect(script.statements[1].outputs).toEqual(['part0'])
  })

  it('split 解构 → 两个 outputs（part1/part2）', () => {
    const code = `let part0 = cad.box({ size: 20 })
const { front: part1, back: part2 } = await cad.split(part0, { normal:[0,0,1], offset:0 })`
    const { script } = parseScript(code)
    expect(script.terminalShapes).toBeUndefined()
    // Phase 3: split 分配新名 part1/part2
    expect(script.statements[1].outputs).toEqual(['part1', 'part2'])
  })
})

// ── split 解构 ──

describe('parser: split 解构', () => {
  it('解析 const { front: part1, back: part2 } = await cad.split(...)', () => {
    const code = `let part0 = cad.box({ size: 20 })
const { front: part1, back: part2 } = await cad.split(part0, { normal:[0,0,1], offset:0 })`
    const { script, varToId } = parseScript(code)
    expect(script.statements).toHaveLength(2)
    const splitStmt = script.statements[1]
    expect(splitStmt.op).toBe('split')
    // Phase 3: split 分配新名 part1/part2；box 是 part0
    expect(splitStmt.outputs).toEqual(['part1', 'part2'])
    expect(splitStmt.inputs).toEqual(['part0'])
    expect(varToId.get('part1')).toBe('part1')
    expect(varToId.get('part2')).toBe('part2')
  })

  it('split 解构只允许 front 和 back 两个键', () => {
    const code = `let part0 = cad.box({ size: 20 })
const { front: part1, left: part2 } = await cad.split(part0, { normal:[0,0,1], offset:0 })`
    expect(() => parseScript(code)).toThrow(/only allows "front" and "back"/)
  })

  it('split 解构必须恰好两个属性', () => {
    const code = `let part0 = cad.box({ size: 20 })
const { front: part1 } = await cad.split(part0, { normal:[0,0,1], offset:0 })`
    expect(() => parseScript(code)).toThrow(/exactly 2 properties/)
  })

  it('解构只允许 cad.split（不允许其他 op）', () => {
    const code = `let part0 = cad.box({ size: 20 })
const { front: part1, back: part2 } = await cad.drill(part0, { diameter:5, depth:0 })`
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
    const code = `let part0 = cad.box({ size: 20 })
part0 = cad.translate(partUnknown, { offset:[0,0,0] })`
    expect(() => parseScript(code)).toThrow(/unknown variable/)
  })

  it('if 语句 → ParseError', () => {
    const code = `if (true) { let part0 = cad.box({ size: 20 }) }`
    expect(() => parseScript(code)).toThrow(ParseError)
  })
})

// ── 往返测试（codegen → parser → 相同语义） ──

describe('parser: 往返 codegen → parser', () => {
  it('单条 box 往返', () => {
    const script: PartScript = {
      params: [],
      statements: [makeStmt({ id: 'part0', op: 'box', args: { size: 20 } })],
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
        makeStmt({ id: 'part0', op: 'box', args: { size: 20 } }),
        makeStmt({ id: 'part0', op: 'translate', args: { offset: [10, 0, 0] }, inputs: ['part0'] }),
      ],
    }
    const code = scriptToCode(script)
    const { script: parsed } = parseScript(code)
    expect(parsed.statements).toHaveLength(2)
    expect(parsed.statements[1].op).toBe('translate')
    expect(parsed.statements[1].inputs).toEqual([parsed.statements[0].outputs[0]])
    expect(parsed.statements[1].args.offset).toEqual([10, 0, 0])
  })

  it('带 boolean op 往返', () => {
    const script: PartScript = {
      params: [],
      statements: [
        makeStmt({ id: 'part0', op: 'box', args: { size: 20 } }),
        makeStmt({ id: 'part1', op: 'sphere', args: { radius: 10 } }),
        makeStmt({ id: 'part2', op: 'boolean', args: { operation: 'union', sourcePartNames: ['s0', 's1'] }, inputs: ['part0', 'part1'] }),
      ],
    }
    const code = scriptToCode(script)
    const { script: parsed } = parseScript(code)
    expect(parsed.statements).toHaveLength(3)
    expect(parsed.statements[2].op).toBe('boolean')
    expect(parsed.statements[2].args.operation).toBe('union')
    expect(parsed.statements[2].inputs).toEqual([
      parsed.statements[0].outputs[0],
      parsed.statements[1].outputs[0],
    ])
  })
})

// ── load 旧 op 名兼容 ──

describe('parser: load 旧 op 名兼容', () => {
  it('解析 cad.loadFile({ path, format }) → 映射为 load', () => {
    const code = `let part0 = await cad.loadFile({ path: '/Users/me/models/bracket.step', format: 'step' })`
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(1)
    expect(script.statements[0].op).toBe('load')
    expect(script.statements[0].args.path).toBe('/Users/me/models/bracket.step')
    expect(script.statements[0].args.format).toBe('step')
  })

  it('旧 cad.load({ fileRef }) → fileRef 转为 key', () => {
    const code = `let part0 = await cad.load({ fileRef: 'box_boss.3mf' })`
    const { script } = parseScript(code)
    expect(script.statements[0].op).toBe('load')
    expect(script.statements[0].args.key).toBe('box_boss.3mf')
    expect(script.statements[0].args.fileRef).toBeUndefined()
  })
})
