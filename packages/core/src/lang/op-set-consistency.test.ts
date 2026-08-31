/**
 * op-set-consistency — 符号表 ↔ stdlib 签名一致性守卫
 *
 * 阶段 1（§3.6）新增：符号表 ↔ stdlib 签名一致性守卫。
 * 阶段 4（§6.1）改造：SCHEMAS 框架删除后，schema↔codegen 键集一致性测试随之删除
 * （codegen 已是通用打印机：IR 里有什么打印什么，无 per-op 字段表可对照）。
 * keep-syntax P1（2026-08-28）改造：符号表只承载一个职责——check() 符号检查
 * 判定 callee 是否存在（"函数不存在"诊断），保留语义（readonlyPositions/
 * readonlyPaths）与 R5 混合签名反例测试随 ReadonlyShape 一并删除（设计 §4.1/§11）。
 *
 * 覆盖：
 * - 符号表键集合 == cad 命名空间函数集（与 internal-stdlib 装配一致）
 * - 未知函数（不在 cad 命名空间）→ undefined
 */

import { describe, it, expect } from 'vitest'
import { SYMBOL_TABLE, getFunctionSymbol } from './symbol-table'

/**
 * cad 命名空间函数集（与 src/cad-runtime/internal-stdlib.ts 的 createInternalStdlib
 * 装配键一致）。符号表应恰好覆盖此集合。
 */
const CAD_NAMESPACE_FUNCTIONS = new Set([
  'box', 'sphere', 'cylinder', 'cone', 'wedge',
  'text', 'screw', 'svgExtrude', 'sdf', 'load',
  'translate', 'rotate', 'scale',
  'drill', 'extrude', 'engrave', 'chamfer', 'knurl',
  'union', 'subtract', 'intersect',
  'split', 'group', 'assembly', 'copy',
  'faceCenter', 'faceNormal', 'bboxCenter', 'bboxMin', 'bboxMax',
  'asset',
])

describe('symbol-table-consistency: SYMBOL_TABLE ↔ cad namespace', () => {
  it('符号表键集合恰好等于 cad 命名空间函数集', () => {
    const tableKeys = new Set(Object.keys(SYMBOL_TABLE))
    // 双向一致：无缺失、无多余
    const missing = [...CAD_NAMESPACE_FUNCTIONS].filter((f) => !tableKeys.has(f))
    const extra = [...tableKeys].filter((f) => !CAD_NAMESPACE_FUNCTIONS.has(f))
    expect(missing).toEqual([])
    expect(extra).toEqual([])
  })

  it('每个 cad 命名空间函数在符号表中都有条目（供 check() 符号检查）', () => {
    for (const fn of CAD_NAMESPACE_FUNCTIONS) {
      expect(SYMBOL_TABLE[fn], `missing symbol for "${fn}"`).toBeDefined()
    }
  })

  it('P1 后符号表条目不含保留语义字段（readonlyPositions/readonlyPaths 已删）', () => {
    // 保留由 keep 声明表达（调用点 keep / 函数体 exec.keep），类型系统不再承载（R7）
    for (const fn of CAD_NAMESPACE_FUNCTIONS) {
      const sym = SYMBOL_TABLE[fn]
      expect(sym, `missing symbol for "${fn}"`).toBeDefined()
      expect(sym!.readonlyPositions, `${fn} should not carry readonlyPositions`).toBeUndefined()
      expect(sym!.readonlyPaths, `${fn} should not carry readonlyPaths`).toBeUndefined()
    }
  })

  it('未知函数不在符号表中（返回 undefined）', () => {
    expect(getFunctionSymbol('unknownFunction')).toBeUndefined()
    expect(getFunctionSymbol('myLib.clone')).toBeUndefined()
  })
})
