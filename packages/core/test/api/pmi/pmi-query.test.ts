/**
 * PMI query functions tests.
 *
 * Verifies that:
 * 1. pmiItems returns all items when no filter.
 * 2. pmiItems filters by kind.
 * 3. pmiItems filters by targetType.
 * 4. pmiOn returns items attached to a specific TopoRef.
 * 5. pmiOn returns empty for unattached refs.
 * 6. pmiDatums returns identifier → datum mapping.
 * 7. Empty shape returns empty results.
 */

import { describe, it, expect } from 'vitest'
import { solid } from '../../../src/shape'
import { pmiItems, pmiOn, pmiDatums } from '../../../src/api/pmi/query'
import type { FaceTopoRef, TopoRef } from '../../../src/topology/naming/types'

// ── Test fixtures ──

function makeShape() {
  return solid({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  })
}

const faceRefA: FaceTopoRef = {
  kind: 'face',
  origin: 's1' as never,
  role: 'top',
  hint: { kind: 'face', surfaceType: 'plane', normal: [0, 0, 1] },
}

const faceRefB: FaceTopoRef = {
  kind: 'face',
  origin: 's1' as never,
  role: 'bottom',
  hint: { kind: 'face', surfaceType: 'plane', normal: [0, 0, -1] },
}

const edgeRef: TopoRef = {
  kind: 'edge',
  faces: [
    { origin: 's1' as never, role: 'top' },
    { origin: 's1' as never, role: 'front' },
  ],
  hint: { kind: 'edge', length: 30 },
}

describe('pmiItems', () => {
  it('returns all items when no filter', () => {
    const s = makeShape()
    s.addDimension({ dimType: 'linear', targets: [faceRefA] })
    s.addGdt({ gdtType: 'flatness', target: faceRefA, tolerance: 0.02 })
    s.addGeneralNote({ items: [{ text: 'hello' }] })

    const items = pmiItems(s)
    expect(items).toHaveLength(3)
  })

  it('filters by kind=dimension', () => {
    const s = makeShape()
    s.addDimension({ dimType: 'linear', targets: [faceRefA] })
    s.addGdt({ gdtType: 'flatness', target: faceRefA, tolerance: 0.02 })
    s.addDimension({ dimType: 'diameter', targets: [faceRefB] })

    const dims = pmiItems(s, { kind: 'dimension' })
    expect(dims).toHaveLength(2)
    expect(dims.every((d) => d.kind === 'dimension')).toBe(true)
  })

  it('filters by kind=gdt', () => {
    const s = makeShape()
    s.addDimension({ dimType: 'linear', targets: [faceRefA] })
    s.addGdt({ gdtType: 'flatness', target: faceRefA, tolerance: 0.02 })

    const gdts = pmiItems(s, { kind: 'gdt' })
    expect(gdts).toHaveLength(1)
    expect(gdts[0].kind).toBe('gdt')
  })

  it('filters by targetType=face', () => {
    const s = makeShape()
    s.addDimension({ dimType: 'linear', targets: [faceRefA] })
    s.addLocalNote({ text: 'edge note', target: edgeRef })

    const faceItems = pmiItems(s, { targetType: 'face' })
    expect(faceItems).toHaveLength(1)
    expect(faceItems[0].kind).toBe('dimension')
  })

  it('returns empty for shape with no PMI', () => {
    const s = makeShape()
    expect(pmiItems(s)).toHaveLength(0)
  })
})

describe('pmiOn', () => {
  it('returns items attached to the given ref', () => {
    const s = makeShape()
    s.addDimension({ dimType: 'linear', targets: [faceRefA] })
    s.addGdt({ gdtType: 'flatness', target: faceRefA, tolerance: 0.02 })
    s.addDimension({ dimType: 'diameter', targets: [faceRefB] })

    const onA = pmiOn(s, faceRefA)
    expect(onA).toHaveLength(2)
    expect(onA.every((item) => item.kind === 'dimension' || item.kind === 'gdt')).toBe(true)
  })

  it('returns empty for unattached ref', () => {
    const s = makeShape()
    s.addDimension({ dimType: 'linear', targets: [faceRefA] })

    const onB = pmiOn(s, faceRefB)
    expect(onB).toHaveLength(0)
  })

  it('returns items with matching ref by reference equality', () => {
    const s = makeShape()
    s.addGdt({ gdtType: 'perpendicularity', target: faceRefA, tolerance: 0.05 })

    // Same object reference
    const onSameRef = pmiOn(s, faceRefA)
    expect(onSameRef).toHaveLength(1)
  })

  it('returns empty for shape with no PMI', () => {
    const s = makeShape()
    expect(pmiOn(s, faceRefA)).toHaveLength(0)
  })

  it('matches note with target', () => {
    const s = makeShape()
    s.addLocalNote({ text: 'face note', target: faceRefA })
    s.addGeneralNote({ items: [{ text: 'floating note' }] })

    const onFace = pmiOn(s, faceRefA)
    expect(onFace).toHaveLength(1)
    expect(onFace[0].kind).toBe('localNote')
  })
})

describe('pmiDatums', () => {
  it('returns identifier → datum mapping', () => {
    const s = makeShape()
    s.addDatum({ identifier: 'A', datumType: 'datumPlane', target: faceRefA })
    s.addDatum({ identifier: 'B', datumType: 'datumPlane', target: faceRefB })

    const datums = pmiDatums(s)
    expect(Object.keys(datums)).toHaveLength(2)
    expect(datums['A'].identifier).toBe('A')
    expect(datums['B'].identifier).toBe('B')
  })

  it('returns empty for shape with no datums', () => {
    const s = makeShape()
    s.addDimension({ dimType: 'linear', targets: [faceRefA] })

    const datums = pmiDatums(s)
    expect(Object.keys(datums)).toHaveLength(0)
  })

  it('returns empty for shape with no PMI', () => {
    const s = makeShape()
    expect(Object.keys(pmiDatums(s))).toHaveLength(0)
  })
})
