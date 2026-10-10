import { describe, it, expect } from 'vitest'
import { axisFromFace, lowerStructuralConstraint } from '../../../src/api/assembly/lower'
import type { EntityResolutionEnv } from '../../../src/api/assembly/entities'
import type {
  FixedPointConstraint,
  FixedAxisConstraint,
  FixedRotationConstraint,
} from '../../../src/api/assembly/types'
import { asPartName } from '../../../src/identity'

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
describe('lowerStructuralConstraint: 世界锚定 unary 在 chain 路径明确报错', () => {
  const env: EntityResolutionEnv = { kernel: null, memberOf: () => undefined }

  it('fixedPoint/fixedAxis/fixedRotation 要求 global 求解器（绝不静默降级）', () => {
    const fp: FixedPointConstraint = {
      type: 'fixedPoint',
      a: { part: asPartName('p0'), point: [0, 0, 0] },
      world: [0, 0, -3],
    }
    const fa: FixedAxisConstraint = {
      type: 'fixedAxis',
      a: { part: asPartName('p0'), point: [0, 0, 0] },
      worldDir: [0, 1, 1],
    }
    const fr: FixedRotationConstraint = { type: 'fixedRotation', part: asPartName('p0') }
    for (const c of [fp, fa, fr]) {
      expect(() => lowerStructuralConstraint(c, env)).toThrow(/only supported by the 'global' solver/)
    }
  })
})