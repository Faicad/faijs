/**
 * fillet unit tests — parameter validation (assertFilletParams)
 *
 * Tests the parameter validation layer in isolation (no OCCT kernel needed).
 * Error code coverage: E_FILLET_NO_EDGES, E_FILLET_BAD_EDGE_REF, E_FILLET_BAD_RADIUS.
 */

import { describe, it, expect } from 'vitest'
import { assertFilletParams } from './fillet'

describe('assertFilletParams', () => {
  it('valid params pass', () => {
    const validEdge = {
      kind: 'edge' as const,
      faces: [
        { origin: 'part0', role: 'box:top' },
        { origin: 'part0', role: 'box:front' },
      ],
      hint: { kind: 'edge' },
    }
    expect(() => assertFilletParams({ edges: [validEdge], radius: 2 })).not.toThrow()
  })

  it('empty edges → E_FILLET_NO_EDGES', () => {
    expect(() => assertFilletParams({ edges: [], radius: 2 })).toThrow(/E_FILLET_NO_EDGES/)
  })

  it('missing edges → E_FILLET_NO_EDGES', () => {
    expect(() => assertFilletParams({ radius: 2 })).toThrow(/E_FILLET_NO_EDGES/)
  })

  it('edge without kind → E_FILLET_BAD_EDGE_REF', () => {
    expect(() => assertFilletParams({
      edges: [{ faces: [{ origin: 'a', role: 'r1' }, { origin: 'a', role: 'r2' }] }],
      radius: 2,
    })).toThrow(/E_FILLET_BAD_EDGE_REF/)
  })

  it('edge with wrong kind → E_FILLET_BAD_EDGE_REF', () => {
    expect(() => assertFilletParams({
      edges: [{ kind: 'face', faces: [{ origin: 'a', role: 'r1' }, { origin: 'a', role: 'r2' }] }],
      radius: 2,
    })).toThrow(/E_FILLET_BAD_EDGE_REF/)
  })

  it('edge with missing faces → E_FILLET_BAD_EDGE_REF', () => {
    expect(() => assertFilletParams({
      edges: [{ kind: 'edge', hint: { kind: 'edge' } }],
      radius: 2,
    })).toThrow(/E_FILLET_BAD_EDGE_REF/)
  })

  it('edge with one face → E_FILLET_BAD_EDGE_REF', () => {
    expect(() => assertFilletParams({
      edges: [{ kind: 'edge', faces: [{ origin: 'a', role: 'r1' }] }],
      radius: 2,
    })).toThrow(/E_FILLET_BAD_EDGE_REF/)
  })

  it('radius <= 0 → E_FILLET_BAD_RADIUS', () => {
    const validEdge = {
      kind: 'edge' as const,
      faces: [
        { origin: 'part0', role: 'box:top' },
        { origin: 'part0', role: 'box:front' },
      ],
      hint: { kind: 'edge' },
    }
    expect(() => assertFilletParams({ edges: [validEdge], radius: 0 })).toThrow(/E_FILLET_BAD_RADIUS/)
    expect(() => assertFilletParams({ edges: [validEdge], radius: -1 })).toThrow(/E_FILLET_BAD_RADIUS/)
  })

  it('radius NaN/Infinity → E_FILLET_BAD_RADIUS', () => {
    const validEdge = {
      kind: 'edge' as const,
      faces: [
        { origin: 'part0', role: 'box:top' },
        { origin: 'part0', role: 'box:front' },
      ],
      hint: { kind: 'edge' },
    }
    expect(() => assertFilletParams({ edges: [validEdge], radius: NaN })).toThrow(/E_FILLET_BAD_RADIUS/)
    expect(() => assertFilletParams({ edges: [validEdge], radius: Infinity })).toThrow(/E_FILLET_BAD_RADIUS/)
  })

  it('missing radius → E_FILLET_BAD_RADIUS', () => {
    const validEdge = {
      kind: 'edge' as const,
      faces: [
        { origin: 'part0', role: 'box:top' },
        { origin: 'part0', role: 'box:front' },
      ],
      hint: { kind: 'edge' },
    }
    expect(() => assertFilletParams({ edges: [validEdge] })).toThrow(/E_FILLET_BAD_RADIUS/)
  })
})
