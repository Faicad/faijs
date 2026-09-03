/**
 * op-set-consistency — 三源一致守卫（P23 §6.1 B1 / §4.2 ②）
 *
 * P23 之前：符号表 ↔ stdlib 签名一致性（阶段 1，§3.6）；键集合 == cad 命名空间。
 * P23 起：cad 脚本面重建到兼容面同源清单上（faijs 特有 dual op + 生成脚本面 op），
 * 三个消费面必须同源——
 *
 *   ① `check()` 符号表（src/lang/symbol-table.generated.ts）
 *   ② cad 命名空间运行时键集（api/api-namespace.ts 的 createApiNamespace()）
 *   ③ 导出面（api/index.ts，必须覆盖 cad 面每个键）
 *
 * ②的运行时键集 = createApiNamespace() 键集（含 `...scriptFaceOps` 展开），
 * ①由 gen-symbol-table.ts 从「api-namespace 字面量 ∪ script-face-manifest」生成，
 * ③经 `export * from './generated/script-face'` 与 api-namespace 同源。
 * 本测试用运行时对象（而非文本解析）断言，防两份清单漂移。
 *
 * 覆盖：
 * - 符号表键集合 ≡ cad 命名空间函数集（双向：无缺失、无多余）
 * - cad 命名空间每个函数都被 api/index.ts 导出（导出面 ⊇ cad 面）
 * - 未知函数（不在 cad 命名空间）→ undefined
 * - keep 语义字段仍不在符号表上（R7）
 */

import { describe, it, expect } from 'vitest'
import { SYMBOL_TABLE, getFunctionSymbol } from './symbol-table'
import { createApiNamespace } from '../api/api-namespace'
import { SCRIPT_FACE_OPS } from '../api/generated/script-face-manifest'
import * as apiIndex from '../api/index'

/** cad 命名空间运行时键集（不含 contractVersion 元数据键）。 */
function cadNamespaceFunctions(): string[] {
  return Object.keys(createApiNamespace()).filter((k) => k !== 'contractVersion')
}

/** api/index.ts 顶层导出名（运行时命名空间键集，含 `export *` 通配解析结果）。 */
function apiIndexExportNames(): Set<string> {
  return new Set(Object.keys(apiIndex))
}

describe('op-set-consistency: 三源一致（check() 符号表 ≡ cad 面 ⊆ 导出面）', () => {
  it('符号表键集合恰好等于 cad 命名空间函数集（双向：无缺失、无多余）', () => {
    const tableKeys = new Set(Object.keys(SYMBOL_TABLE))
    const cadKeys = new Set(cadNamespaceFunctions())
    // 双向一致：无缺失、无多余
    const missing = [...cadKeys].filter((f) => !tableKeys.has(f))
    const extra = [...tableKeys].filter((f) => !cadKeys.has(f))
    expect(missing).toEqual([])
    expect(extra).toEqual([])
  })

  it('cad 面 = faijs 特有 op ∪ 生成脚本面 op（script-face-manifest 是同一份清单）', () => {
    const cadKeys = new Set(cadNamespaceFunctions())
    for (const op of SCRIPT_FACE_OPS) {
      expect(cadKeys.has(op.name), `脚本面 op "${op.name}" 未进 cad 命名空间`).toBe(true)
    }
    // 生成脚本面 op 全部是 compatOp 产物（kind 'dual-op'，brep-only：无 mesh 实现）
    const ns = createApiNamespace() as unknown as Record<string, { __faijs__dualOp?: { mesh?: unknown; brep?: unknown } }>
    for (const op of SCRIPT_FACE_OPS) {
      const meta = ns[op.name]?.__faijs__dualOp
      expect(meta, `脚本面 op "${op.name}" 缺 dual-op 元数据`).toBeDefined()
      expect(typeof meta!.brep, `脚本面 op "${op.name}" 缺 brep 实现`).toBe('function')
      expect(meta!.mesh, `脚本面 op "${op.name}" 不应是 mesh 路径`).toBeUndefined()
    }
  })

  it('cad 命名空间每个函数都被 api/index.ts 导出（导出面 ⊇ cad 面）', () => {
    const exported = apiIndexExportNames()
    const missing = cadNamespaceFunctions().filter((f) => !exported.has(f))
    expect(missing, `api/index.ts 缺失导出: ${missing.join(', ')}`).toEqual([])
  })

  it('每个 cad 命名空间函数在符号表中都有条目（供 check() 符号检查）', () => {
    for (const fn of cadNamespaceFunctions()) {
      expect(SYMBOL_TABLE[fn], `missing symbol for "${fn}"`).toBeDefined()
    }
  })

  it('符号表条目不含保留语义字段（readonlyPositions/readonlyPaths 已删，R7）', () => {
    for (const fn of cadNamespaceFunctions()) {
      const sym = SYMBOL_TABLE[fn]
      expect(sym!.readonlyPositions, `${fn} should not carry readonlyPositions`).toBeUndefined()
      expect(sym!.readonlyPaths, `${fn} should not carry readonlyPaths`).toBeUndefined()
    }
  })

  it('未知函数不在符号表中（返回 undefined）', () => {
    expect(getFunctionSymbol('unknownFunction')).toBeUndefined()
    expect(getFunctionSymbol('myLib.clone')).toBeUndefined()
  })
})
