/**
 * ExecutionResult 拓扑数据测试 — E13
 */
import { describe, it, expect } from 'vitest'
import { CadRuntime } from './runtime'
import type { HostPorts } from './ports'
import type { SelectorRuntimeData } from '../topology/build-selector-runtime'

describe('E13: ExecutionResult 携带拓扑数据', () => {
  it('setTopology / getTopology 基本读写', () => {
    const ports: HostPorts = {
      events: { emit: () => {} },
    }
    const runtime = new CadRuntime(ports)

    const mockData: SelectorRuntimeData = {
      cadPath: '',
      stepHash: '',
      bbox: null,
      occurrences: [],
      shapes: [],
      faces: [],
      edges: [],
      vertices: [],
      references: [],
      singleOccurrenceId: '',
      proxy: {
        faceRuns: new Uint32Array(),
        faceRunColumns: [],
        edgePositions: new Float32Array(),
        edgeIndices: new Uint32Array(),
        edgeIds: new Uint32Array(),
        faceEdgeRows: [],
        edgeFaceRows: [],
        allPointPositions: new Float32Array(),
        allPointTypes: new Uint8Array(),
        allPointRefIndices: new Uint32Array(),
        vertexPointCount: 0,
        edgeMidCount: 0,
        faceCenterCount: 0,
      },
    }

    runtime.setTopology('part0_v0', 'brep', mockData)
    const topo = runtime.getTopology('part0_v0')
    expect(topo).toBeDefined()
    expect(topo!.source).toBe('brep')
    expect(topo!.partId).toBe('part0_v0')
    expect(topo!.data).toBe(mockData)
  })

  it('getTopology 返回 undefined 当不存在', () => {
    const ports: HostPorts = {
      events: { emit: () => {} },
    }
    const runtime = new CadRuntime(ports)
    expect(runtime.getTopology('nonexistent')).toBeUndefined()
  })

  it('deleteTopology 删除后返回 undefined', () => {
    const ports: HostPorts = {
      events: { emit: () => {} },
    }
    const runtime = new CadRuntime(ports)
    const mockData: SelectorRuntimeData = {
      cadPath: '', stepHash: '', bbox: null,
      occurrences: [], shapes: [], faces: [], edges: [], vertices: [],
      references: [], singleOccurrenceId: '',
      proxy: {
        faceRuns: new Uint32Array(), faceRunColumns: [],
        edgePositions: new Float32Array(), edgeIndices: new Uint32Array(),
        edgeIds: new Uint32Array(), faceEdgeRows: [], edgeFaceRows: [],
        allPointPositions: new Float32Array(), allPointTypes: new Uint8Array(),
        allPointRefIndices: new Uint32Array(), vertexPointCount: 0,
        edgeMidCount: 0, faceCenterCount: 0,
      },
    }
    runtime.setTopology('part0_v0', 'mesh', mockData)
    expect(runtime.getTopology('part0_v0')).toBeDefined()
    runtime.deleteTopology('part0_v0')
    expect(runtime.getTopology('part0_v0')).toBeUndefined()
  })

  it('dispose 清理拓扑缓存', () => {
    const ports: HostPorts = {
      events: { emit: () => {} },
    }
    const runtime = new CadRuntime(ports)
    const mockData: SelectorRuntimeData = {
      cadPath: '', stepHash: '', bbox: null,
      occurrences: [], shapes: [], faces: [], edges: [], vertices: [],
      references: [], singleOccurrenceId: '',
      proxy: {
        faceRuns: new Uint32Array(), faceRunColumns: [],
        edgePositions: new Float32Array(), edgeIndices: new Uint32Array(),
        edgeIds: new Uint32Array(), faceEdgeRows: [], edgeFaceRows: [],
        allPointPositions: new Float32Array(), allPointTypes: new Uint8Array(),
        allPointRefIndices: new Uint32Array(), vertexPointCount: 0,
        edgeMidCount: 0, faceCenterCount: 0,
      },
    }
    runtime.setTopology('part0_v0', 'brep', mockData)
    runtime.dispose()
    expect(runtime.getTopology('part0_v0')).toBeUndefined()
  })
})
