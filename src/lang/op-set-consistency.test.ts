/**
 * op-set-consistency — 符号表 ↔ stdlib 签名一致性守卫
 *
 * 阶段 1（§3.6）新增：符号表 ↔ stdlib 签名一致性守卫。
 * 阶段 4（§6.1）改造：SCHEMAS 框架删除后，schema↔codegen 键集一致性测试随之删除
 * （codegen 已是通用打印机：IR 里有什么打印什么，无 per-op 字段表可对照）；
 * 符号表守卫保留并更新——符号表现覆盖 cad 命名空间全部函数
 * （无 readonly 标注的记空对象，check() 符号检查据此判定"函数不存在"）。
 *
 * 覆盖：
 * - 符号表键集合 == cad 命名空间函数集（与 internal-stdlib 装配一致）
 * - copy 的 readonlyPositions、group/assembly 的 readonlyPaths 标注正确
 * - 未知函数（不在 cad 命名空间）→ undefined（默认消费语义）
 * - R5 反例：混合 Shape + ReadonlyShape 签名 → 生成期抛错
 */

import { describe, it, expect } from 'vitest'
import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SYMBOL_TABLE, getFunctionSymbol } from './symbol-table'
import { extractSymbolTable } from '../../scripts/gen-symbol-table'

/**
 * cad 命名空间函数集（与 src/cad-runtime/internal-stdlib.ts 的 createInternalStdlib
 * 装配键一致）。符号表应恰好覆盖此集合。
 */
const CAD_NAMESPACE_FUNCTIONS = new Set([
  'box', 'sphere', 'cylinder', 'cone', 'wedge',
  'text', 'screw', 'svgExtrude', 'sdf', 'load',
  'translate', 'rotate', 'scale',
  'drill', 'extrude', 'engrave', 'knurl',
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

  it('每个 cad 命名空间函数在符号表中都有条目（空对象 = 默认消费语义）', () => {
    for (const fn of CAD_NAMESPACE_FUNCTIONS) {
      expect(SYMBOL_TABLE[fn], `missing symbol for "${fn}"`).toBeDefined()
    }
  })

  it('copy 的 readonlyPositions 包含 0', () => {
    const sym = getFunctionSymbol('copy')
    expect(sym).toBeDefined()
    expect(sym!.readonlyPositions).toContain(0)
  })

  it('group 的 readonlyPaths 包含 members', () => {
    const sym = getFunctionSymbol('group')
    expect(sym).toBeDefined()
    expect(sym!.readonlyPaths).toContain('members')
  })

  it('assembly 的 readonlyPaths 包含 members', () => {
    const sym = getFunctionSymbol('assembly')
    expect(sym).toBeDefined()
    expect(sym!.readonlyPaths).toContain('members')
  })

  it('消费性函数（drill/union）在符号表中但无 readonly 标注', () => {
    // drill/union 无 readonly 标注 → 空对象（默认消费语义），但必须存在（check() 符号检查）
    const drill = getFunctionSymbol('drill')
    expect(drill).toBeDefined()
    expect(drill!.readonlyPositions).toBeUndefined()
    expect(drill!.readonlyPaths).toBeUndefined()
    const union = getFunctionSymbol('union')
    expect(union).toBeDefined()
    expect(union!.readonlyPositions).toBeUndefined()
  })

  it('未知函数不在符号表中（返回 undefined）', () => {
    expect(getFunctionSymbol('unknownFunction')).toBeUndefined()
    expect(getFunctionSymbol('myLib.clone')).toBeUndefined()
  })
})

// ── R5 反例：混合 Shape + ReadonlyShape → 生成期抛错 ──

describe('symbol-table R5 violation: mixed Shape + ReadonlyShape', () => {
  it('extractSymbolTable 对混合 Shape + ReadonlyShape 签名抛错', () => {
    // Construct a temp TS source with a function that has both Shape and ReadonlyShape params
    const tempSource = `
import type { Shape, ReadonlyShape } from './mesh/types'
import type { ExecContext } from './cad-runtime/exec-context'

export function mixedFn(a: Shape, b: ReadonlyShape, exec: ExecContext): Shape {
  return a
}
`
    // Use a temp file path for the generator to scan
    const tempFile = join(tmpdir(), `__r5_test_${Date.now()}.ts`)
    writeFileSync(tempFile, tempSource, 'utf-8')

    try {
      expect(() => extractSymbolTable([tempFile])).toThrow(/R5/)
    } finally {
      unlinkSync(tempFile)
    }
  })
})
