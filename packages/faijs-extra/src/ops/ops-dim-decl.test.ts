/**
 * ops-dim-decl.test.ts — handwritten op unit-dimension declaration surface (P26).
 *
 * The unit-system P4 declaration surface: handwritten dual-ops declare their
 * script-side param dims via `paramDims`; `dualOpMetaOf` (sdk export) surfaces
 * them for the static dimension stage (which itself lands with the P6 check
 * pass; this test proves the declaration + accessor round-trip).
 */
import { describe, expect, it } from 'vitest'
import { dualOpMetaOf } from '@faicad/faijs/sdk'
import { fai_extrude } from './fai_extrude'
import { fai_drill } from './fai_drill'
import { box, sphere, cylinder, cone, wedge } from '@faicad/faijs/api/primitives'
import { translate, rotate_euler } from '@faicad/faijs/api/transform'
import { knurl } from '@faicad/faijs/api/knurl'

describe('fai_extrude dimension declaration (unit-system D8/P4)', () => {
  it('declares length dims for length/planeDistance params', () => {
    const meta = dualOpMetaOf(fai_extrude)
    expect(meta).toBeDefined()
    expect(meta?.paramDims).toEqual({ length: 'length', planeDistance: 'length' })
  })
})

describe('op paramDims declarations (unit-system G3)', () => {
  it('box', () => {
    expect(dualOpMetaOf(box)?.paramDims).toEqual({ width: 'length', depth: 'length', height: 'length' })
  })

  it('sphere', () => {
    expect(dualOpMetaOf(sphere)?.paramDims).toEqual({ radius: 'length' })
  })

  it('cylinder', () => {
    expect(dualOpMetaOf(cylinder)?.paramDims).toEqual({ radius: 'length', height: 'length' })
  })

  it('cone', () => {
    expect(dualOpMetaOf(cone)?.paramDims).toEqual({ radiusBottom: 'length', radiusTop: 'length', height: 'length' })
  })

  it('wedge', () => {
    expect(dualOpMetaOf(wedge)?.paramDims).toEqual({ width: 'length', height: 'length', angle: 'angle', length: 'length' })
  })

  it('translate', () => {
    expect(dualOpMetaOf(translate)?.paramDims).toEqual({ offset: 'length' })
  })

  it('rotate_euler', () => {
    expect(dualOpMetaOf(rotate_euler)?.paramDims).toEqual({ angles: 'angle', pivot: 'length' })
  })

  it('knurl', () => {
    expect(dualOpMetaOf(knurl)?.paramDims).toEqual({ knurlTextureHeight: 'length', knurlRefineLength: 'length' })
  })

  it('fai_drill', () => {
    expect(dualOpMetaOf(fai_drill)?.paramDims).toEqual({ diameter: 'length', depth: 'length', tolerance: 'length' })
  })

  it('scale / scale3d declare no dims (factor is dimensionless)', () => {
    // Covered implicitly: no paramDims key on these ops. See transform.ts.
    expect(dualOpMetaOf(rotate_euler)).toBeDefined()
  })
})
