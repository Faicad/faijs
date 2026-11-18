/**
 * PmiGeneralNote / PmiLocalNote —— 通用注释与局部注释（ASME Y14.100 §4.26）。
 *
 * 钉住的核心契约：
 * 1. 分轴是**适用范围**：`generalNote` 无落点（整张图 / 整个零件），
 *    `localNote` 必有落点（`target` 或 `anchor`），缺落点构造即抛错。
 * 2. `generalNote.items` 一条 = 单条无编号注释（不臆造序号），多条 = 编号块。
 * 3. `generalNoteTexts` 只收 `generalNote`；`localNote` 不进通用注释区。
 * 4. 旧 kind（`note` / `techNote`）读取时归一，写出只写新字面量。
 *
 * 设计文档：docs/plans/2026-10-31-faijs-pmi-thread-and-technotes-design.md §7
 */

import { describe, it, expect } from 'vitest'
import { solid, type SolidShape } from '../../../src/shape'
import {
  generalNote,
  localNote,
  type PmiGeneralNote,
  type PmiItemKind,
  type PmiSetMeta,
} from '../../../src/api/pmi/types'
import { pmiItems, pmiGeneralNotes, pmiOn } from '../../../src/api/pmi/query'
import { formatGeneralNote, generalNoteLines } from '../../../src/api/pmi/general-note'
import { migratePmiItem, migratePmiSet, normalizePmiKind } from '../../../src/api/pmi/kind-alias'
import { generalNoteTexts } from '../../../src/api/view/pmi-layer'
import SYMBOL_TABLE from '../../../src/lang/symbol-table.generated'
import type { FaceTopoRef } from '../../../src/topology/naming/types'

function makeShape(): SolidShape {
  return solid({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  })
}

function draftingNotes(): PmiGeneralNote {
  return generalNote({
    title: '技术要求',
    category: 'general',
    items: [
      { index: 1, text: '未注倒角 C0.3' },
      { index: 2, text: '锐边倒钝', subItems: ['a) 外轮廓', 'b) 内孔口'] },
    ],
  })
}

const someFace: FaceTopoRef = {
  kind: 'face',
  origin: 's1' as never,
  role: 'top',
  hint: { kind: 'face', surfaceType: 'plane', normal: [0, 0, 1] },
}

describe('PmiGeneralNote — 通用注释', () => {
  it('工厂只补 kind，结构与可选字段原样保留', () => {
    const item = draftingNotes()
    expect(item.kind).toBe('generalNote')
    expect(item.title).toBe('技术要求')
    expect(item.category).toBe('general')
    expect(item.items).toHaveLength(2)
    expect(item.items[1]!.subItems).toEqual(['a) 外轮廓', 'b) 内孔口'])
  })

  it("'generalNote' 进入 PmiItemKind 联合", () => {
    const kind: PmiItemKind = 'generalNote'
    expect(kind).toBe('generalNote')
  })

  it('JSON 往返不丢编号与子项', () => {
    const round = JSON.parse(JSON.stringify(draftingNotes())) as PmiGeneralNote
    expect(round).toEqual(draftingNotes())
  })

  it('单条无编号注释：index 缺省，渲染不带序号', () => {
    const single = generalNote({ items: [{ text: '锐边倒钝' }] })
    expect(generalNoteLines(single)).toEqual(['锐边倒钝'])
    expect(formatGeneralNote(single)).toBe('锐边倒钝')
  })

  it('addGeneralNote 可链式挂载，pmiGeneralNotes / pmiItems 都查得到', () => {
    const s = makeShape()
    const ret = s.addGeneralNote(draftingNotes())
    expect(ret).toBe(s)
    expect(pmiGeneralNotes(s)).toHaveLength(1)
    expect(pmiGeneralNotes(s)[0]!.items[0]!.text).toBe('未注倒角 C0.3')
    expect(pmiItems(s, { kind: 'generalNote' })).toHaveLength(1)
  })

  it('无落点：pmiOn / targetType 过滤都不命中，不抛错', () => {
    const s = makeShape()
    s.addGeneralNote(draftingNotes())
    s.addLocalNote({ text: '有落点的注释', target: someFace })
    expect(pmiOn(s, someFace)).toHaveLength(1) // 只命中 localNote
    expect(pmiItems(s, { targetType: 'face' })).toHaveLength(1)
  })

  it('PmiSetMeta.source 允许 drawing（图纸流水线来源）', () => {
    const meta: PmiSetMeta = { source: 'drawing', standard: 'GB' }
    expect(meta.source).toBe('drawing')
  })
})

describe('PmiLocalNote — 局部注释', () => {
  it('有 target 或 anchor 才叫局部注释', () => {
    expect(localNote({ text: '贴在面上', target: someFace }).kind).toBe('localNote')
    expect(localNote({ text: '贴在坐标上', anchor: [20, 20, 10] }).kind).toBe('localNote')
  })

  it('两者都缺 = 调用错误（那是 generalNote 的语义）', () => {
    expect(() => localNote({ text: '没有落点' })).toThrow(/target or an anchor/)
  })
})

describe('formatGeneralNote / generalNoteLines', () => {
  it('标题 + 编号条目 + 子项逐行展开', () => {
    expect(generalNoteLines(draftingNotes())).toEqual([
      '技术要求',
      '1. 未注倒角 C0.3',
      '2. 锐边倒钝',
      '   a) 外轮廓',
      '   b) 内孔口',
    ])
  })

  it('formatGeneralNote 用换行连接', () => {
    expect(formatGeneralNote(draftingNotes())).toBe(
      '技术要求\n1. 未注倒角 C0.3\n2. 锐边倒钝\n   a) 外轮廓\n   b) 内孔口',
    )
  })

  it('无标题时不产生空行；category 不进文本', () => {
    const item = generalNote({
      category: 'inspection',
      items: [{ index: 1, text: '未注公差按 GB/T 1804-m' }],
    })
    expect(generalNoteLines(item)).toEqual(['1. 未注公差按 GB/T 1804-m'])
    expect(formatGeneralNote(item)).not.toContain('inspection')
  })
})

describe('渲染层通用注释区', () => {
  it('只收 generalNote；localNote 一律不进', () => {
    const s = makeShape()
    s.addGeneralNote(generalNote({ items: [{ text: '材料 45 钢' }] }))
    s.addLocalNote({ text: '有落点的注释', target: someFace })
    s.addGeneralNote(draftingNotes())
    expect(generalNoteTexts(s)).toEqual([
      '材料 45 钢',
      '技术要求',
      '1. 未注倒角 C0.3',
      '2. 锐边倒钝',
      '   a) 外轮廓',
      '   b) 内孔口',
    ])
  })
})

describe('旧 kind 读取归一', () => {
  it('normalizePmiKind：note 的去向由有无落点决定', () => {
    expect(normalizePmiKind('note', true)).toBe('localNote')
    expect(normalizePmiKind('note', false)).toBe('generalNote')
    expect(normalizePmiKind('techNote', false)).toBe('generalNote')
    expect(normalizePmiKind('dimension', false)).toBe('dimension')
  })

  it('旧 note（无落点）→ generalNote，text 提进 items[0]', () => {
    expect(migratePmiItem({ kind: 'note', text: '未注公差按 GB/T 1804-m' })).toEqual({
      kind: 'generalNote',
      items: [{ text: '未注公差按 GB/T 1804-m' }],
    })
  })

  it('旧 note（有落点）→ localNote，字段原样保留', () => {
    const migrated = migratePmiItem({ kind: 'note', text: '贴面', target: someFace })
    expect(migrated).toEqual({ kind: 'localNote', text: '贴面', target: someFace })
  })

  it('旧 techNote → generalNote，items / title 原样保留', () => {
    const migrated = migratePmiItem({
      kind: 'techNote',
      title: '技术要求',
      items: [{ index: 1, text: '锐边倒钝' }],
    })
    expect(migrated).toEqual({
      kind: 'generalNote',
      title: '技术要求',
      items: [{ index: 1, text: '锐边倒钝' }],
    })
  })

  it('migratePmiSet 逐条归一，meta 不动', () => {
    const set = migratePmiSet({
      items: [
        { kind: 'note', text: 'a' },
        { kind: 'techNote', items: [{ index: 1, text: 'b' }] },
        { kind: 'dimension', dimType: 'linear' } as never,
      ],
      meta: { source: 'drawing' },
    })
    expect(set.items.map((i) => i.kind)).toEqual(['generalNote', 'generalNote', 'dimension'])
    expect(set.meta).toEqual({ source: 'drawing' })
  })
})

describe('cad 命名空间与符号表', () => {
  it('pmiGeneralNotes / formatGeneralNote / faceBySelector 进符号表', () => {
    expect(SYMBOL_TABLE).toHaveProperty('pmiGeneralNotes')
    expect(SYMBOL_TABLE).toHaveProperty('formatGeneralNote')
    expect(SYMBOL_TABLE).toHaveProperty('faceBySelector')
  })
})
