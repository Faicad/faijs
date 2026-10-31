/**
 * PMI types & serialization tests.
 *
 * Verifies that:
 * 1. Factory functions produce correctly discriminated PmiItem objects.
 * 2. PMI items are JSON-serializable (pure data, no functions).
 * 3. Round-trip JSON serialization preserves all fields.
 * 4. PmiSet structure is correct.
 */

import { describe, it, expect } from 'vitest'
import {
  dimension, gdt, datum, surfaceFinish, note,
  type PmiItem, type PmiDimension, type PmiGdt, type PmiDatum,
  type PmiSurfaceFinish, type PmiNote, type PmiSet,
} from '../../../src/api/pmi/types'
import type { FaceTopoRef } from '../../../src/topology/naming/types'

// ── Test fixtures ──

const faceRef: FaceTopoRef = {
  kind: 'face',
  origin: 's1' as never,
  role: 'top',
  hint: { kind: 'face', surfaceType: 'plane', normal: [0, 0, 1] },
}

const edgeRef = {
  kind: 'edge' as const,
  faces: [
    { origin: 's1' as never, role: 'top' },
    { origin: 's1' as never, role: 'front' },
  ] as const,
  hint: { kind: 'edge' as const, length: 30 },
}

describe('PMI types: factory functions', () => {
  it('dimension() produces kind=dimension', () => {
    const d = dimension({
      dimType: 'diameter',
      targets: [faceRef],
      upperTolerance: 0.021,
      lowerTolerance: 0,
    })
    expect(d.kind).toBe('dimension')
    expect(d.dimType).toBe('diameter')
    expect(d.targets).toHaveLength(1)
    expect(d.upperTolerance).toBe(0.021)
    expect(d.lowerTolerance).toBe(0)
  })

  it('gdt() produces kind=gdt', () => {
    const g = gdt({
      gdtType: 'perpendicularity',
      target: faceRef,
      tolerance: 0.05,
      datums: ['A'],
    })
    expect(g.kind).toBe('gdt')
    expect(g.gdtType).toBe('perpendicularity')
    expect(g.tolerance).toBe(0.05)
    expect(g.datums).toEqual(['A'])
  })

  it('datum() produces kind=datum', () => {
    const d = datum({
      identifier: 'A',
      datumType: 'datumPlane',
      target: faceRef,
    })
    expect(d.kind).toBe('datum')
    expect(d.identifier).toBe('A')
    expect(d.datumType).toBe('datumPlane')
  })

  it('surfaceFinish() produces kind=surfaceFinish', () => {
    const sf = surfaceFinish({
      target: faceRef,
      parameter: 'Ra',
      value: 1.6,
    })
    expect(sf.kind).toBe('surfaceFinish')
    expect(sf.parameter).toBe('Ra')
    expect(sf.value).toBe(1.6)
  })

  it('note() produces kind=note', () => {
    const n = note({ text: '未注公差按 GB/T 1804-m' })
    expect(n.kind).toBe('note')
    expect(n.text).toBe('未注公差按 GB/T 1804-m')
    expect(n.target).toBeUndefined()
  })

  it('note() with target and anchor', () => {
    const n = note({
      text: 'Critical surface',
      target: faceRef,
      anchor: [10, 20, 30],
    })
    expect(n.target).toBeDefined()
    expect(n.anchor).toEqual([10, 20, 30])
  })
})

describe('PMI types: JSON serialization', () => {
  it('all PmiItem kinds are JSON-serializable', () => {
    const items: PmiItem[] = [
      dimension({ dimType: 'linear', targets: [faceRef, faceRef] }),
      gdt({ gdtType: 'flatness', target: faceRef, tolerance: 0.02 }),
      datum({ identifier: 'B', datumType: 'datumPlane', target: faceRef }),
      surfaceFinish({ target: faceRef, parameter: 'Rz', value: 3.2 }),
      note({ text: 'Test note', target: edgeRef as never }),
    ]
    for (const item of items) {
      const json = JSON.stringify(item)
      const parsed = JSON.parse(json)
      expect(parsed.kind).toBe(item.kind)
    }
  })

  it('PmiSet round-trip preserves all fields', () => {
    const set: PmiSet = {
      items: [
        dimension({
          dimType: 'diameter',
          targets: [faceRef],
          upperTolerance: 0.021,
          lowerTolerance: 0,
          formatSpec: '%.2f H7',
          theoreticalExact: false,
        }),
        gdt({
          gdtType: 'perpendicularity',
          target: faceRef,
          tolerance: 0.05,
          datums: ['A', 'B'],
          materialCondition: 'MMC',
        }),
      ],
      meta: { source: 'faijs', standard: 'ISO' },
    }
    const json = JSON.stringify(set)
    const parsed: PmiSet = JSON.parse(json)
    expect(parsed.items).toHaveLength(2)
    expect(parsed.items[0].kind).toBe('dimension')
    expect(parsed.items[1].kind).toBe('gdt')
    expect(parsed.meta?.source).toBe('faijs')
    expect(parsed.meta?.standard).toBe('ISO')
  })

  it('factory functions add kind without mutation', () => {
    const input = { dimType: 'linear' as const, targets: [faceRef] as readonly FaceTopoRef[] }
    const d = dimension(input)
    expect(d.kind).toBe('dimension')
    // input should not have kind
    expect((input as { kind?: string }).kind).toBeUndefined()
  })
})

describe('PMI types: discriminator narrowing', () => {
  it('switch on kind narrows correctly', () => {
    const items: PmiItem[] = [
      dimension({ dimType: 'linear', targets: [faceRef] }),
      gdt({ gdtType: 'flatness', target: faceRef, tolerance: 0.02 }),
      datum({ identifier: 'A', datumType: 'datumPlane', target: faceRef }),
      surfaceFinish({ target: faceRef, parameter: 'Ra', value: 1.6 }),
      note({ text: 'hello' }),
    ]
    const kinds = items.map((item) => {
      switch (item.kind) {
        case 'dimension': return `dim:${item.dimType}`
        case 'gdt': return `gdt:${item.gdtType}`
        case 'datum': return `datum:${item.identifier}`
        case 'surfaceFinish': return `sf:${item.parameter}`
        case 'note': return `note:${item.text}`
      }
    })
    expect(kinds).toEqual(['dim:linear', 'gdt:flatness', 'datum:A', 'sf:Ra', 'note:hello'])
  })
})
