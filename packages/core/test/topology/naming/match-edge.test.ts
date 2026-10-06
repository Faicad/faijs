import { describe, it, expect } from 'vitest'
import { matchEdgeByHint } from '../../../src/topology/naming/resolve-edge'

describe('matchEdgeByHint', () => {
  it('returns undefined when the hint carries neither length nor midpoint', () => {
    expect(matchEdgeByHint([{ ordinal: 1 }], { kind: 'edge' })).toBeUndefined()
  })

  it('picks the edge with the closest length to the hint', () => {
    const edges = [
      { ordinal: 1, hint: { length: 10 } },
      { ordinal: 2, hint: { length: 20 } },
      { ordinal: 3, hint: { length: 30 } },
    ]
    const best = matchEdgeByHint(edges, { kind: 'edge', length: 21 })
    expect(best?.ordinal).toBe(2)
  })

  it('returns undefined when the best and second-best are within margin (ambiguous)', () => {
    // identical geometry on both edges → both score 0 → cannot distinguish
    const edges = [
      { ordinal: 1, hint: { midpoint: [1, 1, 1] as readonly number[], length: 5 } },
      { ordinal: 2, hint: { midpoint: [1, 1, 1] as readonly number[], length: 5 } },
    ]
    expect(matchEdgeByHint(edges, { kind: 'edge', length: 5, midpoint: [1, 1, 1] })).toBeUndefined()
  })

  it('treats edges without a length hint as not length-eligible (only midpoint scores)', () => {
    const edges = [
      { ordinal: 1, hint: { length: 100, midpoint: [10, 0, 0] as readonly number[] } },
      { ordinal: 2, hint: { length: 100, midpoint: [0, 0, 0] as readonly number[] } },
    ]
    const best = matchEdgeByHint(edges, { kind: 'edge', midpoint: [0, 0, 0] })
    expect(best?.ordinal).toBe(2)
  })
})