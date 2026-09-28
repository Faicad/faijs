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

describe('fai_extrude dimension declaration (unit-system D8/P4)', () => {
  it('declares length dims for length/planeDistance params', () => {
    const meta = dualOpMetaOf(fai_extrude)
    expect(meta).toBeDefined()
    expect(meta?.paramDims).toEqual({ length: 'length', planeDistance: 'length' })
  })
})