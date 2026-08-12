import { describe, it, expect } from 'vitest'
import { parseParamDefs, defaultParamValues, boxToTuple, tupleToBox } from './types'

describe('parseParamDefs', () => {
  it('新格式: name default label — 完整形式', () => {
    const code = `// @param radius 10 半径`
    const defs = parseParamDefs(code)
    expect(defs).toHaveLength(1)
    expect(defs[0]).toEqual({
      name: 'radius', label: '半径', default: 10,
    })
    // type 默认 number
    expect(defs[0].type).toBeUndefined()
  })

  it('新格式: name default — 无 label 无 type', () => {
    const code = `// @param radius 10`
    const defs = parseParamDefs(code)
    expect(defs).toHaveLength(1)
    expect(defs[0]).toEqual({
      name: 'radius', label: 'radius', default: 10,
    })
    expect(defs[0].type).toBeUndefined()
  })

  it('新格式: name default label type — 显式指定 int', () => {
    const code = `// @param count 8 数量 int`
    const defs = parseParamDefs(code)
    expect(defs).toHaveLength(1)
    expect(defs[0]).toEqual({
      name: 'count', label: '数量', type: 'int', default: 8,
    })
  })

  it('新格式: name default type — 无 label 显式指定 int', () => {
    const code = `// @param maxIter 20 int`
    const defs = parseParamDefs(code)
    expect(defs).toHaveLength(1)
    expect(defs[0]).toEqual({
      name: 'maxIter', label: 'maxIter', type: 'int', default: 20,
    })
  })

  it('忽略无效类型（非 number/int 的第 4 个 token）', () => {
    const code = `// @param foo 10 标签 string`
    const defs = parseParamDefs(code)
    // 新格式下 type 是可选字段，string 被忽略，label 和 default 仍有效
    expect(defs).toHaveLength(1)
    expect(defs[0].type).toBeUndefined()
    expect(defs[0].name).toBe('foo')
    expect(defs[0].label).toBe('标签')
    expect(defs[0].default).toBe(10)
  })

  it('忽略非 @param 注释', () => {
    const code = `// 普通注释
// @param radius 5 半径
/* 块注释 */`
    const defs = parseParamDefs(code)
    expect(defs).toHaveLength(1)
    expect(defs[0].name).toBe('radius')
  })

  it('空代码返回空数组', () => {
    expect(parseParamDefs('')).toHaveLength(0)
    expect(parseParamDefs('function sdf(x,y,z) { return 1 }')).toHaveLength(0)
  })

  it('处理缩进的 @param', () => {
    const code = `  // @param x 1 值`
    const defs = parseParamDefs(code)
    expect(defs).toHaveLength(1)
    expect(defs[0].name).toBe('x')
  })

  it('忽略 default 非数字的行', () => {
    const code = `// @param foo 标签 值 number`
    const defs = parseParamDefs(code)
    expect(defs).toHaveLength(0)
  })

  it('不足 2 个 token 的行被忽略', () => {
    const code = `// @param radius`
    const defs = parseParamDefs(code)
    expect(defs).toHaveLength(0)
  })
})

describe('defaultParamValues', () => {
  it('从参数定义生成默认值表', () => {
    const code = `// @param radius 10 半径
// @param count 8 数量 int`
    const defs = parseParamDefs(code)
    const vals = defaultParamValues(defs)
    expect(vals).toEqual({ radius: 10, count: 8 })
  })
})

describe('boxToTuple / tupleToBox', () => {
  it('双向转换', () => {
    const box = { min: [-1, -2, -3] as [number, number, number], max: [4, 5, 6] as [number, number, number] }
    const tuple = boxToTuple(box)
    expect(tuple).toEqual([-1, -2, -3, 4, 5, 6])
    const back = tupleToBox(tuple)
    expect(back).toEqual(box)
  })
})
