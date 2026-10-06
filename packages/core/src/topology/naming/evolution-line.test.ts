import { describe, it, expect } from 'vitest'
import { isHashEvolution } from './lineage'
import type { EvolutionRecord } from './lineage'

describe('isHashEvolution', () => {
  it('returns false for the ordinal-key Map form', () => {
    const m = new Map<number, number[]>()
    expect(isHashEvolution(m)).toBe(false)
  })

  it('returns true for a HashEvolution-shaped record', () => {
    expect(isHashEvolution({ modified: new Map(), deleted: new Set() })).toBe(true)
  })

  it('returns false when only one of the two markers is present', () => {
    expect(isHashEvolution({ modified: new Map() } as unknown as EvolutionRecord)).toBe(false)
    expect(isHashEvolution({ deleted: new Set() } as unknown as EvolutionRecord)).toBe(false)
  })
})