/**
 * PMI Shape methods tests.
 *
 * Verifies that:
 * 1. attachPmiMethods mounts all 7 methods on Shape instances.
 * 2. add* methods are chainable and produce correct PmiSet.
 * 3. getPmi returns the accumulated PmiSet.
 * 4. clearPmi empties the PMI set.
 * 5. Methods are idempotent (attachPmiMethods called twice = no-op).
 * 6. pmi field is JSON-serializable (methods dropped, data preserved).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { solid, type SolidShape } from '../../../src/shape'
import { attachPmiMethods } from '../../../src/api/pmi/methods'
import type { FaceTopoRef } from '../../../src/topology/naming/types'

// ── Test fixtures ──

function makeShape(): SolidShape {
  return solid({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  })
}

const faceRef: FaceTopoRef = {
  kind: 'face',
  origin: 's1' as never,
  role: 'top',
  hint: { kind: 'face', surfaceType: 'plane', normal: [0, 0, 1] },
}

describe('PMI Shape methods', () => {
  beforeEach(() => {
    // Runtime state is per-execution; WeakSet.clear() doesn't exist,
    // so we rely on each test creating fresh shapes.
  })

  it('attachPmiMethods mounts all 7 methods', () => {
    const s = makeShape()
    expect(typeof s.addDimension).toBe('function')
    expect(typeof s.addGdt).toBe('function')
    expect(typeof s.addDatum).toBe('function')
    expect(typeof s.addSurfaceFinish).toBe('function')
    expect(typeof s.addLocalNote).toBe('function')
    expect(typeof s.getPmi).toBe('function')
    expect(typeof s.clearPmi).toBe('function')
  })

  it('addDimension is chainable and adds to pmi', () => {
    const s = makeShape()
    const result = s.addDimension({
      dimType: 'diameter',
      targets: [faceRef],
      upperTolerance: 0.021,
      lowerTolerance: 0,
    })
    expect(result).toBe(s) // chainable: returns this
    const pmi = s.getPmi()
    expect(pmi.items).toHaveLength(1)
    expect(pmi.items[0].kind).toBe('dimension')
  })

  it('multiple add* calls accumulate', () => {
    const s = makeShape()
    s.addDimension({ dimType: 'linear', targets: [faceRef] })
    s.addGdt({ gdtType: 'flatness', target: faceRef, tolerance: 0.02 })
    s.addDatum({ identifier: 'A', datumType: 'datumPlane', target: faceRef })
    s.addSurfaceFinish({ target: faceRef, parameter: 'Ra', value: 1.6 })
    s.addGeneralNote({ items: [{ text: 'test note' }] })

    const pmi = s.getPmi()
    expect(pmi.items).toHaveLength(5)
    expect(pmi.items.map((i) => i.kind)).toEqual([
      'dimension', 'gdt', 'datum', 'surfaceFinish', 'generalNote',
    ])
  })

  it('chaining works across all add* methods', () => {
    const s = makeShape()
    s.addDimension({ dimType: 'linear', targets: [faceRef] })
      .addGdt({ gdtType: 'perpendicularity', target: faceRef, tolerance: 0.05 })
      .addDatum({ identifier: 'B', datumType: 'datumPlane', target: faceRef })
      .addGeneralNote({ items: [{ text: 'chained' }] })

    expect(s.getPmi().items).toHaveLength(4)
  })

  it('getPmi returns empty set when no PMI added', () => {
    const s = makeShape()
    const pmi = s.getPmi()
    expect(pmi.items).toHaveLength(0)
  })

  it('clearPmi empties the PMI set', () => {
    const s = makeShape()
    s.addDimension({ dimType: 'linear', targets: [faceRef] })
    s.addGeneralNote({ items: [{ text: 'test' }] })
    expect(s.getPmi().items).toHaveLength(2)

    s.clearPmi()
    expect(s.getPmi().items).toHaveLength(0)
  })

  it('clearPmi is chainable', () => {
    const s = makeShape()
    const result = s.clearPmi()
    expect(result).toBe(s)
  })

  it('attachPmiMethods is idempotent', () => {
    const s = makeShape()
    const before = s.addDimension
    attachPmiMethods(s)
    expect(s.addDimension).toBe(before) // same function reference
  })

  it('pmi field is JSON-serializable (methods dropped, data preserved)', () => {
    const s = makeShape()
    s.addDimension({ dimType: 'diameter', targets: [faceRef], upperTolerance: 0.021 })
      .addGdt({ gdtType: 'flatness', target: faceRef, tolerance: 0.02 })

    // Serialize: methods dropped, pmi data preserved
    const json = JSON.stringify(s, (key, value) => {
      // Drop TypedArrays and functions (JSON already drops functions)
      if (value instanceof Float32Array || value instanceof Uint32Array) return undefined
      return value
    })
    const parsed = JSON.parse(json)
    expect(parsed.pmi).toBeDefined()
    expect(parsed.pmi.items).toHaveLength(2)
    expect(parsed.pmi.items[0].kind).toBe('dimension')
    expect(parsed.pmi.items[1].kind).toBe('gdt')
    // Methods are NOT in JSON
    expect(parsed.addDimension).toBeUndefined()
    expect(parsed.getPmi).toBeUndefined()
  })
})
