import { describe, it, expect } from 'vitest'
import { axisFromFace } from '../../../src/api/assembly/lower'

describe('axisFromFace', () => {
  it('encodes the outward normal as the axis direction when flip=false', () => {
    const a = axisFromFace({ center: [1, 2, 3], normal: [0, 0, 1] }, false)
    expect(a).toEqual({ type: 'axis', origin: [1, 2, 3], direction: [0, 0, 1] })
  })

  it('negates the normal when flip=true (mate encoding)', () => {
    const a = axisFromFace({ center: [1, 2, 3], normal: [0, 0, 1] }, true)
    // -0 === 0 in value, so compare numerically
    expect(a.direction![0]).toBeCloseTo(0)
    expect(a.direction![1]).toBeCloseTo(0)
    expect(a.direction![2]).toBeCloseTo(-1)
    expect(a.origin).toEqual([1, 2, 3])
  })

  it('flips a negative-facing normal to positive', () => {
    const a = axisFromFace({ center: [0, 0, 0], normal: [1, 0, 0] }, true)
    expect(a.direction![0]).toBeCloseTo(-1)
    expect(a.direction![1]).toBeCloseTo(0)
    expect(a.direction![2]).toBeCloseTo(0)
  })
})