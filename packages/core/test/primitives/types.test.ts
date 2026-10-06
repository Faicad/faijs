import { describe, it, expect } from 'vitest'
import { nextPrimitiveColor, PRIMITIVE_COLORS } from '../../src/primitives/types'

describe('nextPrimitiveColor', () => {
  it('returns the colours of the palette in order', () => {
    const seen: ReturnType<typeof nextPrimitiveColor>[] = []
    for (let i = 0; i < PRIMITIVE_COLORS.length; i++) {
      seen.push(nextPrimitiveColor())
    }
    expect(seen).toEqual(PRIMITIVE_COLORS)
  })

  it('cycles / wraps around after exhausting the palette', () => {
    // consume one full cycle, the next call must wrap back to color[0]
    for (let i = 0; i < PRIMITIVE_COLORS.length; i++) nextPrimitiveColor()
    expect(nextPrimitiveColor()).toEqual(PRIMITIVE_COLORS[0])
  })

  it('returns opaque RGB triples in the expected 0..1 range', () => {
    const [r, g, b] = nextPrimitiveColor()
    for (const c of [r, g, b]) {
      expect(typeof c).toBe('number')
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(1)
    }
  })

  it('the palette is distinct and non-empty', () => {
    expect(PRIMITIVE_COLORS.length).toBeGreaterThan(0)
    const uniques = new Set(PRIMITIVE_COLORS.map((c) => c.join(',')))
    expect(uniques.size).toBe(PRIMITIVE_COLORS.length)
  })
})