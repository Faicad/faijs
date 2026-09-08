/**
 * source-edit.test.ts — editArgSource（P0-D；plans 2026-09-08 … §7 faijs 6）
 *
 * 纯函数契约：
 * - 正常替换返回新全文（原样保留其余代码，入参不被修改）；
 * - stmtId+path 无匹配 → E_SLOT_NOT_FOUND；
 * - 偏移量为防御性不变量（编辑每次对当前 code 重新提取，编辑总是落在当前文本）；
 * - 新文本语法错 → E_SYNTAX；引用未声明 → E_REFERENCE；非白名单 → E_VALUE；
 * - 原脚本含坏表达式（如 Math.max）→ E_PARSE（整体不可编辑信号）；
 * - 连续两次编辑同一槽，第二次基于第一次结果重新提取。
 */

import { describe, it, expect } from 'vitest'
import { editArgSource } from './source-edit'
import { extractMetadata } from './metadata-extractor'
import { asStmtId } from '../identity'

const CODE = [
  'const size = 20',
  'const half = size / 2',
  'let d0 = cad.box(size, half, size * 2, { empty: true })',
].join('\n')

function rhsOf(code: string = CODE) {
  return extractMetadata(code).argSources.find((s) => s.path === 'rhs')
}

describe('editArgSource: 正常替换', () => {
  it('替换参数行 rhs（字面量 → 表达式），其余代码原样保留、入参不变', () => {
    const meta = extractMetadata(CODE)
    const s = meta.argSources.find((x) => x.path === 'rhs' && x.stmtId === asStmtId('s1'))
    expect(s?.text).toBe('20')
    const r = editArgSource(CODE, s!.stmtId, s!.path, 'size * 2.5')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toBe(
      'const size = size * 2.5\nconst half = size / 2\nlet d0 = cad.box(size, half, size * 2, { empty: true })',
    )
    // 纯函数：入参数组原样
    expect(CODE).toBe(
      'const size = 20\nconst half = size / 2\nlet d0 = cad.box(size, half, size * 2, { empty: true })',
    )
  })

  it('替换 op 参数槽（positional[1]）', () => {
    const s = extractMetadata(CODE).argSources.find((x) => x.path === 'positional[1]')
    expect(s?.text).toBe('half')
    const r = editArgSource(CODE, s!.stmtId, s!.path, 'half * 1.25')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toContain('cad.box(size, half * 1.25, size * 2,')
  })

  it('编辑 args 参数槽（尾随对象属性）只改该槽且可再提取', () => {
    const meta = extractMetadata(CODE)
    const s = meta.argSources.find((x) => x.path === 'args.empty')
    expect(s?.text).toBe('true')
    const r = editArgSource(CODE, s!.stmtId, s!.path, 'size > 8')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toContain('{ empty: size > 8 }')
    const m2 = extractMetadata(r.value)
    expect(m2.argSources.find((x) => x.path === 'args.empty')?.text).toBe('size > 8')
  })
})

describe('editArgSource: 拒绝路径', () => {
  it('stmtId+path 无匹配 → E_SLOT_NOT_FOUND', () => {
    const r = editArgSource(CODE, asStmtId('s99'), 'args.size', '1')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('E_SLOT_NOT_FOUND')
  })

  it('新文本语法错 → E_SYNTAX', () => {
    const s = rhsOf()
    const r = editArgSource(CODE, s!.stmtId, s!.path, 'size *')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('E_SYNTAX')
  })

  it('新文本引用未声明 → E_REFERENCE', () => {
    const s = rhsOf()
    const r = editArgSource(CODE, s!.stmtId, s!.path, 'zzz + 1')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('E_REFERENCE')
  })

  it('新文本非白名单节点 → E_VALUE', () => {
    const s = rhsOf()
    const r = editArgSource(CODE, s!.stmtId, s!.path, '() => size')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('E_VALUE')
  })

  it('原脚本坏表达式（参数槽内 Math.max 未声明）→ E_PARSE（整体不可编辑降级）', () => {
    // Math.max 出现在 op 参数槽内 → 提取即抛（UI 与执行同源）；编辑面对整体 E_PARSE
    const bad = 'const x = 20\nlet p = cad.box(Math.max(x, 20), 1, 1)'
    const r = editArgSource(bad, asStmtId('s1'), 'rhs', '30')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('E_PARSE')
  })

  it('连续两次编辑同一槽（第二次基于第一次结果重新提取）', () => {
    const first = rhsOf(CODE)
    const r1 = editArgSource(CODE, first!.stmtId, first!.path, 'size + 2')
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const m2 = extractMetadata(r1.value)
    const s2 = m2.argSources.find((x) => x.path === 'rhs' && x.stmtId === first!.stmtId)
    expect(s2?.text).toBe('size + 2')
    const r2 = editArgSource(r1.value, first!.stmtId, 'rhs', 'size * 3')
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.value).toBe(
      'const size = size * 3\nconst half = size / 2\nlet d0 = cad.box(size, half, size * 2, { empty: true })',
    )
  })
})

describe('editArgSource: 防御性不变量', () => {
  it('偏移断言为防御守卫：每次编辑基于当前 code 重新提取（编辑总是落在当前文本）', () => {
    // 用户已把 size 改成 99（同一 stmtId/path），再提交编辑 → 落当前文本
    const changed = 'const size = 99\nconst half = size / 2\nlet d0 = cad.box(size, half, size)'
    const s = rhsOf(changed)
    const r = editArgSource(changed, s!.stmtId, s!.path, '50')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toContain('const size = 50')
  })

  it('编辑结果可重提取、往返一致（rhs / positional / args）', () => {
    for (const path of ['rhs', 'positional[1]', 'args.empty']) {
      const meta = extractMetadata(CODE)
      const s = meta.argSources.find((x) => x.path === path)
      const r = editArgSource(CODE, s!.stmtId, s!.path, 'size + 0.5')
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      const m2 = extractMetadata(r.value) // 不抛 = 可提取
      expect(m2.argSources.find((x) => x.path === path)?.text).toBe('size + 0.5')
    }
  })
})