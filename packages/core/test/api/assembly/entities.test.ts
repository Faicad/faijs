import { describe, it, expect } from 'vitest'
import { faceGeometryToSolverEntity } from '../../../src/api/assembly/entities'
import { TopoRefError } from '../../../src/topology/naming'

describe('faceGeometryToSolverEntity', () => {
  it('maps a plane face to a plane solver entity', () => {
    const e = faceGeometryToSolverEntity({
      surfaceType: 'plane',
      center: [1, 2, 3],
      normal: [0, 0, 1],
    })
    expect(e).toEqual({ type: 'plane', origin: [1, 2, 3], normal: [0, 0, 1] })
  })

  it('maps a face with no surfaceType to a plane entity (plane fallback)', () => {
    const e = faceGeometryToSolverEntity({ center: [0, 0, 0], normal: [1, 0, 0] })
    expect(e.type).toBe('plane')
  })

  it('maps a cylinder with an axis to an axis solver entity', () => {
    const e = faceGeometryToSolverEntity({
      surfaceType: 'cylinder',
      center: [0, 0, 0],
      normal: [0, 1, 0],
      axis: { origin: [0, 0, 0] as const, direction: [0, 0, 1] as const },
    })
    expect(e).toEqual({ type: 'axis', origin: [0, 0, 0], direction: [0, 0, 1] })
  })

  it('throws E_TOPO_NOT_FOUND for a cylinder/cone without an axis', () => {
    expect(() =>
      faceGeometryToSolverEntity({ surfaceType: 'cylinder', center: [0, 0, 0], normal: [0, 0, 1] }),
    ).toThrowError(/needs an axis/)
    expect(() =>
      faceGeometryToSolverEntity({ surfaceType: 'cone', center: [0, 0, 0], normal: [0, 0, 1] }),
    ).toThrowError(TopoRefError)
  })

  it('throws E_TOPO_NOT_FOUND for an unsupported surface type', () => {
    expect(() =>
      faceGeometryToSolverEntity({ surfaceType: 'torus', center: [0, 0, 0], normal: [0, 0, 1] }),
    ).toThrowError(/unsupported surface type/)
  })
})