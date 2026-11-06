/**
 * PmiTechNote（第 7 种 PMI）—— 零件级技术要求编号条目块。
 *
 * 钉住的核心契约：
 * 1. `techNote()` 工厂只补 kind；结构字段（title / category / items / subItems）
 *    JSON 往返不丢。
 * 2. 它**没有 target**，与「无目标的 note」同属全局注释块：查询不过滤出错、
 *    渲染进 `globalNoteTexts`，不参与视图归属。
 * 3. `category` 是分类标签、不进显示文本；文本只呈现图面上印得出的字。
 *
 * 设计文档：docs/plans/2026-10-31-faijs-pmi-thread-and-technotes-design.md §7
 */

import { describe, it, expect } from 'vitest'
import { solid, type SolidShape } from '../../../src/shape'
import { techNote, type PmiTechNote, type PmiItemKind, type PmiSetMeta } from '../../../src/api/pmi/types'
import { pmiItems, pmiTechNotes, pmiOn } from '../../../src/api/pmi/query'
import { formatTechNote, techNoteLines } from '../../../src/api/pmi/tech-note'
import { globalNoteTexts } from '../../../src/api/view/pmi-layer'
import SYMBOL_TABLE from '../../../src/lang/symbol-table.generated'
import type { FaceTopoRef } from '../../../src/topology/naming/types'

function makeShape(): SolidShape {
  return solid({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  })
}

function draftingNotes(): PmiTechNote {
  return techNote({
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

describe('PmiTechNote — 第 7 种 PMI', () => {
  it('工厂只补 kind，结构与可选字段原样保留', () => {
    const item = draftingNotes()
    expect(item.kind).toBe('techNote')
    expect(item.title).toBe('技术要求')
    expect(item.category).toBe('general')
    expect(item.items).toHaveLength(2)
    expect(item.items[1]!.subItems).toEqual(['a) 外轮廓', 'b) 内孔口'])
  })

  it("'techNote' 进入 PmiItemKind 联合", () => {
    const kind: PmiItemKind = 'techNote'
    expect(kind).toBe('techNote')
  })

  it('JSON 往返不丢编号与子项', () => {
    const round = JSON.parse(JSON.stringify(draftingNotes())) as PmiTechNote
    expect(round).toEqual(draftingNotes())
  })

  it('addTechNote 可链式挂载，pmiTechNotes / pmiItems 都查得到', () => {
    const s = makeShape()
    const ret = s.addTechNote(draftingNotes())
    expect(ret).toBe(s)
    expect(pmiTechNotes(s)).toHaveLength(1)
    expect(pmiTechNotes(s)[0]!.items[0]!.text).toBe('未注倒角 C0.3')
    expect(pmiItems(s, { kind: 'techNote' })).toHaveLength(1)
  })

  it('无 target：pmiOn / targetType 过滤都走空目标分支，不抛错', () => {
    const s = makeShape()
    s.addTechNote(draftingNotes())
    s.addNote({ text: '单条自由文本', target: someFace })
    expect(pmiOn(s, someFace)).toHaveLength(1) // 只命中带 target 的 note
    expect(pmiItems(s, { targetType: 'face' })).toHaveLength(1)
  })

  it('PmiSetMeta.source 允许 drawing（图纸流水线来源）', () => {
    const meta: PmiSetMeta = { source: 'drawing', standard: 'GB' }
    expect(meta.source).toBe('drawing')
  })
})

describe('formatTechNote / techNoteLines', () => {
  it('标题 + 编号条目 + 子项逐行展开', () => {
    expect(techNoteLines(draftingNotes())).toEqual([
      '技术要求',
      '1. 未注倒角 C0.3',
      '2. 锐边倒钝',
      '   a) 外轮廓',
      '   b) 内孔口',
    ])
  })

  it('formatTechNote 用换行连接', () => {
    expect(formatTechNote(draftingNotes())).toBe(
      '技术要求\n1. 未注倒角 C0.3\n2. 锐边倒钝\n   a) 外轮廓\n   b) 内孔口',
    )
  })

  it('无标题时不产生空行；category 不进文本', () => {
    const item = techNote({
      category: 'inspection',
      items: [{ index: 1, text: '未注公差按 GB/T 1804-m' }],
    })
    expect(techNoteLines(item)).toEqual(['1. 未注公差按 GB/T 1804-m'])
    expect(formatTechNote(item)).not.toContain('inspection')
  })
})

describe('渲染层全局注释块', () => {
  it('techNote 与无目标 note 一起进 globalNoteTexts', () => {
    const s = makeShape()
    s.addNote({ text: '材料 45 钢' })
    s.addNote({ text: '有目标的注释', target: someFace })
    s.addTechNote(draftingNotes())
    expect(globalNoteTexts(s)).toEqual([
      '材料 45 钢',
      '技术要求',
      '1. 未注倒角 C0.3',
      '2. 锐边倒钝',
      '   a) 外轮廓',
      '   b) 内孔口',
    ])
  })
})

describe('cad 命名空间与符号表', () => {
  it('pmiTechNotes / formatTechNote / faceBySelector 进符号表', () => {
    expect(SYMBOL_TABLE).toHaveProperty('pmiTechNotes')
    expect(SYMBOL_TABLE).toHaveProperty('formatTechNote')
    expect(SYMBOL_TABLE).toHaveProperty('faceBySelector')
  })
})
