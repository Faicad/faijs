/**
 * api/meta 单元测试：合并、Shape 方法挂载、Shape.meta 序列化。
 *
 * 设计文档 2026-10-05-meta §4.1/§4.4：元数据不是 op，是 Shape 实例方法
 * （`box1.setName('…')` 走 `asm1.solve()` 同款成员调用语句形态）；`meta` 字段
 * 随 Shape 走双链路（编辑器只读字段，不依赖方法）。
 */

import { describe, it, expect } from 'vitest'
import { mergeMeta, attachMetaMethods, type ShapeMeta } from '../../src/api/meta'
import type { Shape } from '../../src/mesh/types'

function fakeShape(meta?: ShapeMeta): Shape {
  return {
    positions: new Float32Array(9),
    indices: new Uint32Array(3),
    meta,
  }
}

describe('mergeMeta', () => {
  it('spec 中 undefined 字段不覆盖旧值', () => {
    const cur: ShapeMeta = { name: 'box1', description: 'base' }
    const merged = mergeMeta(cur, { partNumber: 'P-01', name: undefined })
    expect(merged).toEqual({ name: 'box1', description: 'base', partNumber: 'P-01' })
  })

  it('cur 为 undefined 时只取 spec', () => {
    expect(mergeMeta(undefined, { name: 'box1' })).toEqual({ name: 'box1' })
  })

  it('空串顶层字段 = 清除', () => {
    const merged = mergeMeta({ name: 'box1', description: 'base' }, { name: '' })
    expect(merged).toEqual({ description: 'base' })
  })

  it('metadata 键值子合并：保留未覆盖键，空串删除键', () => {
    const cur: ShapeMeta = { metadata: { a: '1', b: '2' } }
    const merged = mergeMeta(cur, { metadata: { b: '22', c: '3' } })
    expect(merged.metadata).toEqual({ a: '1', b: '22', c: '3' })
    const removed = mergeMeta(merged, { metadata: { a: '' } })
    expect(removed.metadata).toEqual({ b: '22', c: '3' })
  })

  it('返回新对象，不改传入对象', () => {
    const cur: ShapeMeta = { name: 'a' }
    const merged = mergeMeta(cur, { partNumber: 'x' })
    expect(cur).toEqual({ name: 'a' }) // 原对象不变
    expect(merged).not.toBe(cur)
  })
})

describe('attachMetaMethods（Shape 方法）', () => {
  it('挂载后 setName/setDescription/setPartNumber 可用并返回 this', () => {
    const s = attachMetaMethods(fakeShape())
    const ret = s.setName('box1')
    expect(ret).toBe(s)
    expect(ret.setDescription('a box').setPartNumber('P-01')).toBe(s)
    expect(s.meta).toEqual({ name: 'box1', description: 'a box', partNumber: 'P-01' })
  })

  it('setName 空串清除 name', () => {
    const s = attachMetaMethods(fakeShape({ name: 'box1' }))
    s.setName('')
    expect(s.meta).toEqual({})
  })

  it('setMetaField 写入/清除自定义键', () => {
    const s = attachMetaMethods(fakeShape())
    s.setMetaField('faijs:source', 'step')
    expect(s.meta).toEqual({ metadata: { 'faijs:source': 'step' } })
    s.setMetaField('faijs:source', '')
    expect(s.meta?.metadata).toEqual({})
  })

  it('getMeta：初始 undefined，设置后返回当前 meta（只读视图）', () => {
    const s = attachMetaMethods(fakeShape())
    expect(s.getMeta()).toBeUndefined()
    s.setName('box1')
    expect(s.getMeta()).toEqual({ name: 'box1' })
  })

  it('幂等：重复挂载不覆盖已挂方法', () => {
    const s = attachMetaMethods(fakeShape())
    const again = attachMetaMethods(s)
    expect(again).toBe(s)
    expect(again.setName('x')).toBe(s)
  })

  it('已有 meta 的 Shape（继承/导入）挂载后方法在其上合并', () => {
    const s = attachMetaMethods(fakeShape({ name: 'inherited', partNumber: 'P0' }))
    s.setDescription('new')
    expect(s.meta).toEqual({ name: 'inherited', partNumber: 'P0', description: 'new' })
  })

  it('meta 字段 JSON 可序列化（方法与构造函数不被序列化）', () => {
    const s = attachMetaMethods(fakeShape())
    s.setName('box1').setPartNumber('P-01')
    const wrapped = JSON.parse(JSON.stringify(s))
    expect(wrapped.meta).toEqual({ name: 'box1', partNumber: 'P-01' })
    expect(JSON.stringify(s)).not.toContain('setName') // 方法不序列化
    expect(typeof (s as unknown as { setName?: unknown }).setName).toBe('function')
  })
})