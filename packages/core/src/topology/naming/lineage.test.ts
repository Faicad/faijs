/**
 * lineage.test.ts — 血缘登记的三条硬规则与两张表（计划 §4.3 / Phase 1.3）。
 *
 * ## 这组测试真正在防什么
 *
 * 三条规则里只有 N2 是"配置错"（锚点没设/不符）；**N1 与 N3 防的是"静默产生错身份"**：
 *
 * - **N1**：op 内部临时造的 Shape 若被"默认成链根"，会得到一个**能解析成功但解析到
 *   别的面**的引用。这类错误不会在测试里暴露——除非参数恰好让两者重合。
 *   故本测试的 N1 用例**断言"报错"而不是"有名字"**。
 * - **N3**：同一语句登记两次、内容不同，说明"一个 StmtId 有两种说法"。若后写的静默胜出，
 *   血缘图会随登记顺序漂移。故必须报错，且**报错前不得写入任何一半**（原子性）。
 *
 * `register` 的全部校验都在写入之前完成，故每个失败用例都额外断言"两张表没被污染"。
 */

import { describe, it, expect } from 'vitest'
import { asPartName, asStmtId, type PartName, type StmtId } from '../../identity'
import type { HashEvolution } from '../../brep/face-evolution'
import { semantic, wall, type RoleName } from './role-name'
import {
  LineageGraph,
  LineageError,
  PROVENANCE_KINDS,
  newFaceRuleEquals,
  provenanceEquals,
  roleNameEquals,
  type LineageDeps,
  type LineageDraft,
  type Provenance,
} from './lineage'

const P = (s: string): PartName => asPartName(s)
const S = (s: string): StmtId => asStmtId(s)

/** 假的 Shape 句柄（对象身份即 Shape 身份）。 */
const shapeA = { id: 'shapeA' }
const shapeB = { id: 'shapeB' }
const strayShape = { id: 'stray' }

/** 一个可控的 deps：名字表 + 当前锚点。 */
function deps(opts: {
  names?: ReadonlyMap<object, PartName>
  anchorId?: string | null
} = {}): LineageDeps {
  const names = opts.names ?? new Map<object, PartName>([
    [shapeA, P('part0')],
    [shapeB, P('part1')],
  ])
  const anchorId = opts.anchorId === undefined ? 's1' : opts.anchorId
  return {
    nameOf: (shape) => names.get(shape),
    currentStmt: () => (anchorId === null ? undefined : { id: anchorId }),
  }
}

/** 一个合法的 draft（可覆写任意字段）。 */
function draft(over: Partial<LineageDraft> = {}): LineageDraft {
  return {
    stmt: S('s1'),
    op: 'cad.fillet',
    inputs: [shapeA],
    outputs: [P('part1')],
    provenance: { kind: 'kernel', newFaces: { via: 'byAdjacency' } },
    ...over,
  }
}

/** 空的 hash 演化记录（attachEvolution 用）。 */
function emptyEvolution(): HashEvolution {
  return { modified: new Map(), deleted: new Set() }
}

describe('血缘登记：正常路径', () => {
  it('登记后两张表都通：按语句取节点、按 part 反查语句', () => {
    const graph = new LineageGraph()
    const node = graph.register(draft(), deps())

    expect(node.stmt).toBe('s1')
    expect(node.inputs).toEqual(['part0'])
    expect(node.outputs).toEqual(['part1'])
    expect(node.provenance.kind).toBe('kernel')
    expect(graph.size).toBe(1)
    expect(graph.node(S('s1'))).toEqual(node)
    expect(graph.stmtOf(P('part1'))).toBe('s1')
    expect(graph.nodeOfPart(P('part1'))).toEqual(node)
  })

  it('多个输入按声明顺序落成 PartName（顺序是语义的一部分）', () => {
    const graph = new LineageGraph()
    const node = graph.register(
      draft({ op: 'cad.subtract', inputs: [shapeB, shapeA], outputs: [P('part2')] }),
      deps(),
    )
    expect(node.inputs).toEqual(['part1', 'part0'])
  })

  it('多输出的语句每个输出都能反查回同一条语句', () => {
    const graph = new LineageGraph()
    graph.register(
      draft({ op: 'cad.group', inputs: [shapeA, shapeB], outputs: [P('part2'), P('part3')] }),
      deps(),
    )
    expect(graph.stmtOf(P('part2'))).toBe('s1')
    expect(graph.stmtOf(P('part3'))).toBe('s1')
  })

  it('零输入语句（链根：box / sketch / load）合法', () => {
    const graph = new LineageGraph()
    const node = graph.register(
      draft({
        op: 'cad.box',
        inputs: [],
        outputs: [P('part0')],
        provenance: { kind: 'construct', newFaces: { via: 'explicit', vocab: [semantic('top')] } },
      }),
      deps(),
    )
    expect(node.inputs).toEqual([])
  })

  it('未登记的 part 反查返回 undefined（不是抛错，调用方据此判断"还没有血缘"）', () => {
    const graph = new LineageGraph()
    expect(graph.stmtOf(P('part9'))).toBeUndefined()
    expect(graph.nodeOfPart(P('part9'))).toBeUndefined()
    expect(graph.node(S('s9'))).toBeUndefined()
  })

  it('clear() 清空两张表', () => {
    const graph = new LineageGraph()
    graph.register(draft(), deps())
    graph.clear()
    expect(graph.size).toBe(0)
    expect(graph.node(S('s1'))).toBeUndefined()
    expect(graph.stmtOf(P('part1'))).toBeUndefined()
  })

  it('两个图实例互不干扰（测试各自的图，不靠全局态）', () => {
    const g1 = new LineageGraph()
    const g2 = new LineageGraph()
    g1.register(draft(), deps())
    expect(g1.size).toBe(1)
    expect(g2.size).toBe(0)
  })
})

describe('N1：输入 Shape 查不到 PartName 必须报错（不许默认成链根）', () => {
  it('抛 E_TOPO_UNTRACKED_INPUT，并指出是第几个输入', () => {
    const graph = new LineageGraph()
    try {
      graph.register(draft({ inputs: [shapeA, strayShape] }), deps())
      expect.unreachable('N1 应当抛错')
    } catch (e) {
      const err = e as LineageError
      expect(err.code).toBe('E_TOPO_UNTRACKED_INPUT')
      expect(err.stmt).toBe('s1')
      expect(err.message).toContain('第 1 个输入') // 0-based index 1
    }
  })

  it('报错时**两张表都没被写入**（失败不留半条记录）', () => {
    const graph = new LineageGraph()
    expect(() => graph.register(draft({ inputs: [strayShape] }), deps())).toThrow(LineageError)
    expect(graph.size).toBe(0)
    expect(graph.stmtOf(P('part1'))).toBeUndefined()
  })

  it('链根 op（inputs 为空）不会误触 N1', () => {
    const graph = new LineageGraph()
    expect(() => graph.register(draft({ inputs: [], provenance: { kind: 'identity' } }), deps())).not.toThrow()
  })
})

describe('N2：当前锚点必须存在且与本条语句一致', () => {
  it('无锚点 → E_TOPO_NO_ANCHOR', () => {
    const graph = new LineageGraph()
    try {
      graph.register(draft(), deps({ anchorId: null }))
      expect.unreachable('N2 应当抛错')
    } catch (e) {
      expect((e as LineageError).code).toBe('E_TOPO_NO_ANCHOR')
    }
  })

  it('锚点不符（拿到的是别人的语句）→ E_TOPO_NO_ANCHOR，且消息同时给出两个 id', () => {
    const graph = new LineageGraph()
    try {
      graph.register(draft({ stmt: S('s1') }), deps({ anchorId: 's7' }))
      expect.unreachable('N2 应当抛错')
    } catch (e) {
      const err = e as LineageError
      expect(err.code).toBe('E_TOPO_NO_ANCHOR')
      expect(err.message).toContain('s1')
      expect(err.message).toContain('s7')
    }
  })

  it('N2 先于 N1 判定（锚点都不对时，报的是锚点问题）', () => {
    const graph = new LineageGraph()
    try {
      graph.register(draft({ inputs: [strayShape] }), deps({ anchorId: 's7' }))
      expect.unreachable('应当抛错')
    } catch (e) {
      expect((e as LineageError).code).toBe('E_TOPO_NO_ANCHOR')
    }
  })
})

describe('N3：同一语句重复登记内容不同必须报错；内容相同则幂等', () => {
  it('内容不同 → E_TOPO_DUPLICATE_STMT，消息列出两种说法', () => {
    const graph = new LineageGraph()
    graph.register(draft(), deps())
    try {
      graph.register(draft({ op: 'cad.chamfer' }), deps())
      expect.unreachable('N3 应当抛错')
    } catch (e) {
      const err = e as LineageError
      expect(err.code).toBe('E_TOPO_DUPLICATE_STMT')
      expect(err.message).toContain('cad.fillet')
      expect(err.message).toContain('cad.chamfer')
    }
  })

  it('内容相同重复登记 → 幂等放行（两条调用点路径可能都登记同一步）', () => {
    const graph = new LineageGraph()
    const first = graph.register(draft(), deps())
    const second = graph.register(draft(), deps())
    expect(second).toEqual(first)
    expect(graph.size).toBe(1)
  })

  it('输出顺序不同也算内容不同（顺序是语义）', () => {
    const graph = new LineageGraph()
    graph.register(draft({ inputs: [shapeA, shapeB], outputs: [P('part2'), P('part3')] }), deps())
    expect(() =>
      graph.register(draft({ inputs: [shapeA, shapeB], outputs: [P('part3'), P('part2')] }), deps()),
    ).toThrow(LineageError)
  })

  it('provenance 词汇表不同也算内容不同', () => {
    const graph = new LineageGraph()
    const vocabA: Provenance = { kind: 'construct', newFaces: { via: 'explicit', vocab: [semantic('top')] } }
    const vocabB: Provenance = { kind: 'construct', newFaces: { via: 'explicit', vocab: [semantic('bottom')] } }
    graph.register(draft({ provenance: vocabA }), deps())
    expect(() => graph.register(draft({ provenance: vocabB }), deps())).toThrow(LineageError)
  })

  it('⭐ N3 **不比较 evolution**：补挂演化后同内容重登记仍放行，且演化不被抹掉', () => {
    // 若把 evolution 纳入比较，第二次登记会因"上次还没补 evolution"而误报冲突；
    // 若重登记时用新对象整体覆盖，先前补挂的演化会被**静默丢掉**。两条都要防。
    const graph = new LineageGraph()
    graph.register(draft(), deps())
    const evo = emptyEvolution()
    graph.attachEvolution(S('s1'), evo)
    expect(() => graph.register(draft(), deps())).not.toThrow()
    expect(graph.node(S('s1'))?.evolution).toBe(evo)
  })

  it('重登记返回的节点与表内节点一致（返回值不是游离副本）', () => {
    const graph = new LineageGraph()
    graph.register(draft(), deps())
    const evo = emptyEvolution()
    graph.attachEvolution(S('s1'), evo)
    const returned = graph.register(draft(), deps())
    expect(returned).toEqual(graph.node(S('s1')))
    expect(returned.evolution).toBe(evo)
  })

  it('不同语句登记相同内容 → 合法（不是 N3 的适用范围）', () => {
    // 输出必须换名：同一 PartName 属另一条语句时是 PART_REDEFINED，与本用例无关。
    const graph = new LineageGraph()
    graph.register(draft({ stmt: S('s1') }), deps({ anchorId: 's1' }))
    const second = graph.register(
      draft({ stmt: S('s7'), op: 'cad.box', inputs: [], outputs: [P('part7')] }),
      deps({ anchorId: 's7' }),
    )
    expect(second.stmt).toBe('s7')
    expect(second.op).toBe('cad.box')
    expect(graph.size).toBe(2)
  })
})

describe('PartName 复用守卫：一个名字只能属于一条语句', () => {
  it('两条语句声明同一 output → E_TOPO_PART_REDEFINED', () => {
    const graph = new LineageGraph()
    graph.register(draft({ stmt: S('s1') }), deps({ anchorId: 's1' }))
    try {
      graph.register(draft({ stmt: S('s7') }), deps({ anchorId: 's7' }))
      expect.unreachable('复用 PartName 应当抛错')
    } catch (e) {
      const err = e as LineageError
      expect(err.code).toBe('E_TOPO_PART_REDEFINED')
      expect(err.message).toContain('s1')
      expect(err.message).toContain('s7')
    }
    // 反查仍指向原主，没被改写
    expect(graph.stmtOf(P('part1'))).toBe('s1')
  })
})

describe('attachEvolution', () => {
  it('挂在已登记节点上，其余字段不变', () => {
    const graph = new LineageGraph()
    const before = graph.register(draft(), deps())
    const evo = emptyEvolution()
    graph.attachEvolution(S('s1'), evo)
    const after = graph.node(S('s1'))!
    expect(after.evolution).toBe(evo)
    expect(after.op).toBe(before.op)
    expect(after.inputs).toEqual(before.inputs)
  })

  it('挂到未登记的语句 → 抛错（不静默新建节点）', () => {
    const graph = new LineageGraph()
    expect(() => graph.attachEvolution(S('s9'), emptyEvolution())).toThrow(LineageError)
    expect(graph.size).toBe(0)
  })
})

describe('结构化相等（N3 的判据本身）', () => {
  it('roleNameEquals：同值不同键序相等；嵌套逐层比', () => {
    expect(roleNameEquals({ kind: 'generated', op: 'fillet', index: 0 }, { index: 0, kind: 'generated', op: 'fillet' })).toBe(true)
    expect(roleNameEquals({ kind: 'wall', index: 0 }, { kind: 'wall', index: 1 })).toBe(false)
    expect(roleNameEquals({ kind: 'wall', index: 0 }, semantic('top'))).toBe(false)
    expect(
      roleNameEquals(
        { kind: 'replica', k: 2, inner: { kind: 'wall', index: 3 } },
        { kind: 'replica', k: 2, inner: { kind: 'wall', index: 3 } },
      ),
    ).toBe(true)
    expect(
      roleNameEquals(
        { kind: 'replica', k: 2, inner: { kind: 'wall', index: 3 } },
        { kind: 'replica', k: 2, inner: { kind: 'wall', index: 4 } },
      ),
    ).toBe(false)
  })

  it('newFaceRuleEquals：byAdjacency ≠ explicit；词汇表按序比', () => {
    const vocab: RoleName[] = [semantic('top'), semantic('bottom')]
    expect(newFaceRuleEquals({ via: 'byAdjacency' }, { via: 'byAdjacency' })).toBe(true)
    expect(newFaceRuleEquals({ via: 'byAdjacency' }, { via: 'explicit', vocab: [] })).toBe(false)
    expect(newFaceRuleEquals({ via: 'explicit', vocab }, { via: 'explicit', vocab: [...vocab] })).toBe(true)
    expect(newFaceRuleEquals({ via: 'explicit', vocab }, { via: 'explicit', vocab: [semantic('bottom'), semantic('top')] })).toBe(false)
    expect(newFaceRuleEquals({ via: 'explicit', vocab }, { via: 'explicit', vocab: [semantic('top')] })).toBe(false)
  })

  it('provenanceEquals：零声明类别只比标签；replicate 比 k；unmodeled 比理由', () => {
    expect(provenanceEquals({ kind: 'identity' }, { kind: 'identity' })).toBe(true)
    expect(provenanceEquals({ kind: 'subdivide' }, { kind: 'subdivide' })).toBe(true)
    expect(provenanceEquals({ kind: 'identity' }, { kind: 'subdivide' })).toBe(false)
    expect(provenanceEquals({ kind: 'replicate', k: 2 }, { kind: 'replicate', k: 2 })).toBe(true)
    expect(provenanceEquals({ kind: 'replicate', k: 2 }, { kind: 'replicate', k: 3 })).toBe(false)
    expect(provenanceEquals({ kind: 'unmodeled', reason: 'x' }, { kind: 'unmodeled', reason: 'x' })).toBe(true)
    expect(provenanceEquals({ kind: 'unmodeled', reason: 'x' }, { kind: 'unmodeled', reason: 'y' })).toBe(false)
  })
})

describe('六个 provenance 类别（封闭集）', () => {
  it('PROVENANCE_KINDS 恰为六值（新增类别必须同步此处，否则审计漏掉）', () => {
    expect([...PROVENANCE_KINDS].sort()).toEqual(
      ['construct', 'identity', 'kernel', 'replicate', 'subdivide', 'unmodeled'].sort(),
    )
  })

  it('construct 只接受 explicit（构造类的新面必然来自构造规则，不存在"靠邻接猜"）', () => {
    // ⚠️ 这条**没有运行期断言，是故意的**：§4.6 明确「未声明类别 → 编译期 / 生成期失败，
    // 不是运行期」。故运行期**不校验** provenance 载荷——校验由下面这行 `@ts-expect-error`
    // 承担，由 `tsc -p packages/core/tsconfig.json`（include 含测试文件）执行。
    const byAdjacency = { kind: 'construct', newFaces: { via: 'byAdjacency' } }
    // @ts-expect-error construct.newFaces 只接受 { via:'explicit', vocab }（见 Provenance 定义）
    const asProvenance: Provenance = byAdjacency
    // 运行期照收：证明"拒绝发生在类型层"，而不是悄悄加了一道运行期兜底
    expect(asProvenance.kind).toBe('construct')
    const graph = new LineageGraph()
    expect(() => graph.register(draft({ provenance: asProvenance }), deps())).not.toThrow()
  })

  it('零声明类别（identity / subdivide / replicate(k)）不带词汇字段', () => {
    const graph = new LineageGraph()
    const node = graph.register(draft({ provenance: { kind: 'replicate', k: 4 } }), deps())
    expect(node.provenance).toEqual({ kind: 'replicate', k: 4 })
    expect(provenanceEquals(node.provenance, { kind: 'replicate', k: 4 })).toBe(true)
    // identity / subdivide 同理：只有标签，没有 newFaces
    const copy = graph.register(
      draft({ stmt: S('s2'), op: 'cad.copy', outputs: [P('part2')], provenance: { kind: 'identity' } }),
      deps({ anchorId: 's2' }),
    )
    const split = graph.register(
      draft({ stmt: S('s3'), op: 'cad.split', outputs: [P('part3')], provenance: { kind: 'subdivide' } }),
      deps({ anchorId: 's3' }),
    )
    expect(copy.provenance).toEqual({ kind: 'identity' })
    expect(split.provenance).toEqual({ kind: 'subdivide' })
  })

  it('kernel 可以带 explicit 词汇表（布尔新面挂消费语句时用）', () => {
    const graph = new LineageGraph()
    const node = graph.register(
      draft({
        provenance: { kind: 'kernel', newFaces: { via: 'explicit', vocab: [wall(0)] } },
      }),
      deps(),
    )
    expect(node.provenance.kind).toBe('kernel')
  })
})
