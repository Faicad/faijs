/**
 * arg-sources.test — P0-A / P0-B（plans/2026-09-08-timeline-param-expression-editing.md §7 faijs 1–4）
 *
 * - argSources：字面量 / 参数引用 / 表达式（折叠成败）/ 嵌套 call-ref / 数组元素 / 对象键槽；
 *   参数行 rhs 槽（字面量 / computed / 负字面量 / 一行多参）；偏移量（code.slice===text）全等。
 * - names：参数 ∪ 变量 ∪ 命名空间 ∪ 本机函数，词法序去重。
 */

import { describe, it, expect } from 'vitest'
import { extractMetadata } from './metadata-extractor'
import { asStmtId } from '../identity'

type Meta = ReturnType<typeof extractMetadata>

function slots(meta: Meta, stmtId: string, path: string) {
  return meta.argSources.filter((s) => s.stmtId === stmtId && s.path === path)
}

describe('extractMetadata: argSources（P0-A）', () => {
  it('折叠成功/失败、字面量/引用/表达式槽都有记录，且每个 code.slice(start, end) === text', () => {
    const code = [
      'const size = 20',
      'let r1 = cad.box(size, 2, size * 1, { centered: true })',
      'let r2 = cad.box(size, { offset: [5, 0, 0], label: size })',
    ].join('\n')
    const meta = extractMetadata(code)

    // 参数行 rhs 槽（字面量，isExpression=false）
    expect(slots(meta, asStmtId('s1'), 'rhs')[0]).toMatchObject({ text: '20', isExpression: false, params: [], refs: [] })

    // 引用槽（Identifier）
    const p0 = slots(meta, asStmtId('s2'), 'positional[0]')[0]
    expect(p0.text).toBe('size')
    expect(p0.isExpression).toBe(true)
    expect(p0.params).toEqual(['size'])

    // 折叠成立表达式仍保留原文（编辑的核心收益点）
    const fold = slots(meta, asStmtId('s2'), 'positional[2]')[0]
    expect(fold.text).toBe('size * 1')
    expect(fold.params).toEqual(['size'])

    // 尾随选项对象属性槽 + 数组元素槽
    expect(slots(meta, asStmtId('s3'), 'args.offset')[0].text).toBe('[5, 0, 0]')
    expect(slots(meta, asStmtId('s3'), 'args.offset[2]')[0].text).toBe('0')
    expect(slots(meta, asStmtId('s3'), 'args.label')[0].text).toBe('size')

    // 全等：区间切片必须与原文本一致
    for (const s of meta.argSources) {
      expect(s.start).toBeLessThan(s.end)
      expect(code.slice(s.start, s.end)).toBe(s.text)
    }
  })

  it('参数行 rhs 槽：字面量 / 负字面量 / computed / 一行多参各自独立', () => {
    const code = [
      'const w = 0.4, h = 2',
      'const offset = -5',
      'const d = w * 8',
      'let p0 = cad.box(d, w, { at: [0, h, offset] })',
    ].join('\n')
    const meta = extractMetadata(code)

    // 一行多参：两条 rhs 记录、各自区间与名称（path = rhs:<name>）
    const wRhs = slots(meta, asStmtId('s1'), 'rhs:w')[0]
    const hRhs = slots(meta, asStmtId('s1'), 'rhs:h')[0]
    expect(wRhs.text).toBe('0.4')
    expect(hRhs.text).toBe('2')
    expect(wRhs.start).not.toBe(hRhs.start)
    expect(code.slice(wRhs.start, wRhs.end)).toBe('0.4')
    expect(code.slice(hRhs.start, hRhs.end)).toBe('2')

    // 负字面量 rhs（与 -5 视作字面量同构，isExpression=false）
    const neg = slots(meta, asStmtId('s2'), 'rhs')[0]
    expect(neg.text).toBe('-5')
    expect(neg.isExpression).toBe(false)

    // computed 参数行 rhs：原文保存 + 依赖收集
    const dRhs = slots(meta, asStmtId('s3'), 'rhs')[0]
    expect(dRhs.text).toBe('w * 8')
    expect(dRhs.isExpression).toBe(true)
    expect(dRhs.params).toEqual(['w'])

    for (const s of meta.argSources) expect(code.slice(s.start, s.end)).toBe(s.text)
  })

  it('嵌套 call-ref 实参与嵌套对象路径按同规则编号', () => {
    const code = [
      'const w = 1',
      'const h = 2',
      'let p0 = cad.box(0.5, 0.5, 0.5)',
      'let p1 = cad.translate(cad.box(2), { offset: [w, 0, h], points: [{ x: w }] })',
    ].join('\n')
    const meta = extractMetadata(code)

    // 嵌套 call-ref 的实参按 [i] 继续编号
    const inner = slots(meta, asStmtId('s4'), 'positional[0][0]')[0]
    expect(inner).toBeDefined()
    expect(inner.text).toBe('2')

    // 嵌套对象属性值
    expect(slots(meta, asStmtId('s4'), 'args.points[0].x')[0]).toMatchObject({ text: 'w', params: ['w'] })
    expect(slots(meta, asStmtId('s4'), 'args.offset[2]')[0].text).toBe('h')
  })

  it('封装一致性：扁平无 import / 扁平带 import / 容器 / CRLF 各偏移归一正确', () => {
    const flat = 'const w = 1\nlet p0 = cad.box(w, 1)'
    const m1 = extractMetadata(flat)
    expect(m1.params[0].lineNo).toBe(1)
    for (const s of m1.argSources) expect(flat.slice(s.start, s.end)).toBe(s.text)

    const withImport = "import * as mech from 'gear'\nconst w = 1\nlet p0 = mech.fn(w, 2, { a: 1 })"
    const m2 = extractMetadata(withImport)
    const rhs2 = m2.argSources.find((s) => s.path === 'rhs')
    expect(rhs2?.stmtId).toBe(asStmtId('s2'))
    expect(rhs2?.text).toBe('1')
    for (const s of m2.argSources) expect(withImport.slice(s.start, s.end)).toBe(s.text)

    const container = 'export default async (cad) => {\n  const w = 1\n  let pw = cad.box(w, 1)\n}'
    const m3 = extractMetadata(container)
    expect(m3.params[0].lineNo).toBe(2)
    for (const s of m3.argSources) expect(container.slice(s.start, s.end)).toBe(s.text)

    const crlf = 'const w = 1\r\nlet p0 = cad.box(w, 1)\r\n'
    const m4 = extractMetadata(crlf)
    expect(m4.params[0].lineNo).toBe(1)
    for (const s of m4.argSources) expect(crlf.slice(s.start, s.end)).toBe(s.text)
  })
})

describe('extractMetadata: names（P0-B）', () => {
  it('参数 ∪ 变量 ∪ 命名空间 ∪ 本机函数，词法序去重', () => {
    const code = [
      "import * as mat from 'mat'",
      'function helper(x) { return x }',
      'const w = 0.4, h = 0.3',
      'let part0 = cad.box(w, h)',
      'let part1 = mat.dup(w, 1, { a: h })',
    ].join('\n')
    const meta = extractMetadata(code)
    expect(meta.names).toEqual(['h', 'helper', 'mat', 'part0', 'part1', 'w'])
  })

  it('names 可直接用作 validateExpression 的 knownNames', () => {
    const code = 'const w = 1\nconst d = w * 2\nlet p0 = cad.box(d)'
    const meta = extractMetadata(code)
    for (const n of ['w', 'd', 'p0']) expect(meta.names).toContain(n)
  })
})