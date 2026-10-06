/**
 * lineage-resolve.test.ts — 1.10 前置②：回走推进器测试。
 *
 * GOTCHA（实测踩过，留档）：跨节点推进的载体是**面枚举序号（ordinal）**，
 * 不是 hash——hash 是内存指针哈希，每个 Shape 实例各造各的（copy 两个 cube
 * 的同位面 hash 不同），跨节点推进若用 hash 会全链 miss。hash 只在链的两端
 * （锚定 / 落地）做「role ↔ ordinal」换算的桥。
 *
 * GOTCHA：序号 1 起（OCCT 枚举序），ordinal→hash 落地时 `hashes[o-1]`。
 */

import { describe, expect, it } from 'vitest'
import { resolveViaLineage, type LineageResolveDeps } from '../../../src/topology/naming/lineage-resolve'
import { LineageGraph, type LineageDraft } from '../../../src/topology/naming/lineage'
import { asStmtId, type PartName } from '../../../src/identity'

/** origin→role→hash[] 的 roleTable 缓存形（root 锚定读这个）。 */
type Table = Record<string, ReadonlyMap<string, ReadonlyMap<string, readonly number[]>>>

/** 测试域：hash = 1000/2000 + ordinal（可反解），roleTable 逐测试注入。 */
function makeDeps(handles: Record<string, number[]>, tables: Table): LineageResolveDeps {
  return {
    brepOf: (part) => (part in handles ? { part } : undefined),
    faceHashes: (handle) => handles[(handle as { part: string }).part] ?? [],
    roleTableOf: (part) => tables[part],
  }
}

/** 测试用 nameOf：输入直接传 part 名字符串（N1 校验的正是「有名字」）。 */
const testNameOf = (s: object): PartName | undefined =>
  typeof s === 'string' ? (s as PartName) : ((s as { name?: string }).name as PartName | undefined)

/** 测试用 register deps：nameOf + 按 stmt 的 currentStmt（N2）。 */
function stmtDeps(stmt: string): { nameOf: typeof testNameOf; currentStmt: () => { id: string } } {
  return { nameOf: testNameOf, currentStmt: () => ({ id: stmt }) }
}

function draft(stmt: string, op: string, inputs: string[], outputs: string[], kind: 'identity' | 'kernel'): LineageDraft {
  return {
    stmt: asStmtId(stmt),
    op,
    inputs: inputs as unknown as PartName[],
    outputs: outputs as unknown as [PartName, ...PartName[]],
    provenance:
      kind === 'identity'
        ? { kind: 'identity' }
        : { kind: 'kernel', newFaces: { via: 'byAdjacency' } },
  }
}

describe('1.10 前置②：回走推进器', () => {
  it('单节点链（origin 自己产出目标 part）：锚定即落地', () => {
    const g = new LineageGraph()
    g.register(draft('s1', 'cad.box', [], ['part0'], 'identity'), stmtDeps('s1'))
    const deps = makeDeps({ part0: [1001, 1002, 1003] }, {
      part0: new Map([['s1', new Map([['top', [1002]]])]]),
    })
    const r = resolveViaLineage(g, asStmtId('s1'), 'top', 'part0' as PartName, deps)
    expect(r).toEqual({ hashes: [1002] })
  })

  it('两节点链：经 evolution 把 ordinal 推进到目标 part', () => {
    const g = new LineageGraph()
    g.register(draft('s1', 'cad.box', [], ['part0'], 'identity'), stmtDeps('s1'))
    // part0: 3 面 → part1（fillet 后 4 面）：演化 ordinal1→1, 2→[2,4], 3→3
    const n2 = g.register(draft('s2', 'cad.fillet', ['part0'], ['part1'], 'kernel'), stmtDeps('s2'))
    g.attachEvolution(n2.stmt, new Map([[1, [1]], [2, [2, 4]], [3, [3]]]))
    const deps = makeDeps({ part0: [1001, 1002, 1003], part1: [2001, 2002, 2003, 2004] }, {
      part0: new Map([['s1', new Map([['top', [1001]]])]]),
    })
    const r = resolveViaLineage(g, asStmtId('s1'), 'top', 'part1' as PartName, deps)
    expect(r).toEqual({ hashes: [2001] })
  })

  it('演化缺失 → 结构化失败 no-evolution（不默认恒等）', () => {
    const g = new LineageGraph()
    g.register(draft('s1', 'cad.box', [], ['part0'], 'identity'), stmtDeps('s1'))
    g.register(draft('s2', 'cad.copy', ['part0'], ['part1'], 'identity'), stmtDeps('s2'))
    const deps = makeDeps({ part0: [1001], part1: [2001] }, {
      part0: new Map([['s1', new Map([['top', [1001]]])]]),
    })
    const r = resolveViaLineage(g, asStmtId('s1'), 'top', 'part1' as PartName, deps)
    expect(r).toMatchObject({ reason: 'no-evolution', stmt: 's2' })
  })

  it('root 无 roleTable → 结构化失败 no-role-table（G6：不静默）', () => {
    const g = new LineageGraph()
    g.register(draft('s1', 'cad.box', [], ['part0'], 'identity'), stmtDeps('s1'))
    const deps = makeDeps({ part0: [1001] }, {})
    const r = resolveViaLineage(g, asStmtId('s1'), 'top', 'part0' as PartName, deps)
    expect(r).toMatchObject({ reason: 'no-role-table', part: 'part0' })
  })

  it('1→N 分裂推进：演化多后继全带回（exact 上层再用 hint 裁决）', () => {
    const g = new LineageGraph()
    g.register(draft('s1', 'cad.box', [], ['part0'], 'identity'), stmtDeps('s1'))
    const n2 = g.register(draft('s2', 'cad.split', ['part0'], ['part1'], 'kernel'), stmtDeps('s2'))
    g.attachEvolution(n2.stmt, new Map([[1, [1]], [2, [2, 3]]]))
    const deps = makeDeps({ part0: [1001, 1002], part1: [2001, 2002, 2003] }, {
      part0: new Map([['s1', new Map([['side', [1002]]])]]),
    })
    const r = resolveViaLineage(g, asStmtId('s1'), 'side', 'part1' as PartName, deps)
    expect(r).toEqual({ hashes: [2002, 2003] })
  })
})
