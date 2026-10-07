/**
 * P3 combinator-surface regression test (2026-09-25 core-decouple rewrite).
 *
 * The brepjsCompat namespace is deleted with the old tree; the pure
 * combinators it projected (Result / vector / plane / errors / constants) were
 * inlined into the core facade (§5.2) and remain flat-exported from
 * '@faicad/faijs'. This test pins those inlined combinators.
 *
 * L1: all inlined combinator symbols exist (typeof check)
 * L3: key functions produce expected results
 */
import { describe, expect, it } from 'vitest'
import {
  ok, err, isOk, isErr, unwrap, unwrapOr, map, andThen,
  vecAdd, vecSub, vecScale, vecDot, vecCross, vecLength, vecNormalize,
  createPlane, createNamedPlane, resolvePlane,
  kernelError, validationError,
  DEG2RAD, RAD2DEG,
} from '@faicad/faijs'

describe('P3 L1 — inlined combinator surface exists', () => {
  // ④ combinators / pure helpers (inlined into core, §5.2)
  const surface = {
    ok, err, isOk, isErr, unwrap, unwrapOr, map, andThen,
    vecAdd, vecSub, vecScale, vecDot, vecCross, vecLength, vecNormalize,
    createPlane, createNamedPlane, resolvePlane,
    kernelError, validationError,
    DEG2RAD, RAD2DEG,
  } as const

  for (const [name, value] of Object.entries(surface)) {
    it(`core facade exports ${name}`, () => {
      expect(typeof value).not.toBe('undefined')
    })
  }
})

describe('P3 L3 — key function equivalence', () => {
  it('ok(7) returns Ok with value 7', () => {
    const result = ok(7) as { ok: true; value: number }
    expect(result.ok).toBe(true)
    expect(result.value).toBe(7)
  })

  it('err("test") returns Err with error "test"', () => {
    const result = err('test') as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toBe('test')
  })

  it('isOk(ok(1)) is true', () => {
    expect(isOk(ok(1))).toBe(true)
  })

  it('isErr(err("x")) is true', () => {
    expect(isErr(err('x'))).toBe(true)
  })

  it('DEG2RAD is Math.PI / 180', () => {
    expect(DEG2RAD).toBeCloseTo(Math.PI / 180)
  })

  it('RAD2DEG is 180 / Math.PI', () => {
    expect(RAD2DEG).toBeCloseTo(180 / Math.PI)
  })

  it('vecAdd([1,2,3],[4,5,6]) returns [5,7,9]', () => {
    const result = vecAdd([1, 2, 3], [4, 5, 6])
    expect(Array.from(result)).toEqual([5, 7, 9])
  })

  it('vecLength([3,4,0]) returns 5', () => {
    const result = vecLength([3, 4, 0]) as number
    expect(result).toBeCloseTo(5)
  })
})
