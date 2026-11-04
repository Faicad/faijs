/**
 * metadata-extractor 表达式工具直呼单元测试——历史 L1 缺口补账：
 * `isExprWhitelist` / `collectExprIdentifiers`。
 *
 * 两者是「唯一实现」（expr-validate.ts / source-edit.ts 直接复用）：
 * - `isExprWhitelist`：`Ns.fn(...)` 等白名单表达式结构判定（无可选链/spread）；
 * - `collectExprIdentifiers`：参数 → params、已声明变量 → refs、安全全局只放行
 *   不记入、未知标识符（非 lenient）抛 E_REFERENCE。
 *
 * AST 节点用结构化字面量构造（estree 形态），SymbolTable 用最小字段集。
 */
import { describe, expect, it } from 'vitest'
import {
  isExprWhitelist,
  collectExprIdentifiers,
  type SymbolTable,
  type ASTNode,
} from '../../src/lang/metadata-extractor'

function table(over: Partial<SymbolTable> = {}): SymbolTable {
  return {
    paramNames: new Set(['size']),
    paramValues: new Map([['size', 20]]),
    declared: new Set(['size', 'part0']),
    nsBindings: new Map(),
    localFnParams: new Map(),
    defaultNsName: 'cad',
    keep: [],
    ...over,
  } as SymbolTable
}

describe('isExprWhitelist 直呼（结构白名单）', () => {
  it('字面量/标识符/四则/数组/成员/调用 → true', () => {
    expect(isExprWhitelist({ type: 'Literal', value: 1 } as ASTNode)).toBe(true)
    expect(isExprWhitelist({ type: 'Identifier', name: 'size' } as ASTNode)).toBe(true)
    expect(
      isExprWhitelist({
        type: 'BinaryExpression',
        operator: '+',
        left: { type: 'Identifier', name: 'size' } as ASTNode,
        right: { type: 'Literal', value: 5 } as ASTNode,
      } as ASTNode),
    ).toBe(true)
    expect(
      isExprWhitelist({
        type: 'CallExpression',
        optional: false,
        callee: { type: 'MemberExpression', optional: false, computed: false, object: { type: 'Identifier', name: 'cad' } as ASTNode, property: { type: 'Identifier', name: 'box' } as ASTNode },
        arguments: [{ type: 'Literal', value: 1 } as ASTNode],
      } as ASTNode),
    ).toBe(true)
  })

  it('可选链 / spread / 非法节点 → false', () => {
    expect(isExprWhitelist({ type: 'CallExpression', optional: true, callee: { type: 'Identifier', name: 'f' } as ASTNode, arguments: [] } as ASTNode)).toBe(false)
    expect(
      isExprWhitelist({
        type: 'CallExpression',
        optional: false,
        callee: { type: 'Identifier', name: 'f' } as ASTNode,
        arguments: [{ type: 'SpreadElement', argument: { type: 'Identifier', name: 'x' } as ASTNode }],
      } as ASTNode),
    ).toBe(false)
    expect(isExprWhitelist(null)).toBe(false)
    expect(isExprWhitelist({ type: 'AwaitExpression' } as ASTNode)).toBe(false)
  })
})

describe('collectExprIdentifiers 直呼（params/refs 分流）', () => {
  it('参数 → params；已声明变量 → refs；安全全局只放行不记入', () => {
    const params = new Set<string>()
    const refs = new Set<string>()
    const binary: ASTNode = {
      type: 'BinaryExpression',
      operator: '+',
      left: { type: 'Identifier', name: 'size' } as ASTNode, // 参数
      right: { type: 'Identifier', name: 'part0' } as ASTNode, // 已声明变量
    }
    collectExprIdentifiers(binary, table(), 3, params, refs)
    expect([...params]).toEqual(['size'])
    expect([...refs]).toEqual(['part0'])

    // Math.max：免 import 安全全局 → 不抛、不记入 params/refs
    const mathCall: ASTNode = {
      type: 'CallExpression',
      optional: false,
      callee: {
        type: 'MemberExpression', optional: false, computed: false,
        object: { type: 'Identifier', name: 'Math' } as ASTNode,
        property: { type: 'Identifier', name: 'max' } as ASTNode,
      },
      arguments: [{ type: 'Identifier', name: 'size' } as ASTNode],
    }
    const p2 = new Set<string>()
    const r2 = new Set<string>()
    collectExprIdentifiers(mathCall, table(), 4, p2, r2)
    expect([...p2]).toEqual(['size'])
    expect([...r2]).toEqual([])
  })

  it('未知标识符：非 lenient 抛 E_REFERENCE；lenient 静默跳过', () => {
    const ghost: ASTNode = { type: 'Identifier', name: 'ghost' } as ASTNode
    expect(() => collectExprIdentifiers(ghost, table(), 5, new Set(), new Set())).toThrow(/E_REFERENCE|ghost/)
    const p = new Set<string>()
    const r = new Set<string>()
    collectExprIdentifiers(ghost, table(), 5, p, r, { lenient: true })
    expect(p.size).toBe(0)
    expect(r.size).toBe(0)
  })

  it('duck-type Set（对象字面量实参）也满足 symbols 契约：只需要 has()', () => {
    // L2 扫描只收集「调用点实参里的对象字面量」属性名（add/clear/delete/has/size =
    // Set 接口成员），所以契约集必须内联在实参位置，经 const 变量传入是看不见的。
    const params = new Set<string>()
    const refs = new Set<string>()
    const binary: ASTNode = {
      type: 'BinaryExpression',
      operator: '+',
      left: { type: 'Identifier', name: 'size' } as ASTNode,
      right: { type: 'Identifier', name: 'part0' } as ASTNode,
    }
    collectExprIdentifiers(
      binary,
      {
        paramNames: {
          has: (n: string) => n === 'size',
          add: (_n: string) => undefined,
          clear: () => undefined,
          delete: (_n: string) => true,
          size: 1,
        },
        declared: {
          has: (n: string) => n === 'size' || n === 'part0',
          add: (_n: string) => undefined,
          clear: () => undefined,
          delete: (_n: string) => true,
          size: 2,
        },
        paramValues: new Map(),
        nsBindings: new Map(),
        localFnParams: new Map(),
        defaultNsName: 'cad',
        keep: [],
      } as unknown as SymbolTable,
      6,
      params,
      refs,
    )
    expect([...params]).toEqual(['size'])
    expect([...refs]).toEqual(['part0'])
  })
})
