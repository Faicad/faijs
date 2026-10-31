/**
 * STEP PMI import tests.
 *
 * Verifies that:
 * 1. supportsXcafPmiRead returns false for regular XCAF documents.
 * 2. readPmiFromXCAF returns undefined when unsupported (graceful degradation).
 * 3. readPmiFromXCAF returns undefined for empty PMI.
 * 4. Type mapping functions produce correct faijs types from STEP strings.
 */

import { describe, it, expect } from 'vitest'
import { supportsXcafPmiRead, readPmiFromXCAF } from '../../src/brep/export/step-pmi-import'
import type { PmiSet } from '../../src/api/pmi/types'

describe('supportsXcafPmiRead', () => {
  it('returns false for plain object', () => {
    expect(supportsXcafPmiRead({})).toBe(false)
  })

  it('returns false for mock XCAF document without PMI methods', () => {
    const mockDoc = {
      addShape: () => 0,
      exportSTEP: () => '',
      close: () => {},
    }
    expect(supportsXcafPmiRead(mockDoc)).toBe(false)
  })

  it('returns true when getDimensions exists', () => {
    const mockDoc = { getDimensions: () => [] }
    expect(supportsXcafPmiRead(mockDoc)).toBe(true)
  })

  it('returns true when getGeomTolerances exists', () => {
    const mockDoc = { getGeomTolerances: () => [] }
    expect(supportsXcafPmiRead(mockDoc)).toBe(true)
  })

  it('returns true when getDatums exists', () => {
    const mockDoc = { getDatums: () => [] }
    expect(supportsXcafPmiRead(mockDoc)).toBe(true)
  })

  it('returns false for null/undefined', () => {
    expect(supportsXcafPmiRead(null)).toBe(false)
    expect(supportsXcafPmiRead(undefined)).toBe(false)
  })
})

describe('readPmiFromXCAF graceful degradation', () => {
  it('returns undefined when doc does not support PMI reading', () => {
    const mockDoc = { addShape: () => 0, exportSTEP: () => '' }
    const labelToTopoRef = new Map<number, never>()
    const result = readPmiFromXCAF(mockDoc, labelToTopoRef)
    expect(result).toBeUndefined()
  })

  it('returns undefined when no PMI items found (empty arrays)', () => {
    const mockDoc = {
      getDimensions: () => [],
      getGeomTolerances: () => [],
      getDatums: () => [],
    }
    const labelToTopoRef = new Map<number, never>()
    const result = readPmiFromXCAF(mockDoc, labelToTopoRef)
    expect(result).toBeUndefined()
  })

  it('returns PmiSet when PMI items are found', () => {
    const faceRef = {
      kind: 'face' as const,
      origin: 's1' as never,
      role: 'top',
      hint: { kind: 'face' as const },
    }
    const mockDoc = {
      getDimensions: () => [
        { label: 1, type: 'diameter', nominal: 30, upperTolerance: 0.021, lowerTolerance: 0 },
      ],
      getGeomTolerances: () => [
        { label: 1, type: 'flatness', tolerance: 0.02 },
      ],
      getDatums: () => [
        { label: 1, identifier: 'A', datumType: 'datumPlane' },
      ],
    }
    const labelToTopoRef = new Map<number, typeof faceRef>([[1, faceRef]])
    const result = readPmiFromXCAF(mockDoc, labelToTopoRef)
    expect(result).toBeDefined()
    expect(result!.items).toHaveLength(3)
    expect(result!.items[0].kind).toBe('dimension')
    expect(result!.items[1].kind).toBe('gdt')
    expect(result!.items[2].kind).toBe('datum')
    expect(result!.meta?.source).toBe('step-ap242')
  })

  it('skips items whose target is not in the label mapping', () => {
    const faceRef = {
      kind: 'face' as const,
      origin: 's1' as never,
      role: 'top',
      hint: { kind: 'face' as const },
    }
    const mockDoc = {
      getDimensions: () => [
        { label: 1, type: 'diameter', nominal: 30 },
        { label: 99, type: 'linear', nominal: 50 }, // label 99 not in map
      ],
      getGeomTolerances: () => [],
      getDatums: () => [],
    }
    const labelToTopoRef = new Map<number, typeof faceRef>([[1, faceRef]])
    const result = readPmiFromXCAF(mockDoc, labelToTopoRef)
    expect(result).toBeDefined()
    expect(result!.items).toHaveLength(1) // Only the mapped one
  })
})
