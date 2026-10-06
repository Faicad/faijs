import { describe, it, expect } from 'vitest'
import { faceGeomType, edgeGeomType } from './entity'

describe('faceGeomType', () => {
  it('maps kernel surface kinds to CadQuery uppercased names', () => {
    expect(faceGeomType('plane')).toBe('PLANE')
    expect(faceGeomType('cylinder')).toBe('CYLINDER')
    expect(faceGeomType('cone')).toBe('CONE')
    expect(faceGeomType('sphere')).toBe('SPHERE')
    expect(faceGeomType('torus')).toBe('TORUS')
  })
  it('returns OTHER for an unmapped kind', () => {
    expect(faceGeomType('something-unknown')).toBe('OTHER')
    expect(faceGeomType('')).toBe('OTHER')
  })
})

describe('edgeGeomType', () => {
  it('maps kernel curve kinds to CadQuery uppercased names', () => {
    expect(edgeGeomType('line')).toBe('LINE')
    expect(edgeGeomType('circle')).toBe('CIRCLE')
    expect(edgeGeomType('ellipse')).toBe('ELLIPSE')
    expect(edgeGeomType('bspline')).toBe('BSPLINE')
  })
  it('returns OTHER for an unknown curve kind', () => {
    expect(edgeGeomType('spline-unknown')).toBe('OTHER')
  })
})