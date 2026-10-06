import { describe, it, expect } from 'vitest'
import { BufferGeometry, BufferAttribute } from 'three'
import { geoToManifoldMesh, manifoldMeshToGeo } from './geo-convert'
import { manifoldToMeshData } from './csg-core'

describe('geoToManifoldMesh / manifoldMeshToGeo', () => {
  it('round-trips an indexed geometry through manifold mesh data', () => {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array([0,0,0, 1,0,0, 0,1,0]), 3))
    geo.setIndex(new BufferAttribute(new Uint32Array([0,1,2]), 1))
    const md = geoToManifoldMesh(geo)
    expect(md.positions).toHaveLength(9)
    expect(Array.from(md.indices)).toEqual([0,1,2])

    const back = manifoldMeshToGeo(md, { computeNormals: false })
    expect(back.getAttribute('position').count).toBe(3)
  })

  it('non-indexed geometry is assigned sequential indices by geoToManifoldMesh', () => {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array([0,0,0, 1,0,0, 0,1,0, 1,1,0]), 3))
    const { indices } = geoToManifoldMesh(geo)
    expect(Array.from(indices)).toEqual([0,1,2,3])
  })

  it('manifoldMeshToGeo returns empty geometry when there is no data', () => {
    const g = manifoldMeshToGeo({ positions: new Float32Array(), indices: new Uint32Array() })
    expect(g.attributes.position).toBeUndefined()
  })
})

describe('manifoldToMeshData (csg-core)', () => {
  it('extracts positions and indices from a Manifold-like getMesh surface', () => {
    const fakeManifold = {
      getMesh: () => ({
        numProp: 3,
        vertProperties: new Float32Array([0,0,0, 1,0,0, 0,1,0]),
        triVerts: new Uint32Array([0,1,2]),
      }),
    } as never
    const r = manifoldToMeshData(fakeManifold)
    expect(Array.from(r.positions)).toEqual([0,0,0, 1,0,0, 0,1,0])
    expect(Array.from(r.indices)).toEqual([0,1,2])
  })

  it('handles numProp > 3 by skipping extra property channels', () => {
    // each vertex carries {x,y,z, u,v}
    const fakeManifold = {
      getMesh: () => ({
        numProp: 5,
        vertProperties: new Float32Array([0,0,0,7,8, 1,0,0,7,8, 0,1,0,7,8]),
        triVerts: new Uint32Array([0,1,2]),
      }),
    } as never
    const r = manifoldToMeshData(fakeManifold)
    expect(Array.from(r.positions)).toEqual([0,0,0, 1,0,0, 0,1,0])
  })

  it('returns empty indices when triVerts is absent', () => {
    const fakeManifold = {
      getMesh: () => ({ numProp: 3, vertProperties: new Float32Array([0,0,0]) }),
    } as never
    const r = manifoldToMeshData(fakeManifold)
    expect(r.indices).toHaveLength(0)
  })
})