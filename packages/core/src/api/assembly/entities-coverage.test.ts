import { describe, it, expect } from 'vitest'
import { resolveSolverEntity, resolveFaceGeometryOfRef, type EntityResolutionEnv } from './entities'
import { lowerStructuralConstraint } from './lower'
import { TopoRefError } from '../../topology/naming'
import { asPartName } from '../../identity'

const P = (s: string) => asPartName(s)

/**
 * Kernel-free coverage for the assembly entity-extraction + lowering surface.
 *
 * These functions rely on an `EntityResolutionEnv` whose `kernel` may be
 * `null` (mesh / primitive row-snapshot path). Using snapshot references
 * (`{ center, normal }` faces, `{ axis }` edges, points) we exercise every
 * branch without booting OCCT — this file is intentionally pure.
 */

function makeEnv(...knownParts: string[]): EntityResolutionEnv {
  return {
    kernel: null,
    memberOf: (part: string) => (knownParts.includes(part) ? ({} as never) : undefined),
  }
}

describe('resolveFaceGeometryOfRef (snapshot path, no kernel)', () => {
  const env = makeEnv('bracket')

  it('resolves a plane face snapshot to center + normal geometry', () => {
    const geom = resolveFaceGeometryOfRef(
      { part: P('bracket'), face: { surfaceType: 'plane', center: [1, 2, 3], normal: [0, 0, 1] } },
      env,
    )
    expect(geom.surfaceType).toBe('plane')
    expect(geom.center).toEqual([1, 2, 3])
    expect(geom.normal).toEqual([0, 0, 1])
  })

  it('throws when the ref is not a face reference', () => {
    expect(() =>
      resolveFaceGeometryOfRef({ part: P('bracket'), point: [0, 0, 0] } as never, env),
    ).toThrow(/require face references/)
  })

  it('throws when the snapshot lacks center and normal', () => {
    expect(() =>
      resolveFaceGeometryOfRef({ part: P('bracket'), face: { center: [0, 0, 0] } } as never, env),
    ).toThrow(/snapshot requires center and normal/)
  })

  it('throws when the member part is unknown', () => {
    expect(() =>
      resolveFaceGeometryOfRef({ part: P('ghost'), face: { center: [0, 0, 0], normal: [0, 0, 1] } }, env),
    ).toThrow(/unknown part/)
  })
})

describe('resolveSolverEntity (kernel-null paths)', () => {
  const env = makeEnv('bracket')

  it('maps a point ref to a point solver entity', () => {
    expect(resolveSolverEntity({ part: P('bracket'), point: [4, 5, 6] }, env)).toEqual({
      type: 'point',
      origin: [4, 5, 6],
    })
  })

  it('maps a face snapshot to a plane solver entity', () => {
    const e = resolveSolverEntity(
      { part: P('bracket'), face: { surfaceType: 'plane', center: [0, 0, 0], normal: [0, 1, 0] } },
      env,
    )
    expect(e.type).toBe('plane')
  })

  it('maps an edge axis snapshot to an axis solver entity', () => {
    const e = resolveSolverEntity(
      {
        part: P('bracket'),
        edge: { axis: { origin: [0, 0, 0], direction: [0, 0, 1] } },
      },
      env,
    )
    expect(e).toEqual({ type: 'axis', origin: [0, 0, 0], direction: [0, 0, 1] })
  })

  it('throws for an unknown member part', () => {
    expect(() => resolveSolverEntity({ part: P('ghost'), point: [0, 0, 0] }, env)).toThrow(/unknown part/)
  })

  it('edge topoRef without a kernel throws E_TOPO_NOT_FOUND', () => {
    expect(() =>
      resolveSolverEntity({ part: P('bracket'), edge: { topoRef: { kind: 'edge' } } as never }, env),
    ).toThrow(TopoRefError)
  })
})

describe('lowerStructuralConstraint (kernel-null paths)', () => {
  const env = makeEnv('a', 'b')

  it('lowers a fixed constraint to a fixed solver constraint', () => {
    const out = lowerStructuralConstraint({ type: 'fixed', part: P('bracket') }, env)
    expect(out.constraint.type).toBe('fixed')
    expect(out.constraint.entityA!.node).toBe('bracket')
    expect(out.depOrigin).toBeUndefined()
  })

  it('lowers a coincident point ref pair', () => {
    const out = lowerStructuralConstraint(
      { type: 'coincident', a: { part: P('a'), point: [0, 0, 0] }, b: { part: P('b'), point: [1, 1, 1] } },
      env,
    )
    expect(out.constraint.type).toBe('coincident')
    expect(out.depOrigin).toEqual([1, 1, 1])
  })

  it('lowers a parallel constraint to an angle-0 pair via face snapshots', () => {
    const out = lowerStructuralConstraint(
      {
        type: 'parallel',
        a: { part: P('a'), face: { center: [0, 0, 0], normal: [0, 0, 1] } },
        b: { part: P('b'), face: { center: [0, 0, 2], normal: [0, 0, 1] } },
      } as never,
      env,
    )
    expect(out.constraint.type).toBe('angle')
    expect(out.depOrigin).toEqual([0, 0, 2])
  })

  it('lowers a mate pair, flipping the dependent normal into an axis', () => {
    const out = lowerStructuralConstraint(
      {
        type: 'mate',
        a: { part: P('a'), face: { center: [0, 0, 0], normal: [0, 0, 1] } },
        b: { part: P('b'), face: { center: [0, 0, 2], normal: [0, 0, 1] } },
      } as never,
      env,
    )
    expect(out.constraint.type).toBe('concentric')
    // mate flips the dependent-side normal, so direction = [0,0,-1] (in-plane
    // components are ±0; compare numerically so -0 === 0)
    const dep = (out.constraint as unknown as { entityB: { entity: { direction: number[] } } }).entityB.entity.direction
    expect(Math.abs(dep[0])).toBe(0)
    expect(Math.abs(dep[1])).toBe(0)
    expect(dep[2]).toBe(-1)
    expect(out.depOrigin).toEqual([0, 0, 2])
  })
})