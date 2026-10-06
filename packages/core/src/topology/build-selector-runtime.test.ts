/**
 * topology/build-selector-runtime — direct coverage for buildSelectorRuntimeData /
 * buildSelectorRuntimeMaps.
 *
 * These build the serializable selector runtime and its Map indexes from a
 * `SelectorBundle` (parsed manifest + typed buffer views). Both are pure over
 * their inputs, so we drive them with a small hand-built bundle — no wasm.
 */
import { describe, it, expect } from 'vitest'
import {
  buildSelectorRuntimeData,
  buildSelectorRuntimeMaps,
  type SelectorRuntimeData,
} from './build-selector-runtime'
import type { SelectorBundle } from './types'

/** A minimal but shape-correct SelectorBundle for a one-part, one-shape model. */
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

describe('buildSelectorRuntimeData', () => {
  it('converts a manifest into a serializable runtime', () => {
    const data: SelectorRuntimeData = buildSelectorRuntimeData(makeBundle(), { scale: 1 })
    expect(data.cadPath).toBe('test/part.step')
    expect(data.bbox).not.toBeNull()
    expect(data.occurrences).toHaveLength(1)
    expect(data.shapes).toHaveLength(1)
    expect(data.faces).toHaveLength(1)
    expect(data.edges).toHaveLength(1)
    expect(data.proxy.edgeIndices[0]).toBe(0)
    expect(data.proxy.edgePositions[0]).toBe(0)
  })
})

describe('buildSelectorRuntimeMaps', () => {
  it('assembles Map indexes over the runtime data (single-part path)', () => {
    const bundle = makeBundle()
    const data = buildSelectorRuntimeData(bundle, { scale: 1 })
    const rt = buildSelectorRuntimeMaps(data)
    expect(rt.singleOccurrenceId).toBeTruthy()
    expect(rt.proxy).toBeTruthy()
  })
})