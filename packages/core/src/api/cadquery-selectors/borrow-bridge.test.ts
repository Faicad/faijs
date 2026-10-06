/**
 * borrow-bridge.asBrepShape — the real-Shape and fromHandle branches need an
 * OCCT/kernel present; here we lock the two passthrough branches that must never
 * reinterpret their input.
 */
import { describe, it, expect } from 'vitest'
import { asBrepShape } from './borrow-bridge'

describe('asBrepShape', () => {
  it('passes through an arbitrary non-shape, non-view value unchanged', () => {
    const value = { foo: 1, bar: [1, 2] }
    expect(asBrepShape(value)).toBe(value)
    expect(asBrepShape(123)).toBe(123)
    expect(asBrepShape('string')).toBe('string')
  })

  it('passes through null and undefined unchanged', () => {
    expect(asBrepShape(null)).toBeNull()
    expect(asBrepShape(undefined)).toBeUndefined()
  })

  it('does not unwrap an object that is not a borrowed view', () => {
    // no `wrapped` key → passthrough, same reference
    const v = { type: 'plane' }
    expect(asBrepShape(v)).toBe(v)
  })
})