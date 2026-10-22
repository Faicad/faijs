/**
 * topology/build-vertex-adjacency — vertex → edge / face 邻接表单测。
 *
 * 核心契约：
 * 1. 顶点行号与 buildSelectorRuntimeData 的顶点表（extractVerticesFromEdges）
 *    逐行一致——同 tolerance、同首次出现顺序（测试 1/3/5 直接锁这点）；
 * 2. 折线边的中间顶点也属于该边（多段边，测试 2）；
 * 3. 空边表产出空数组而非零长行数组（测试 4）；
 * 4. buildSelectorRuntimeData / buildSelectorRuntimeMaps 产物带 vertexAdjacency
 *    且与手算一致（测试 5/6）。
 */
import { describe, it, expect } from 'vitest'
import { buildVertexAdjacency } from '../../src/topology/build-vertex-adjacency'
import {
  buildSelectorRuntimeData,
  buildSelectorRuntimeMaps,
  type SelectorRuntimeData,
} from '../../src/topology/build-selector-runtime'
import type { EdgeRow, SelectorBundle, SelectorProxy } from '../../src/topology/types'

/** 最小可用 proxy：只填 edge 几何与 edge→face 关系，其余置空。 */
function makeProxy(
  edgePositions: Float32Array,
  edgeIndices: Uint32Array,
  edgeFaceRows: Uint32Array | number[],
): SelectorProxy {
  return {
    faceRuns: new Uint32Array(),
    faceRunColumns: [],
    edgePositions,
    edgeIndices,
    edgeIds: new Uint32Array(),
    faceEdgeRows: [],
    edgeFaceRows,
    allPointPositions: new Float32Array(),
    allPointTypes: new Uint8Array(),
    allPointRefIndices: new Uint32Array(),
    vertexPointCount: 0,
    edgeMidCount: 0,
    faceCenterCount: 0,
  }
}

/** 边表行：segmentStart/segmentCount + faceStart/faceCount（已顺序化形态）。 */
function makeEdges(rows: Array<{ segStart: number; segCount: number; faceStart: number; faceCount: number }>): EdgeRow[] {
  return rows.map((r) => ({
    id: `e${r.segStart}` as never,
    segmentStart: r.segStart,
    segmentCount: r.segCount,
    faceStart: r.faceStart,
    faceCount: r.faceCount,
  }))
}

/** 单位立方体 wireframe：8 角点、12 直线边、6 面。顶点行号与角点索引一致（首见序）。 */
function makeBoxWireframe() {
  const corners: Array<[number, number, number]> = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ]
  const edgePairs: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ]
  // 每边邻接 2 面（面行号：0=bottom 1=top 2=front 3=right 4=back 5=left）
  const edgeFaces: Array<[number, number]> = [
    [0, 2], [0, 3], [0, 4], [0, 5],
    [1, 2], [1, 3], [1, 4], [1, 5],
    [2, 5], [2, 3], [3, 4], [4, 5],
  ]
  const edgePositions = new Float32Array(corners.flat())
  const edgeIndices = new Uint32Array(edgePairs.flat())
  const edgeFaceRows = new Uint32Array(edgeFaces.flat())
  const edges = makeEdges(
    edgePairs.map((_, i) => ({ segStart: i, segCount: 1, faceStart: i * 2, faceCount: 2 })),
  )
  return { edgePositions, edgeIndices, edgeFaceRows, edges }
}

describe('buildVertexAdjacency', () => {
  it('box：8 顶点，每顶点 3 边 3 面（去重后并集正确）', () => {
    const { edgePositions, edgeIndices, edgeFaceRows, edges } = makeBoxWireframe()
    const adj = buildVertexAdjacency(makeProxy(edgePositions, edgeIndices, edgeFaceRows), edges)

    expect(adj.vertexToEdgeRows).toHaveLength(8)
    expect(adj.vertexToFaceRows).toHaveLength(8)
    for (let v = 0; v < 8; v++) {
      expect(adj.vertexToEdgeRows[v], `顶点 ${v} 应恰有 3 条边`).toHaveLength(3)
      expect(adj.vertexToFaceRows[v], `顶点 ${v} 应恰有 3 张面`).toHaveLength(3)
    }
    // 角点 0 = (0,0,0)：边 e0(0-1)、e3(3-0)、e8(0-4)；面 bottom/front/left
    expect(adj.vertexToEdgeRows[0]).toEqual([0, 3, 8])
    expect(adj.vertexToFaceRows[0]).toEqual([0, 2, 5])
    // 角点 6 = (1,1,1)：边 e5(5-6)、e6(6-7)、e10(2-6)；面 top/right/back
    expect(adj.vertexToEdgeRows[6]).toEqual([5, 6, 10])
    expect(adj.vertexToFaceRows[6]).toEqual([1, 3, 4])
    // 列表按表序升序
    for (const list of [...adj.vertexToEdgeRows, ...adj.vertexToFaceRows]) {
      const sorted = [...list].sort((a, b) => a - b)
      expect(list).toEqual(sorted)
    }
  })

  it('多段折线边（圆周 4 段闭合）：中间顶点也属于该边', () => {
    const edgePositions = new Float32Array([
      1, 0, 0, 0, 1, 0, -1, 0, 0, 0, -1, 0,
    ])
    const edgeIndices = new Uint32Array([0, 1, 1, 2, 2, 3, 3, 0])
    const edgeFaceRows = new Uint32Array([0, 1])
    const edges = makeEdges([{ segStart: 0, segCount: 4, faceStart: 0, faceCount: 2 }])

    const adj = buildVertexAdjacency(makeProxy(edgePositions, edgeIndices, edgeFaceRows), edges)

    expect(adj.vertexToEdgeRows).toHaveLength(4)
    for (let v = 0; v < 4; v++) {
      expect(adj.vertexToEdgeRows[v]).toEqual([0])
      expect(adj.vertexToFaceRows[v]).toEqual([0, 1])
    }
  })

  it('容差去重：坐标差 1e-9 的共享端点归并到同一顶点行', () => {
    const edgePositions = new Float32Array([
      0, 0, 0, 1, 0, 0,
      1 + 1e-9, 0, 0, 1, 1, 0,
    ])
    const edgeIndices = new Uint32Array([0, 1, 2, 3])
    const edgeFaceRows = new Uint32Array([0, 1])
    const edges = makeEdges([
      { segStart: 0, segCount: 1, faceStart: 0, faceCount: 1 },
      { segStart: 1, segCount: 1, faceStart: 1, faceCount: 1 },
    ])

    const adj = buildVertexAdjacency(makeProxy(edgePositions, edgeIndices, edgeFaceRows), edges)

    // 位置 1 与位置 2 归并 → 3 个顶点，中间顶点属两条边
    expect(adj.vertexToEdgeRows).toHaveLength(3)
    expect(adj.vertexToEdgeRows[0]).toEqual([0])
    expect(adj.vertexToEdgeRows[1]).toEqual([0, 1])
    expect(adj.vertexToEdgeRows[2]).toEqual([1])
    expect(adj.vertexToFaceRows[1]).toEqual([0, 1])
  })

  it('空边表：产出空数组，不长零元素行数组', () => {
    const adj = buildVertexAdjacency(
      makeProxy(new Float32Array(), new Uint32Array(), []),
      [],
    )
    expect(adj.vertexToEdgeRows).toEqual([])
    expect(adj.vertexToFaceRows).toEqual([])
  })

  it('无面关系时：顶点行存在但面列表为空', () => {
    const edgePositions = new Float32Array([0, 0, 0, 1, 0, 0])
    const edgeIndices = new Uint32Array([0, 1])
    const edges = makeEdges([{ segStart: 0, segCount: 1, faceStart: 0, faceCount: 0 }])
    const adj = buildVertexAdjacency(makeProxy(edgePositions, edgeIndices, []), edges)
    expect(adj.vertexToEdgeRows).toEqual([[0], [0]])
    expect(adj.vertexToFaceRows).toEqual([[], []])
  })
})

/** 手构 bundle（与 build-selector-runtime.test.ts 同风格，扩展为 box 线框语义的两边两顶点）。 */
function makeBundle(): SelectorBundle {
  const columns = {
    occurrenceColumns: ['id', 'name'],
    shapeColumns: ['id', 'kind', 'occurrenceId', 'volume'],
    faceColumns: ['id', 'surfaceType', 'area', 'center', 'edgeStart', 'edgeCount'],
    edgeColumns: ['id', 'curveType', 'length', 'center', 'faceStart', 'faceCount'],
  }
  return {
    manifest: {
      cadRef: 'test/part.step',
      stepHash: 'h1',
      bbox: { min: [0, 0, 0], max: [10, 10, 10] },
      ...columns,
      tables: { ...columns },
      occurrenceIds: ['occ1'],
      occurrences: [['occ1', 'Part A']],
      shapes: [['s1', 'solid', 'occ1', 100]],
      faces: [['f1', 'plane', 25, [5, 5, 10], 0, 1]],
      edges: [['e1', 'line', 10, [5, 0, 10], 0, 1]],
      relations: {
        faceEdgeRows: new Uint32Array([0, 1]),
        edgeFaceRows: new Uint32Array([0, 1]),
        faceEdgeRowsView: 'faceEdgeRows',
        edgeFaceRowsView: 'edgeFaceRows',
      },
      edgeProxy: { positionsView: 'edgePos', indicesView: 'edgeIdx', edgeIdsView: 'edgeIds' },
      faceProxy: {
        runsView: 'faceRuns',
        runColumns: ['occurrenceRow', 'primitiveIndex', 'triangleStart', 'triangleCount', 'faceRow'],
      },
    } as never,
    buffers: {
      edgePos: new Float32Array([0, 0, 10, 10, 0, 10]),
      edgeIdx: new Uint32Array([0, 1]),
      edgeIds: new Uint32Array([7]),
      faceRuns: new Uint32Array([0, 0, 0, 1, 0]),
    } as never,
  }
}

describe('runtime 挂接', () => {
  it('buildSelectorRuntimeData 产物带 vertexAdjacency 且与顶点表行数一致', () => {
    const data: SelectorRuntimeData = buildSelectorRuntimeData(makeBundle(), { scale: 1 })
    expect(data.vertexAdjacency).toBeDefined()
    // 一条边、两个端点 → 2 顶点行，各属该边；faceCount=1 → 只邻面 0
    expect(data.vertices).toHaveLength(2)
    expect(data.vertexAdjacency!.vertexToEdgeRows).toEqual([[0], [0]])
    expect(data.vertexAdjacency!.vertexToFaceRows).toEqual([[0], [0]])
    expect(data.vertexAdjacency!.vertexToEdgeRows).toHaveLength(data.vertices.length)
  })

  it('buildSelectorRuntimeMaps 通过展开继承 vertexAdjacency', () => {
    const data = buildSelectorRuntimeData(makeBundle(), { scale: 1 })
    const rt = buildSelectorRuntimeMaps(data)
    expect(rt.vertexAdjacency).toBe(data.vertexAdjacency)
  })
})