/**
 * parser 单元测试 — 文本 → PartScript（合法 JS 子集格式）
 *
 * 覆盖：
 * - apiVersion 解析
 * - const 参数声明
 * - 语句解析（创建/变换/特征类）
 * - await 异步 op
 * - boolean op（cad.union/subtract/intersect）
 * - ParamRef / GeomRef 解析
 * - return { shape, meta } 解析
 * - 错误处理（行号报告）
 * - 旧格式拒绝（param/with/export default v0）
 * - 往返：codegen → parser → 相同语义
 */

import { describe, it, expect } from 'vitest'
import { parseScript, ParseError, getApiVersion } from './parser'
import { scriptToCode } from './codegen'
import type { PartScript, CadStatement } from './types'

// ── 测试辅助 ──

function makeStmt(partial: Partial<CadStatement>): CadStatement {
  return {
    id: 'st_part1_1',
    op: 'box',
    args: {},
    inputs: [],
    feature: { kind: 'primitive', label: 'box', createdBy: 'user' },
    ...partial,
  }
}

// ── apiVersion ──

describe('parser: apiVersion', () => {
  it('从文本头部解析 apiVersion', () => {
    expect(getApiVersion('// apiVersion: 1\nexport default async (cad) => {}')).toBe(1)
    expect(getApiVersion('// apiVersion: 2\nexport default async (cad) => {}')).toBe(2)
  })

  it('无 apiVersion 时默认为 1', () => {
    expect(getApiVersion('export default async (cad) => {}')).toBe(1)
  })
})

// ── 基本解析 ──

describe('parser: 基本语句', () => {
  it('解析单条 box 语句', () => {
    const code = `// apiVersion: 1
export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  return { shape: part0_v0 }
}`
    const { script } = parseScript(code, { partId: 'test' })
    expect(script.partId).toBe('test')
    expect(script.statements).toHaveLength(1)
    expect(script.statements[0].op).toBe('box')
    expect(script.statements[0].args.size).toBe(20)
    expect(script.statements[0].inputs).toEqual([])
    expect(script.statements[0].id).toBe('part0_v0')
  })

  it('解析 vec3 参数', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: [10,20,30] })
  return { shape: part0_v0 }
}`
    const { script } = parseScript(code)
    expect(script.statements[0].args.size).toEqual([10, 20, 30])
  })

it('解析字符串参数', () => {
const code = `export default async (cad) => {
const part0_v0 = await cad.load({ key: 'model.glb' })
return { shape: part0_v0 }
}`
const { script } = parseScript(code)
expect(script.statements[0].op).toBe('load')
expect(script.statements[0].args.key).toBe('model.glb')
})

  it('解析多参数语句', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.cone({ radiusBottom:5, radiusTop:0, height:10, segments:32 })
  return { shape: part0_v0 }
}`
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
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  const part0_v1 = cad.translate(part0_v0, { offset:[10,0,0] })
  return { shape: part0_v1 }
}`
    const { script, varToId } = parseScript(code)
    expect(script.statements).toHaveLength(2)
    expect(script.statements[1].op).toBe('translate')
    expect(script.statements[1].inputs).toEqual(['part0_v0'])
    expect(varToId.get('part0_v0')).toBe('part0_v0')
    expect(varToId.get('part0_v1')).toBe('part0_v1')
  })

  it('解析多级依赖（含 await 异步 op）', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  const part0_v1 = cad.translate(part0_v0, { offset:[0,0,5] })
  const part0_v2 = await cad.drill(part0_v1, { diameter:5, depth:0 })
  return { shape: part0_v2 }
}`
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
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  const part0_v1 = cad.sphere({ radius: 10 })
  const part0_v2 = await cad.union(part0_v0, part0_v1)
  return { shape: part0_v2 }
}`
    const { script } = parseScript(code)
    expect(script.statements[2].op).toBe('boolean')
    expect(script.statements[2].args.operation).toBe('union')
    expect(script.statements[2].inputs).toEqual(['part0_v0', 'part0_v1'])
  })

  it('解析 cad.subtract(a, b)', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  const part0_v1 = cad.sphere({ radius: 10 })
  const part0_v2 = await cad.subtract(part0_v0, part0_v1)
  return { shape: part0_v2 }
}`
    const { script } = parseScript(code)
    expect(script.statements[2].args.operation).toBe('subtract')
  })
})

// ── ParamRef / GeomRef ──

describe('parser: ParamRef 与 GeomRef', () => {
  it('解析 ParamRef（裸标识符引用参数）', () => {
    const code = `export default async (cad) => {
  const size = 20
  const part0_v0 = cad.box({ size: size })
  return { shape: part0_v0 }
}`
    const { script } = parseScript(code)
    expect(script.params).toHaveLength(1)
    expect(script.params[0].name).toBe('size')
    expect(script.params[0].value).toBe(20)
    expect(script.statements[0].args.size).toEqual({ $param: 'size' })
  })

  it('解析 ParamRef shorthand { size }', () => {
    const code = `export default async (cad) => {
  const size = 20
  const part0_v0 = cad.box({ size })
  return { shape: part0_v0 }
}`
    const { script } = parseScript(code)
    expect(script.statements[0].args.size).toEqual({ $param: 'size' })
  })

  it('解析 GeomRef cad.bboxCenter(var)', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  const part0_v1 = cad.box({ size: cad.bboxCenter(part0_v0) })
  return { shape: part0_v1 }
}`
    const { script } = parseScript(code)
    expect(script.statements[1].args.size).toEqual({
      $geom: { of: 'part0_v0', feature: 'bboxCenter' },
    })
  })

  it('解析 GeomRef cad.faceCenter(var, [anchor])', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  const part0_v1 = cad.box({ size: cad.faceCenter(part0_v0, [0,0,10]) })
  return { shape: part0_v1 }
}`
    const { script } = parseScript(code)
    const ref = script.statements[1].args.size as { $geom: { of: string; feature: string; anchor?: { point: number[] } } }
    expect(ref.$geom.feature).toBe('faceCenter')
    expect(ref.$geom.of).toBe('part0_v0')
    expect(ref.$geom.anchor?.point).toEqual([0, 0, 10])
  })
})

// ── meta (return { shape, ... }) ──

describe('parser: meta (return { shape, ... })', () => {
  it('解析 name 和 color', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  return { shape: part0_v0, name: '支架底板', color: '#4A90D9' }
}`
    const { script } = parseScript(code)
    expect(script.meta).toBeDefined()
    expect(script.meta?.name).toBe('支架底板')
    expect(script.meta?.appearance?.color).toBe('#4A90D9')
  })

  it('解析完整 appearance', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  return { shape: part0_v0, name: 'Box', color: '#FF0000', metalness: 0.5, roughness: 0.3 }
}`
    const { script } = parseScript(code)
    expect(script.meta?.name).toBe('Box')
    expect(script.meta?.appearance?.color).toBe('#FF0000')
    expect(script.meta?.appearance?.metalness).toBe(0.5)
    expect(script.meta?.appearance?.roughness).toBe(0.3)
  })

  it('仅有 shape 无 meta 时 meta 为 undefined', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  return { shape: part0_v0 }
}`
    const { script } = parseScript(code)
    expect(script.meta).toBeUndefined()
  })
})

// ── 错误处理 ──

describe('parser: 错误处理', () => {
  it('旧格式 param 关键字 → ParseError（acorn 语法错误）', () => {
    expect(() => parseScript('param size = 20')).toThrow(ParseError)
  })

  it('旧格式 export default v0 with → ParseError', () => {
    expect(() => parseScript('export default v0 with { name: "test" }')).toThrow(ParseError)
  })

  it('扁平代码（无 export default）自动封装后解析成功', () => {
    // 扁平代码（无 export default）现在会被自动封装为合法容器
    const result = parseScript('const part0_v0 = cad.box({ size: 20 })')
    expect(result.script.statements).toHaveLength(1)
    expect(result.script.statements[0].op).toBe('box')
  })

  it('非 async 箭头函数 → ParseError', () => {
    expect(() => parseScript('export default (cad) => {}')).toThrow(ParseError)
  })

  it('未知变量引用 → ParseError', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  const part0_v1 = cad.translate(partUnknown, { offset:[0,0,0] })
  return { shape: part0_v1 }
}`
    expect(() => parseScript(code)).toThrow(/unknown variable/)
  })

  it('if 语句 → ParseError', () => {
    const code = `export default async (cad) => {
  if (true) { const part0_v0 = cad.box({ size: 20 }) }
  return { shape: part0_v0 }
}`
    expect(() => parseScript(code)).toThrow(ParseError)
  })
})

// ── 往返测试（codegen → parser → 相同语义） ──

describe('parser: 往返 codegen → parser', () => {
  it('单条 box 往返', () => {
    const script: PartScript = {
      partId: 'p1',
      params: [],
      statements: [makeStmt({ id: 'st_p1_1', op: 'box', args: { size: 20 } })],
    }
    const code = scriptToCode(script)
    const { script: parsed } = parseScript(code, { partId: 'p1' })
    expect(parsed.statements).toHaveLength(1)
    expect(parsed.statements[0].op).toBe('box')
    expect(parsed.statements[0].args.size).toBe(20)
  })

  it('带 meta 往返', () => {
    const script: PartScript = {
      partId: 'p1',
      params: [],
      statements: [makeStmt({ id: 'st_p1_1', op: 'box', args: { size: 20 } })],
      meta: { name: 'MyBox', appearance: { color: '#4A90D9' } },
    }
    const code = scriptToCode(script)
    const { script: parsed } = parseScript(code, { partId: 'p1' })
    expect(parsed.meta?.name).toBe('MyBox')
    expect(parsed.meta?.appearance?.color).toBe('#4A90D9')
  })

  it('带依赖链往返', () => {
    const script: PartScript = {
      partId: 'p1',
      params: [],
      statements: [
        makeStmt({ id: 'st_p1_1', op: 'box', args: { size: 20 } }),
        makeStmt({
          id: 'st_p1_2',
          op: 'translate',
          args: { offset: [10, 0, 0] },
          inputs: ['st_p1_1'],
          feature: { kind: 'transform', label: '移动', createdBy: 'user' },
        }),
      ],
    }
    const code = scriptToCode(script)
    const { script: parsed } = parseScript(code, { partId: 'p1' })
    expect(parsed.statements).toHaveLength(2)
    expect(parsed.statements[1].op).toBe('translate')
    expect(parsed.statements[1].inputs).toEqual([parsed.statements[0].id])
    expect(parsed.statements[1].args.offset).toEqual([10, 0, 0])
  })

  it('带 ParamRef 往返', () => {
    const script: PartScript = {
      partId: 'p1',
      params: [{ name: 'size', type: 'number', value: 20, default: 20 }],
      statements: [makeStmt({ id: 'st_p1_1', op: 'box', args: { size: { $param: 'size' } } })],
    }
    const code = scriptToCode(script)
    const { script: parsed } = parseScript(code, { partId: 'p1' })
    expect(parsed.params).toHaveLength(1)
    expect(parsed.params[0].name).toBe('size')
    expect(parsed.params[0].value).toBe(20)
    expect(parsed.statements[0].args.size).toEqual({ $param: 'size' })
  })

  it('带 boolean op 往返', () => {
    const script: PartScript = {
      partId: 'p1',
      params: [],
      statements: [
        makeStmt({ id: 's0', op: 'box', args: { size: 20 } }),
        makeStmt({ id: 's1', op: 'sphere', args: { radius: 10 } }),
        makeStmt({
          id: 's2',
          op: 'boolean',
          args: { operation: 'union', sourcePartIds: ['s0', 's1'] },
          inputs: ['s0', 's1'],
          feature: { kind: 'boolean', label: '合并', createdBy: 'user' },
        }),
      ],
    }
    const code = scriptToCode(script)
    const { script: parsed } = parseScript(code, { partId: 'p1' })
    expect(parsed.statements).toHaveLength(3)
    expect(parsed.statements[2].op).toBe('boolean')
    expect(parsed.statements[2].args.operation).toBe('union')
    expect(parsed.statements[2].inputs).toEqual([
      parsed.statements[0].id,
      parsed.statements[1].id,
    ])
  })
})

// ── 多 mesh：split 解构 / 多终端 return ──

describe('parser: split 解构', () => {
  it('解析 const { front: part1_v0, back: part2_v0 } = await cad.split(...)', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  const { front: part1_v0, back: part2_v0 } = await cad.split(part0_v0, { normal:[0,0,1], offset:0 })
  return [ { shape: part1_v0 }, { shape: part2_v0 } ]
}`
    const { script, varToId } = parseScript(code)
    expect(script.statements).toHaveLength(2)
    // 第二条语句是 split，有 outputs
    const splitStmt = script.statements[1]
    expect(splitStmt.op).toBe('split')
    expect(splitStmt.outputs).toEqual(['part1_v0', 'part2_v0'])
    expect(splitStmt.inputs).toEqual(['part0_v0'])
    // 变量名 → id 映射
    expect(varToId.get('part1_v0')).toBe('part1_v0')
    expect(varToId.get('part2_v0')).toBe('part2_v0')
  })

  it('split 解构只允许 front 和 back 两个键', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  const { front: part1_v0, left: part2_v0 } = await cad.split(part0_v0, { normal:[0,0,1], offset:0 })
  return [ { shape: part1_v0 }, { shape: part2_v0 } ]
}`
    expect(() => parseScript(code)).toThrow(/only allows "front" and "back"/)
  })

  it('split 解构必须恰好两个属性', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  const { front: part1_v0 } = await cad.split(part0_v0, { normal:[0,0,1], offset:0 })
  return { shape: part1_v0 }
}`
    expect(() => parseScript(code)).toThrow(/exactly 2 properties/)
  })

  it('解构只允许 cad.split（不允许其他 op）', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  const { front: part1_v0, back: part2_v0 } = await cad.drill(part0_v0, { diameter:5, depth:0 })
  return [ { shape: part1_v0 }, { shape: part2_v0 } ]
}`
    expect(() => parseScript(code)).toThrow(/only allowed for cad\.split/)
  })
})

describe('parser: 多终端 return 数组', () => {
  it('解析 return [ { shape, meta }, { shape, meta } ]', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  const { front: part1_v0, back: part2_v0 } = await cad.split(part0_v0, { normal:[0,0,1], offset:0 })
  return [
    { shape: part1_v0, name: 'Front', color: '#FF0000' },
    { shape: part2_v0, name: 'Back' }
  ]
}`
    const { script } = parseScript(code)
    expect(script.terminalShapes).toBeDefined()
    expect(script.terminalShapes).toHaveLength(2)
    expect(script.terminalShapes![0].id).toBe('part1_v0')
    expect(script.terminalShapes![0].meta?.name).toBe('Front')
    expect(script.terminalShapes![0].meta?.appearance?.color).toBe('#FF0000')
    expect(script.terminalShapes![1].id).toBe('part2_v0')
    expect(script.terminalShapes![1].meta?.name).toBe('Back')
  })

  it('单元素数组等价为单终端', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  return [ { shape: part0_v0, name: 'Solo' } ]
}`
    const { script } = parseScript(code)
    // 单元素数组 → terminalShapes 为 undefined，用 meta 代替
    expect(script.terminalShapes).toBeUndefined()
    expect(script.meta?.name).toBe('Solo')
  })

  it('空数组 → ParseError', () => {
    const code = `export default async (cad) => {
  const part0_v0 = cad.box({ size: 20 })
  return []
}`
    expect(() => parseScript(code)).toThrow(/at least one element/)
  })
})

describe('parser: 多 mesh 往返 codegen → parser', () => {
  it('split 解构多终端往返', () => {
    const script: PartScript = {
      partId: 'p1',
      params: [],
      statements: [
        makeStmt({ id: 'st_p1_0', op: 'box', args: { size: 20 } }),
        makeStmt({
          id: 'st_p1_1',
          op: 'split',
          args: {
            cutMode: 'plane',
            normal: [0, 0, 1],
            offset: 5,
            inPlaneAngleDeg: 0,
            side: 'front',
          },
          inputs: ['st_p1_0'],
          feature: { kind: 'split', label: 'split', createdBy: 'user' },
          outputs: ['part1_v0', 'part2_v0'],
        }),
      ],
      terminalShapes: [
        { id: 'part1_v0', meta: { name: 'Front' } },
        { id: 'part2_v0', meta: { name: 'Back' } },
      ],
    }
    const code = scriptToCode(script)
    const { script: parsed } = parseScript(code, { partId: 'p1' })
    // 验证 split 语句
    expect(parsed.statements).toHaveLength(2)
    expect(parsed.statements[1].op).toBe('split')
    expect(parsed.statements[1].outputs).toEqual(['part1_v0', 'part2_v0'])
    // 验证多终端
    expect(parsed.terminalShapes).toBeDefined()
    expect(parsed.terminalShapes).toHaveLength(2)
    expect(parsed.terminalShapes![0].id).toBe('part1_v0')
    expect(parsed.terminalShapes![0].meta?.name).toBe('Front')
    expect(parsed.terminalShapes![1].id).toBe('part2_v0')
    expect(parsed.terminalShapes![1].meta?.name).toBe('Back')
  })
})

describe('parser: load 旧 op 名兼容', () => {
  it('解析 cad.loadFile({ path, format }) → 映射为 load', () => {
    const code = `export default async (cad) => {
  const part0_v0 = await cad.loadFile({ path: '/Users/me/models/bracket.step', format: 'step' })
  return { shape: part0_v0 }
}`
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(1)
    expect(script.statements[0].op).toBe('load')
    expect(script.statements[0].args.path).toBe('/Users/me/models/bracket.step')
    expect(script.statements[0].args.format).toBe('step')
    expect(script.statements[0].feature.kind).toBe('load')
  })

  it('解析 cad.loadUrl({ url, format }) → 映射为 load', () => {
    const code = `export default async (cad) => {
  const part0_v0 = await cad.loadUrl({ url: 'https://cdn.example.com/bracket.glb', format: 'glb' })
  return { shape: part0_v0 }
}`
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(1)
    expect(script.statements[0].op).toBe('load')
    expect(script.statements[0].args.url).toBe('https://cdn.example.com/bracket.glb')
    expect(script.statements[0].args.format).toBe('glb')
    expect(script.statements[0].feature.kind).toBe('load')
  })

  it('解析 cad.loadByKey({ key, format }) → 映射为 load', () => {
    const code = `export default async (cad) => {
  const part0_v0 = await cad.loadByKey({ key: 'f3a9c1', format: 'step' })
  return { shape: part0_v0 }
}`
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(1)
    expect(script.statements[0].op).toBe('load')
    expect(script.statements[0].args.key).toBe('f3a9c1')
    expect(script.statements[0].args.format).toBe('step')
    expect(script.statements[0].feature.kind).toBe('load')
  })

  it('旧 cad.load({ fileRef }) → fileRef 转为 key', () => {
    const code = `export default async (cad) => {
  const part0_v0 = await cad.load({ fileRef: 'box_boss.glb' })
  return { shape: part0_v0 }
}`
    const { script } = parseScript(code)
    expect(script.statements).toHaveLength(1)
    expect(script.statements[0].op).toBe('load')
    expect(script.statements[0].args.key).toBe('box_boss.glb')
    expect(script.statements[0].args.fileRef).toBeUndefined()
    expect(script.statements[0].feature.kind).toBe('load')
  })

  it('往返：codegen load({ key }) → parser → 相同语义', () => {
    const origScript: PartScript = {
      partId: 'p1',
      params: [],
      statements: [{
        id: 'part0_v0',
        op: 'load',
        args: { key: 'f3a9c1', format: 'step' },
        inputs: [],
        feature: { kind: 'load', label: '导入文件', createdBy: 'user' },
      }],
    }
    const code = scriptToCode(origScript)
    const { script: parsed } = parseScript(code)
    expect(parsed.statements[0].op).toBe('load')
    expect(parsed.statements[0].args.key).toBe('f3a9c1')
    expect(parsed.statements[0].args.format).toBe('step')
  })
})
