/**
 * Predicates parity tests — cover every exported function and every parameter
 * of `predicates.ts` (pure 3-vector / EntityGeom predicates) plus the exported
 * grammar helpers. All targets here are pure and require no OCCT wasm init.
 */
import { describe, expect, it } from 'vitest'
import {
  DIR_TOLERANCE,
  NTH_TOLERANCE,
  isParallel,
  isPerpendicular,
  isAligned,
  isDirectionCandidate,
  typeMatches,
  entityDirection,
} from '../../../src/api/cadquery-selectors/predicates'
import { parseSelector, SYNTAX_FEATURES, NAMED_VIEW, AXES, TYPE_NAMES } from '../../../src/api/cadquery-selectors/grammar'
import type { EntityGeom, P3 } from '../../../src/api/cadquery-selectors/entity'

const X: P3 = { x: 1, y: 0, z: 0 }
const Y: P3 = { x: 0, y: 1, z: 0 }
const Z: P3 = { x: 0, y: 0, z: 1 }
// non-unit axes (grammar keeps them non-normalised, e.g. XY = (1,1,0))
const XY: P3 = { x: 1, y: 1, z: 0 }

describe('constants', () => {
  it('DIR_TOLERANCE matches upstream default 1e-4', () => {
    expect(DIR_TOLERANCE).toBe(1e-4)
  })
  it('NTH_TOLERANCE matches upstream _NthSelector tolerance', () => {
    expect(NTH_TOLERANCE).toBe(0.0001)
  })
})

describe('isParallel(dir, axis, tolerance)', () => {
  it('true for parallel unit vectors', () => {
    expect(isParallel(X, X)).toBe(true)
    expect(isParallel(Y, Y)).toBe(true)
  })
  it('true for anti-parallel vectors (|dot| ≈ 1)', () => {
    expect(isParallel(X, { x: -1, y: 0, z: 0 })).toBe(true)
    expect(isParallel(X, { x: -2, y: 0, z: 0 })).toBe(true)
  })
  it('true for scaled (non-unit) parallel vectors', () => {
    expect(isParallel(X, XY)).toBe(false) // 45° off, not parallel
    expect(isParallel({ x: 3, y: 0, z: 0 }, { x: -7, y: 0, z: 0 })).toBe(true)
  })
  it('false for perpendicular vectors', () => {
    expect(isParallel(X, Y)).toBe(false)
    expect(isParallel(Z, X)).toBe(false)
  })
  it('tolerance boundary: exact anti-parallel within default tol', () => {
    // |dot| = cos(angle); boundary of the default tolerance
    expect(isParallel(X, X, DIR_TOLERANCE)).toBe(true)
    expect(isParallel(X, Y, DIR_TOLERANCE)).toBe(false)
  })
  it('tolerance = 0 requires exact |dot| = 1', () => {
    expect(isParallel(X, X, 0)).toBe(true)
    expect(isParallel(X, { x: -1, y: 0, z: 0 }, 0)).toBe(true)
    // a non-unit vector parallel to axis still has |unitDot| = 1
    expect(isParallel({ x: 5, y: 0, z: 0 }, X, 0)).toBe(true)
  })
  it('small tolerance rejects anything off-axis', () => {
    expect(isParallel(X, XY, 1e-8)).toBe(false)
    expect(isParallel(X, X, 1e-8)).toBe(true)
  })
  it('large tolerance accepts wide cones', () => {
    // 45° off-axis, cos = ~0.7071 → |dot| = 0.7071; tol 0.3 passes (0.7071 >= 0.7)
    expect(isParallel(X, XY, 0.3)).toBe(true)
    // antisymmetric: 90° still not parallel even with big tolerance (< 1 - tol)
    expect(isParallel(X, Y, 0.3)).toBe(false)
  })
  it('zero vector: hypot=0 coerces to unit so dot stays 0 (no NaN)', () => {
    expect(isParallel({ x: 0, y: 0, z: 0 }, X)).toBe(false)
    expect(isParallel(X, { x: 0, y: 0, z: 0 })).toBe(false)
  })
})

describe('isPerpendicular(dir, axis, tolerance)', () => {
  it('true for perpendicular vectors', () => {
    expect(isPerpendicular(X, Y)).toBe(true)
    expect(isPerpendicular(X, Z)).toBe(true)
  })
  it('false for parallel vectors', () => {
    expect(isPerpendicular(X, X)).toBe(false)
    expect(isPerpendicular(X, { x: -3, y: 0, z: 0 })).toBe(false)
  })
  it('tolerance = 0 => exact orthogonality', () => {
    expect(isPerpendicular(X, Y, 0)).toBe(true)
    expect(isPerpendicular(X, X, 0)).toBe(false)
  })
  it('small tolerance rejects barely-off orthogonal', () => {
    // slight tilt off 90°
    const almostPerp: P3 = { x: 0.01, y: 1, z: 0 }
    expect(isPerpendicular(X, almostPerp, 1e-6)).toBe(false)
    expect(isPerpendicular(X, Y, 1e-6)).toBe(true)
  })
  it('large tolerance accepts near-orthogonal as perpendicular', () => {
    const nearPerp: P3 = { x: 0.5, y: 1, z: 0 } // ~26.6° off X
    expect(isPerpendicular(X, nearPerp)).toBe(false)
    expect(isPerpendicular(X, nearPerp, 0.5)).toBe(true)
  })
  it('zero vector coerced to unit (dot 0 => perpendicular)', () => {
    // unitDot of a zero vector coerces its length to 1, so fully-orthogonal
    // zero-vs-axis yields dot 0 → perpendicular true with default tol
    expect(isPerpendicular({ x: 0, y: 0, z: 0 }, Y)).toBe(true)
  })
})

describe('isAligned(dir, axis, sign, tolerance)', () => {
  it('sign=+1 matches positive axis', () => {
    expect(isAligned(X, X, 1)).toBe(true)
    expect(isAligned({ x: 2, y: 0, z: 0 }, X, 1)).toBe(true)
  })
  it('sign=-1 matches negative axis', () => {
    expect(isAligned({ x: -1, y: 0, z: 0 }, X, -1)).toBe(true)
    expect(isAligned({ x: -4, y: 0, z: 0 }, X, -1)).toBe(true)
  })
  it('sign +1 rejects opposite direction and perpendicular', () => {
    expect(isAligned({ x: -1, y: 0, z: 0 }, X, 1)).toBe(false)
    expect(isAligned(Y, X, 1)).toBe(false)
  })
  it('sign -1 rejects positive direction', () => {
    expect(isAligned(X, X, -1)).toBe(false)
  })
  it('sign boundary: sign=0 treated as positive (sign >= 0 branch)', () => {
    expect(isAligned(X, X, 0)).toBe(true)
  })
  it('non-{+1,-1} sign still selects branch by >= 0', () => {
    expect(isAligned({ x: -1, y: 0, z: 0 }, X, -5)).toBe(true)
    expect(isAligned(X, X, 5)).toBe(true)
  })
  it('tolerance=0 requires unit alignment', () => {
    expect(isAligned(X, X, 1, 0)).toBe(true)
    expect(isAligned(X, XY, 1, 0)).toBe(false) // 45° off
  })
  it('large tolerance accepts slightly-tilted aligned direction', () => {
    const tilted: P3 = { x: 1, y: 0.2, z: 0 } // ~11.3° tilt, dot~0.98
    expect(isAligned(tilted, X, 1)).toBe(false)
    expect(isAligned(tilted, X, 1, 0.05)).toBe(true) // 0.98 >= 0.95
  })
  it('zero vector yields unit dot 0, so it is only anti-aligned by the sign branch', () => {
    expect(isAligned({ x: 0, y: 0, z: 0 }, X, 1)).toBe(false) // dot 0 < 1-tol
    // GOTCHA: the zero vector's dot is 0, which is NOT ≤ -(1-tol) — so it is not
    // treated as anti-aligned even for sign=-1.
    expect(isAligned({ x: 0, y: 0, z: 0 }, X, -1)).toBe(false)
  })
})

// ── EntityGeom-facing predicates (pure; mock the geometry projection) ───────

function mockFace(geomType: string, dir?: P3): EntityGeom {
  return {
    kind: 'face',
    _handle: {} as never,
    hash: () => 0,
    same: () => false,
    center: () => ({ x: 0, y: 0, z: 0 }),
    direction: () => dir ?? null,
    geomType: () => geomType,
  }
}
function mockEdge(geomType: string, dir?: P3): EntityGeom {
  return {
    kind: 'edge',
    _handle: {} as never,
    hash: () => 0,
    same: () => false,
    center: () => ({ x: 0, y: 0, z: 0 }),
    direction: () => dir ?? null,
    geomType: () => geomType,
  }
}
function mockVertex(): EntityGeom {
  return {
    kind: 'vertex',
    _handle: {} as never,
    hash: () => 0,
    same: () => false,
    center: () => ({ x: 0, y: 0, z: 0 }),
    direction: () => null,
    geomType: () => undefined,
  }
}

describe('isDirectionCandidate(geom)', () => {
  it('true for planar faces', () => {
    expect(isDirectionCandidate(mockFace('PLANE'))).toBe(true)
  })
  it('false for non-planar faces', () => {
    expect(isDirectionCandidate(mockFace('CYLINDER'))).toBe(false)
  })
  it('true for line edges', () => {
    expect(isDirectionCandidate(mockEdge('LINE'))).toBe(true)
  })
  it('false for non-line edges', () => {
    expect(isDirectionCandidate(mockEdge('CIRCLE'))).toBe(false)
  })
  it('false for vertices', () => {
    expect(isDirectionCandidate(mockVertex())).toBe(false)
  })
})

describe('typeMatches(geom, want)', () => {
  it('matches exact upcased name', () => {
    expect(typeMatches(mockFace('PLANE'), 'PLANE')).toBe(true)
    expect(typeMatches(mockEdge('CIRCLE'), 'CIRCLE')).toBe(true)
  })
  it('false on mismatch', () => {
    expect(typeMatches(mockFace('PLANE'), 'CYLINDER')).toBe(false)
  })
  it('is case-sensitive (grammar upcases before call)', () => {
    expect(typeMatches(mockEdge('LINE'), 'line')).toBe(false)
  })
  it('vertex geomType() undefined never matches a concrete name', () => {
    expect(typeMatches(mockVertex(), 'PLANE')).toBe(false)
  })
})

describe('entityDirection(geom, owner?)', () => {
  it('returns the direction for a planar face', () => {
    expect(entityDirection(mockFace('PLANE', X))).toEqual(X)
  })
  it('returns the direction for a line edge', () => {
    expect(entityDirection(mockEdge('LINE', Z))).toEqual(Z)
  })
  it('returns null for non-candidates (vertex / non-planar / non-line)', () => {
    expect(entityDirection(mockVertex())).toBeNull()
    expect(entityDirection(mockFace('CYLINDER'))).toBeNull()
    expect(entityDirection(mockEdge('CIRCLE'))).toBeNull()
  })
  it('forwards the owner argument to the underlying direction()', () => {
    let seen: unknown
    const geom: EntityGeom = {
      ...mockFace('PLANE'),
      direction: (owner?: unknown) => {
        seen = owner
        return X
      },
    }
    const owner = {} as never
    expect(entityDirection(geom, owner)).toEqual(X)
    expect(seen).toBe(owner)
  })
})

// ---------------------------------------------------------------------------
// grammar exported function parseSelector — supplementary boundary cases
// (merge-covered above, but assert a few pure behaviors not in grammar.test.ts)
// ---------------------------------------------------------------------------
describe('parseSelector(expr) supplementary boundaries', () => {
  it('throws on null / undefined / whitespace-only', () => {
    expect(() => parseSelector(null as unknown as string)).toThrow(SyntaxError)
    expect(() => parseSelector(undefined as unknown as string)).toThrow(SyntaxError)
    expect(() => parseSelector('   ')).toThrow(SyntaxError)
  })
  it('parses named views into minmax atoms', () => {
    expect(parseSelector('front')).toEqual({ op: 'atom', desc: { kind: 'minmax', vec: { x: 0, y: 0, z: 1 }, max: true } })
    expect(parseSelector('bottom')).toEqual({ op: 'atom', desc: { kind: 'minmax', vec: { x: 0, y: 1, z: 0 }, max: false } })
  })
  it('supports and/or/exc/not logical composition', () => {
    const e = parseSelector('>Z and |X or X except %PLANE')
    expect(e.op).toBe('and')
    if (e.op !== 'and') return
    expect(e.terms.length).toBeGreaterThanOrEqual(2)
  })
})

// grammar constant tables — assert parity so the predicates' axis input contract
// stays honest (pure data, no OCCT).
describe('grammar constant tables (pure data)', () => {
  it('AXES lists X/Y/Z/XY/YZ/XZ non-unit axes', () => {
    expect(AXES.X).toEqual({ x: 1, y: 0, z: 0 })
    expect(AXES.Y).toEqual({ x: 0, y: 1, z: 0 })
    expect(AXES.Z).toEqual({ x: 0, y: 0, z: 1 })
    expect(AXES.XY).toEqual({ x: 1, y: 1, z: 0 })
    expect(AXES.YZ).toEqual({ x: 0, y: 1, z: 1 })
    expect(AXES.XZ).toEqual({ x: 1, y: 0, z: 1 })
  })
  it('NAMED_VIEW maps all six named views', () => {
    for (const key of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
      expect(NAMED_VIEW[key]).toBeDefined()
    }
  })
  it('TYPE_NAMES is the union LUT set', () => {
    expect(TYPE_NAMES.has('PLANE')).toBe(true)
    expect(TYPE_NAMES.has('LINE')).toBe(true)
    expect(TYPE_NAMES.has('CIRCLE')).toBe(true)
    expect(TYPE_NAMES.has('SPHERE')).toBe(true)
    expect(TYPE_NAMES.has('NOTATYPE')).toBe(false)
  })
  it('SYNTAX_FEATURES enumerates all grouped feature tokens', () => {
    expect(SYNTAX_FEATURES.some((f) => f.group === 'modifier' && f.token === '>')).toBe(true)
    expect(SYNTAX_FEATURES.some((f) => f.group === 'axis' && f.token === '(x,y,z)')).toBe(true)
    expect(SYNTAX_FEATURES.some((f) => f.group === 'view' && f.token === 'front')).toBe(true)
    expect(SYNTAX_FEATURES.some((f) => f.group === 'logical' && f.token === 'except')).toBe(true)
    expect(SYNTAX_FEATURES.some((f) => f.group === 'index' && f.token === '[k]')).toBe(true)
  })
})