/**
 * role-vocab.ts — 从 cad 命名空间的 `DUAL_OP_META.naming` 声明收集 role 词汇表（2.10）。
 *
 * 「词汇表随 op 声明进生成产物」的数据源：运行时注册的 cad 命名空间是
 * **唯一权威**——手写 op 的声明在 `defineOp` 元数据上，生成投影的声明经
 * `compatOp` 透传到同一个元数据槽（compat-op.ts:193-204），没有第二个家。
 *
 * 消费方：`gen-api-dts.ts`（`src/mesh/api.d.ts` 的词汇表段）与
 * `scripts/gen-ops-api-inventory.ts`（API 手册的命名段）。
 *
 * ⚠️ 本模块 import `api-namespace` 会拉起整个 L3 API 树（defineOp 包装等），
 * 仅限生成器脚本在 tsx 下使用；**不得**被 `src/` 运行时代码引用。
 */

import { createApiNamespace } from '../src/api/api-namespace'
import { DUAL_OP_META, type DualOpMeta } from '../src/define-op'
import { formatRoleName, type RoleName } from '../src/topology/naming/role-name'
import type { Provenance } from '../src/topology/naming/lineage'

/** 单个 op 的命名声明摘要（生成产物的行数据）。 */
export interface RoleVocabEntry {
  /** cad 命名空间里的 op 名。 */
  readonly op: string
  /** provenance 类别（六值封闭集）。 */
  readonly kind: string
  /** `kind === 'unmodeled'` 时的记账理由；其余类别为 undefined。 */
  readonly reason?: string
  /**
   * 新造面的 role 词汇（序列化线格式）。
   * - `construct` / `kernel(explicit)`：声明的词表逐项 `formatRoleName`；
   * - `kernel(byAdjacency)`：`gen:<op>:<i>`（过渡面按邻接指认，下标 i）；
   * - `identity` / `subdivide` / `replicate`：`[]`（不造新面；replica/splinter
   *   由框架按 `<kind>[k]/<inner>` 复合生成，非 op 声明项）。
   */
  readonly vocab: readonly string[]
  /** 词表的复合生成说明（identity/subdivide/replicate 的括号注记）；无则 undefined。 */
  readonly note?: string
}

/** `kernel` 类 byAdjacency 新造面的描述形态（计划 §4.2：`gen:fillet:0`）。 */
function adjacencyVocab(op: string): string[] {
  return [`gen:${op}:<i>`]
}

/** 从 DualOpMeta.naming 归纳词表行。 */
function toEntry(op: string, meta: DualOpMeta): RoleVocabEntry {
  const naming: Provenance = meta.naming
  switch (naming.kind) {
    case 'construct':
    case 'kernel': {
      const vocab =
        naming.newFaces.via === 'explicit'
          ? naming.newFaces.vocab.map((r: RoleName) => formatRoleName(r))
          : adjacencyVocab(op)
      return { op, kind: naming.kind, vocab }
    }
    case 'identity':
      return { op, kind: naming.kind, vocab: [], note: '1:1，第 i 面 → 第 i 面（零声明）' }
    case 'subdivide':
      return { op, kind: naming.kind, vocab: [], note: '每输入面 → 若干片：splinter(<原 role>)#j 由框架生成' }
    case 'replicate':
      return {
        op,
        kind: naming.kind,
        vocab: [],
        note: `replica[k]/<原 role> 由框架生成（k=0..${naming.k - 1}）`,
      }
    case 'unmodeled':
      return { op, kind: naming.kind, reason: naming.reason, vocab: [] }
  }
}

/**
 * 枚举 cad 命名空间全部 op 的命名声明，按名称排序。
 *
 * @returns one entry per op carrying `DUAL_OP_META.naming`（查询类 op 无声明 → 不出现）。
 */
export function collectRoleVocab(): RoleVocabEntry[] {
  const ns = createApiNamespace() as Record<string, unknown>
  const entries: RoleVocabEntry[] = []
  for (const [op, fn] of Object.entries(ns)) {
    const meta = (fn as { [DUAL_OP_META]?: DualOpMeta } | null)?.[DUAL_OP_META]
    if (meta?.naming) entries.push(toEntry(op, meta))
  }
  entries.sort((a, b) => a.op.localeCompare(b.op))
  return entries
}
