/**
 * op-set-consistency — 双源一致守卫（P23 §6.1 B1 / §4.2 ②；2026-10-08 §2.7 校正）
 *
 * P23 之前：符号表 ↔ api 签名一致性（阶段 1，§3.6）；键集合 == cad 命名空间。
 * P23 起：cad 脚本面重建到兼容面同源清单上（faijs 特有 dual op + 生成脚本面 op），
 * **两个**消费面必须同源——
 *
 *   ① `check()` 符号表（src/lang/symbol-table.generated.ts）
 *   ② cad 命名空间运行时键集（api/api-namespace.ts 的 createApiNamespace()）
 *
 * ⚠️ 原「第三源」——「导出面（api/index.ts）必须覆盖 cad 面每个键」——已**删除**
 * （§2.7 / DEC-6、DEC-7）。判据：库面公开什么只看库的作者是否需要；脚本 op 是
 * `.fai.js` 的能力，不构成库面必须导出的理由。库面被删的名字改由**反向守卫**
 * 钉住（`packages/faijs-extra/test/core-surface.test.ts`：脚本面专属名字不得残留
 * 在 `@faicad/faijs` / `@faicad/faijs/browser` 入口面）。
 *
 * ②的运行时键集 = createApiNamespace() 键集（含 `...scriptFaceOps` 展开），
 * ①由 gen-symbol-table.ts 从「api-namespace 字面量 ∪ script-face-manifest」生成。
 * 本测试用运行时对象（而非文本解析）断言，防两份清单漂移。
 *
 * 覆盖：
 * - 符号表键集合 ≡ cad 命名空间函数集（双向：无缺失、无多余）
 * - 未知函数（不在 cad 命名空间）→ undefined
 * - keep 语义字段仍不在符号表上（R7）
 */

import { describe, it, expect } from 'vitest'
import { SYMBOL_TABLE, getFunctionSymbol } from '../../src/lang/symbol-table'
import { createApiNamespace } from '../../src/api/api-namespace'
import { SCRIPT_FACE_OPS } from '../../src/api/generated/script-face-manifest'
import { scriptFaceOps } from '../../src/api/generated/script-face'

/** cad 命名空间运行时键集（不含 contractVersion 元数据键）。 */
function cadNamespaceFunctions(): string[] {
  return Object.keys(createApiNamespace()).filter((k) => k !== 'contractVersion')
}

describe('op-set-consistency: 双源一致（check() 符号表 ≡ cad 面）', () => {
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
    // 生成脚本面条目三类：
    // ① compatOp 产物（kind 'dual-op'）→ 必须带 dual-op 元数据；
    // ② 原生库函数（P25 view 三件套，kind 'faijs'）→ 自实现函数，无 dual-op 元数据（跳过）；
    // ③ 手写覆盖（api-namespace 在 `...scriptFaceOps` 之后展开：cut / split / linearPattern /
    //    circularPattern / gridPattern / rectangularPattern / mirrorJoin / mirror / clone）
    //    → 以手写版为准。
    // 判据：命名空间条目与生成条目**同一引用** = 未被覆盖（真·生成产物）；否则为手写覆盖。
    //
    // brep-only 是**生成器**的不变量（gen-l3-surface §5.4：只桥接 brep），
    // 不是脚本面 op 的不变量——手写覆盖可以带 mesh 路径（网格实体建模，见 mesh-solid 方案）。
    // 因此 mesh 必须为 undefined 的断言只对真·生成产物生效。
    const ns = createApiNamespace() as unknown as Record<
      string,
      { __faijs__dualOp?: { mesh?: unknown; brep?: unknown } }
    >
    const generated = scriptFaceOps as unknown as Record<string, unknown>
    for (const op of SCRIPT_FACE_OPS) {
      const meta = ns[op.name]?.__faijs__dualOp
      if (meta === undefined) continue // ② 原生库函数（view 三件套）
      // 所有 dual op 都必须有 brep 实现：brep 是基线，mesh 只是可选增强层。
      expect(typeof meta.brep, `脚本面 op "${op.name}" 缺 brep 实现`).toBe('function')
      if (ns[op.name] !== generated[op.name]) continue // ③ 手写覆盖：mesh 由手写版自行裁决
      // ① 生成产物：生成器只桥接 brep，出现 mesh 路径即说明生成文件被手改或生成器越权。
      expect(meta.mesh, `生成的 compatOp "${op.name}" 不应有 mesh 路径（mesh 只能写在手写覆盖里）`).toBeUndefined()
    }
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
