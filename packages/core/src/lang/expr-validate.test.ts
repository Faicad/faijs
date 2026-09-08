/**
 * expr-validate.test — P0-C（plans/2026-09-08-timeline-param-expression-editing.md §7 faijs 5）
 *
 * validateExpression：合法表达式 ok；未知标识符 E_REFERENCE；非白名单节点 E_VALUE；
 * 语法错 E_SYNTAX；命名空间成员表达式（cfg.OUTX / cfg.fn(w)）通过。
 */

import { describe, it, expect } from 'vitest'
import { validateExpression } from './expr-validate'

const NAMES = ['w', 'h', 'cfg', 'part0']

describe('validateExpression: 合法表达式', () => {
  it('算术 / 比较 / 逻辑 / 三元 / 括号 / 多行 / 空白均通过', () => {
    const okCases = [
      'w * 2',
      'w / h + 1',
      'w > 10 ? 20 : 30',
      'w || 15',
      '!w',
      '-w',
      '(w + h) * 2',
    ]
    for (const t of okCases) {
      const r = validateExpression({ text: t, knownNames: NAMES })
      expect(r).toEqual({ ok: true })
    }
    expect(validateExpression({ text: 'w +\n 2', knownNames: NAMES })).toEqual({ ok: true })
  })

  it('数组字面量 / 成员访问', () => {
    expect(validateExpression({ text: '[w, 2, 3]', knownNames: NAMES })).toEqual({ ok: true })
    expect(validateExpression({ text: 'cfg.OUTX', knownNames: NAMES })).toEqual({ ok: true })
    expect(validateExpression({ text: 'cfg.max(w, 20)', knownNames: NAMES })).toEqual({ ok: true })
  })

  it('text 为空 → E_SYNTAX', () => {
    expect(validateExpression({ text: '', knownNames: NAMES }).ok).toBe(false)
  })
})

describe('validateExpression: 判定驳回', () => {
  it('未知标识符 → E_REFERENCE', () => {
    const r = validateExpression({ text: 'zzz + 1', knownNames: NAMES })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('E_REFERENCE')
  })

  it('非白名单节点 → E_VALUE（可选链 / 模板 / 序列 / 箭头函数 / new）', () => {
    // 注：`w ** 2` 命中 BinaryExpression 白名单（合法表达式，不在此列）
    for (const t of ['a?.b', '`w-${w}`', 'w, h', '() => w', 'new Number(w)']) {
      const r = validateExpression({ text: t, knownNames: NAMES })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('E_VALUE')
    }
  })

  it('语法错误 → E_SYNTAX（acorn）', () => {
    for (const t of ['w *', '(w', 'w,,', 'w 2']) {
      const r = validateExpression({ text: t, knownNames: NAMES })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('E_SYNTAX')
    }
  })

  it('knownNames 缺省（host 未取 meta.names 时按空集处理）→ 全部 E_REFERENCE', () => {
    const r = validateExpression({ text: 'w', knownNames: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('E_REFERENCE')
  })
})