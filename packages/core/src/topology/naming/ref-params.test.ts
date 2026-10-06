import { describe, it, expect } from 'vitest'
import { isTopoRef, resolveTopoValue } from './ref-params'
import { TopoRefError } from './types'

describe('isTopoRef', () => {
  it('recognizes the four TopoRef kinds', () => {
    expect(isTopoRef({ kind: 'face', origin: 'p' })).toBe(true)
    expect(isTopoRef({ kind: 'edge' })).toBe(true)
    expect(isTopoRef({ kind: 'vertex' })).toBe(true)
    expect(isTopoRef({ kind: 'derived-face' })).toBe(true)
  })
  it('rejects non-objects, null, arrays, and other kinds', () => {
    expect(isTopoRef(null)).toBe(false)
    expect(isTopoRef(undefined)).toBe(false)
    expect(isTopoRef('face')).toBe(false)
    expect(isTopoRef(42)).toBe(false)
    expect(isTopoRef([{ kind: 'face' }])).toBe(false)
    expect(isTopoRef({ kind: 'body' })).toBe(false)
    expect(isTopoRef({})).toBe(false)
  })
})

describe('resolveTopoValue', () => {
  const NO_LOOKUP = () => undefined

  it('throws TopoRefError when the ref origin has no input shape', () => {
    expect(() => resolveTopoValue({ kind: 'face', origin: 'ghost' }, NO_LOOKUP)).toThrowError(
      TopoRefError,
    )
  })

  it('recurses through arrays and plain objects, resolving leaf TopoRefs', () => {
    // no topo refs → unchanged structure
    const input = { blend: { radius: 2, edges: [[1, 2], 3] }, tag: 'x' }
    expect(resolveTopoValue(input, NO_LOOKUP)).toEqual(input)
    // array root
    expect(resolveTopoValue([1, { a: [true, null] }], NO_LOOKUP)).toEqual([1, { a: [true, null] }])
  })

  it('leaves primitives unchanged', () => {
    expect(resolveTopoValue('hi', NO_LOOKUP)).toBe('hi')
    expect(resolveTopoValue(7, NO_LOOKUP)).toBe(7)
    expect(resolveTopoValue(null, NO_LOOKUP)).toBeNull()
    expect(resolveTopoValue(undefined, NO_LOOKUP)).toBeUndefined()
  })

  it('enters nested objects and arrays to find topo refs', () => {
    // a nested face ref with an origin that has no input → throws, proving recursion reached it
    expect(() =>
      resolveTopoValue({ level: { items: [{ ref: { kind: 'face', origin: 'nope' } }] } }, NO_LOOKUP),
    ).toThrowError(/origin "nope" has no input shape/)
  })
})