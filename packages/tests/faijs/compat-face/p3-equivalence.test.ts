/**
 * P3 equivalence regression test — verifies that the brepjsCompat surface
 * (81 symbols + the 2026-09-08 fillet addition) remains equivalent after the Q5-A rename.
 *
 * Design: docs/plans/2026-09-07-compat-surface-unified-projection.md §8 验收 3/4
 *
 * L1: all exported symbols exist (typeof check)
 * L3: key functions produce expected results
 */
import { describe, expect, it } from 'vitest'
import { brepjsCompat } from '@faicad/faijs'

describe('P3 L1 — brepjsCompat surface 81 symbols exist', () => {
  // The 81 exported symbols from the hand-curated brepjs-compat face.
  // Each must be non-undefined after the Q5-A rename.
  const symbolNames = [
    // ① primitives + booleans + evolutions
    'cone', 'torus', 'ellipsoid',
    'fuse', 'cut', 'extrude', 'revolve', 'loft', 'intersect',
    // 2026-09-08: fillet added for cq-compat edge-selected fillets
    'fillet',
    'simplify',
    // BoxDimensions is a type-only export, not in the runtime namespace
    // ①b library-building factories
    'makeExternalGear', 'makeInternalGear', 'makePlanetaryGear', 'thread',
    // ② sub-shape queries + measurements
    'getEdges', 'getFaces', 'getWires', 'getVertices', 'getShells',
    'getSolids', 'getCompSolids', 'getBounds', 'vertexPosition',
    'measureVolume', 'measureArea', 'measureLength',
    // ③ sketching DSL + drawing factories
    'Sketcher', 'FaceSketcher',
    'drawCircle', 'drawEllipse', 'drawRoundedRectangle', 'drawRectangle',
    'drawSingleCircle', 'drawSingleEllipse', 'drawPolysides', 'drawText',
    'draw', 'makeBaseBox',
    // ④ combinators / pure helpers / types
    'ok', 'err', 'isOk', 'isErr', 'unwrap', 'unwrapOr', 'map', 'andThen',
    'vecAdd', 'vecSub', 'vecScale', 'vecDot', 'vecCross', 'vecLength', 'vecNormalize',
    'createPlane', 'createNamedPlane', 'resolvePlane',
    'kernelError', 'validationError',
    'DEG2RAD', 'RAD2DEG',
    // ⑤ raw 2D-morph + transform + face ports
    'line', 'wire', 'wireLoop', 'face', 'polygon',
    'outerWire', 'getSurfaceType', 'pointOnSurface', 'normalAt', 'faceCenter',
    'sharedEdges', 'curveStartPoint', 'curveEndPoint',
    'translate', 'isSolid', 'isPlanarWire', 'isValid',
    'rotate',
  ] as const

  for (const name of symbolNames) {
    it(`brepjsCompat.${name} exists`, () => {
      const value = (brepjsCompat as Record<string, unknown>)[name]
      expect(value).toBeDefined()
    })
  }
})

describe('P3 L3 — key function equivalence', () => {
  it('ok(7) returns Ok with value 7', () => {
    const result = brepjsCompat.ok(7) as { ok: true; value: number }
    expect(result.ok).toBe(true)
    expect(result.value).toBe(7)
  })

  it('err("test") returns Err with error "test"', () => {
    const result = brepjsCompat.err('test') as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toBe('test')
  })

  it('isOk(ok(1)) is true', () => {
    expect(brepjsCompat.isOk(brepjsCompat.ok(1))).toBe(true)
  })

  it('isErr(err("x")) is true', () => {
    expect(brepjsCompat.isErr(brepjsCompat.err('x'))).toBe(true)
  })

  it('DEG2RAD is Math.PI / 180', () => {
    expect(brepjsCompat.DEG2RAD).toBeCloseTo(Math.PI / 180)
  })

  it('RAD2DEG is 180 / Math.PI', () => {
    expect(brepjsCompat.RAD2DEG).toBeCloseTo(180 / Math.PI)
  })

  it('vecAdd([1,2,3],[4,5,6]) returns [5,7,9]', () => {
    const result = brepjsCompat.vecAdd([1, 2, 3], [4, 5, 6])
    expect(Array.from(result)).toEqual([5, 7, 9])
  })

  it('vecLength([3,4,0]) returns 5', () => {
    const result = brepjsCompat.vecLength([3, 4, 0]) as number
    expect(result).toBeCloseTo(5)
  })
})
