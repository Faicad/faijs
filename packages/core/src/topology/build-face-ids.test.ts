import { describe, it, expect } from 'vitest'
import { buildFaceIdsForPart, TOPOLOGY_FACE_ID_NONE } from './build-face-ids'

function makeRuntime(opts: {
  runs: Uint32Array
  columns?: string[]
  occurrence?: Map<number, string>
}): any {
  return {
    proxy: {
      faceRuns: opts.runs,
      ...(opts.columns ? { faceRunColumns: opts.columns } : {}),
    },
    occurrenceIdByRowIndex: opts.occurrence ?? new Map<number, string>(),
  }
}

describe('buildFaceIdsForPart', () => {
  it('returns null when there are no face runs or triangles', () => {
    const r = makeRuntime({ runs: new Uint32Array() })
    expect(buildFaceIdsForPart({ occurrenceId: 'a', primitiveIndex: 0, triangleCount: 3 }, r)).toBeNull()
    const r2 = makeRuntime({ runs: new Uint32Array([0, 0, 0, 6, 1]) })
    expect(buildFaceIdsForPart({ occurrenceId: '', primitiveIndex: 0, triangleCount: 3 }, r2)).toBeNull()
  })

  it('labels the triangles of a matching face run with the faceRow', () => {
    // columns: occurrenceRow, primitiveIndex, triangleStart, triangleCount, faceRow
    const runs = new Uint32Array([
      0, 0, 0, 6, 7, // occurrence 0, prim 0, tris 0..5 → faceId 7
    ])
    const r = makeRuntime({
      runs,
      occurrence: new Map([[0, 'partA']]),
    })
    const ids = buildFaceIdsForPart({ occurrenceId: 'partA', primitiveIndex: 0, triangleCount: 6 }, r)
    expect(ids).not.toBeNull()
    if (!ids) return
    expect(ids[0]).toBe(7)
    expect(ids[5]).toBe(7)
  })

  it('leaves triangles outside a run as TOPOLOGY_FACE_ID_NONE', () => {
    const runs = new Uint32Array([
      0, 0, 2, 3, 9, // occurrence 0, prim 0, triangles 2..4 → faceId 9
    ])
    const r = makeRuntime({
      runs,
      occurrence: new Map([[0, 'partA']]),
    })
    const ids = buildFaceIdsForPart({ occurrenceId: 'partA', primitiveIndex: 0, triangleCount: 6 }, r)
    expect(ids).not.toBeNull()
    if (!ids) return
    expect(ids[0]).toBe(TOPOLOGY_FACE_ID_NONE)
    expect(ids[1]).toBe(TOPOLOGY_FACE_ID_NONE)
    expect(ids[2]).toBe(9)
    expect(ids[4]).toBe(9)
    expect(ids[5]).toBe(TOPOLOGY_FACE_ID_NONE)
  })

  it('skips runs belonging to a different occurrence id or primitive', () => {
    const runs = new Uint32Array([
      1, 5, 0, 3, 2, // occurrenceRow 1 (='partB'), prim 5
    ])
    const r = makeRuntime({
      runs,
      occurrence: new Map([[1, 'partB']]),
    })
    // asking for partA/prim 0 → no match → null
    expect(buildFaceIdsForPart({ occurrenceId: 'partA', primitiveIndex: 0, triangleCount: 3 }, r)).toBeNull()
  })

  it('respects a custom faceRunColumns ordering', () => {
    const runs = new Uint32Array([
      3, 0, 0, 4, 11, // triangleStart, prim, occRow, triCount, faceRow (custom order)
    ])
    const r = makeRuntime({
      runs,
      columns: ['triangleStart', 'primitiveIndex', 'occurrenceRow', 'triangleCount', 'faceRow'],
      occurrence: new Map([[0, 'partX']]),
    })
    const ids = buildFaceIdsForPart({ occurrenceId: 'partX', primitiveIndex: 0, triangleCount: 4 }, r)
    expect(ids).not.toBeNull()
    if (!ids) return
    expect(ids[3]).toBe(11)
    expect(ids[2]).toBe(TOPOLOGY_FACE_ID_NONE)
  })
})