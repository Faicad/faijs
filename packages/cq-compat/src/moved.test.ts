/**
 * E `moved` / `Location` tests — expected values measured against cadquery 2.8.0
 * (cadquery-env) by replaying `tests/test_free_functions.py::test_moved`:
 *
 *   func.box(1,1,1)             → vol 1, center (0,0,0.5)  [xy-centred, z 0..1]
 *   b.moved(L(-1,0,0), L(1,0,0))   → vol 2, 2 solids, 12 faces, com z 0.5
 *   bs1.moved(L((0,1,0),45°x), L((0,-1,0),-45°x))
 *                               → vol 4, 24 faces, com z 0.353553
 *   b.moved((0,0,1)).moved(z=-1) → back to the original box (com z 0.5)
 *   b.moved(L(0,-45°x)).moved(rx=45) → identity (bbox == original)
 *
 * Rotation order caveat: upstream uses `gp_Extrinsic_XYZ`; faijs
 * `cad.rotate_euler` uses THREE.Euler 'XYZ'. They agree for single-axis
 * rotations (every case below) but may differ for combined rx/ry/rz.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs-core/node'
import { brepjsCompat } from '@faicad/faijs-core/api'
import { borrowBrepjsShape } from '@faicad/faijs-core/api/internal/l3-bridge'
import { asPartName } from '@faicad/faijs-core/identity'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import * as cq from './index'

let runtime: ReturnType<typeof createRuntime>

/** Build a unit box sitting on z=0 (the shape `func.box(1,1,1)` produces). */
const BOX = [
  'let wp0 = cq.Workplane("XY")',
  'let wp1 = await cq.box(wp0, 1, 1, 1)',
  'let b = await cq.translate(wp1, [0, 0, 0.5])',
]

async function runShape(lines: string[]): Promise<Shape> {
  const code = ["import * as cq from '@faicad/cq-compat'", ...lines, 'let result = cq.val(wp_out)'].join('\n')
  const res = await runtime.execute(code)
  expect(res.failedAt).toBeUndefined()
  const shape = res.outputs.get(asPartName('result')) as Shape | undefined
  expect(shape).toBeDefined()
  return shape!
}

function count(shape: Shape, kind: 'getFaces' | 'getSolids'): number {
  const fn = brepjsCompat[kind] as (s: never) => unknown
  return (fn(borrowBrepjsShape(shape) as never) as unknown[]).length
}

function volume(shape: Shape): number {
  const r = brepjsCompat.measureVolume(borrowBrepjsShape(shape) as never) as unknown as {
    ok: boolean
    value?: number
  }
  expect(r.ok).toBe(true)
  return r.value as number
}

function bbox(shape: Shape): number[] {
  const b = brepjsCompat.getBounds(borrowBrepjsShape(shape) as never) as unknown as {
    xMin: number
    xMax: number
    yMin: number
    yMax: number
    zMin: number
    zMax: number
  }
  // round to 1e-6 and normalise `-0` so the array compares equal to literals
  return [b.xMin, b.yMin, b.zMin, b.xMax, b.yMax, b.zMax].map((v) => {
    const r = Math.round(v * 1e6) / 1e6
    return r === 0 ? 0 : r
  })
}

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/cq-compat' } as never)
  const warm = await runtime.execute('let a = cad.box(1, 1, 1, { centered: true })')
  expect(warm.failedAt).toBeUndefined()
}, 120000)

describe('cq-compat E Location/moved', () => {
  it('Location accepts the vector / numeric / keyword forms used by test_moved', async () => {
    expect(cq.Location([1, 2, 3])).toEqual({ __cqLocation: true, pos: [1, 2, 3], rot: [0, 0, 0] })
    expect(cq.Location([0, 1, 0], [45, 0, 0])).toEqual({
      __cqLocation: true,
      pos: [0, 1, 0],
      rot: [45, 0, 0],
    })
    expect(cq.Location(0, 0, -1)).toEqual({ __cqLocation: true, pos: [0, 0, -1], rot: [0, 0, 0] })
    expect(cq.Location({ z: -1 })).toEqual({ __cqLocation: true, pos: [0, 0, -1], rot: [0, 0, 0] })
    expect(cq.Location({ rx: 45 })).toEqual({ __cqLocation: true, pos: [0, 0, 0], rot: [45, 0, 0] })
    expect(cq.Location()).toEqual({ __cqLocation: true, pos: [0, 0, 0], rot: [0, 0, 0] })
    expect(cq.isLocation(cq.Location([0, 0, 1]))).toBe(true)
    expect(cq.isLocation([0, 0, 1])).toBe(false)
  })

  it('moved() with no location is the identity', async () => {
    const s = await runShape([...BOX, 'let wp_out = await cq.moved(b)'])
    expect(volume(s)).toBeCloseTo(1, 6)
    expect(count(s, 'getFaces')).toBe(6)
  })

  it('moved(loc1, loc2) yields a 2-solid compound (test_moved bs1)', async () => {
    const s = await runShape([
      ...BOX,
      'let l1 = cq.Location([-1, 0, 0])',
      'let l2 = cq.Location([1, 0, 0])',
      'let wp_out = await cq.moved(b, l1, l2)',
    ])
    expect(volume(s)).toBeCloseTo(2, 6)
    expect(count(s, 'getSolids')).toBe(2)
    expect(count(s, 'getFaces')).toBe(12)
  })

  it('moved([loc1, loc2]) is equivalent to the varargs form (test_moved bs2)', async () => {
    const s = await runShape([
      ...BOX,
      'let l1 = cq.Location([-1, 0, 0])',
      'let l2 = cq.Location([1, 0, 0])',
      'let wp_out = await cq.moved(b, [l1, l2])',
    ])
    expect(volume(s)).toBeCloseTo(2, 6)
    expect(count(s, 'getSolids')).toBe(2)
  })

  it('moved(v1, v2) with plain vectors (test_moved bs4)', async () => {
    const s = await runShape([...BOX, 'let wp_out = await cq.moved(b, [0, 0, 1], [0, 0, -1])'])
    expect(volume(s)).toBeCloseTo(2, 6)
    expect(count(s, 'getSolids')).toBe(2)
  })

  it('moved(0, 0, -1) numeric varargs and moved({z:-1}) keyword form (bs6/bs7)', async () => {
    const s6 = await runShape([...BOX, 'let m1 = await cq.moved(b, [0, 0, 1])', 'let wp_out = await cq.moved(m1, 0, 0, -1)'])
    const s7 = await runShape([...BOX, 'let m1 = await cq.moved(b, [0, 0, 1])', 'let wp_out = await cq.moved(m1, { z: -1 })'])
    for (const s of [s6, s7]) {
      expect(volume(s)).toBeCloseTo(1, 6)
      expect(bbox(s)).toEqual([-0.5, -0.5, 0, 0.5, 0.5, 1])
    }
  })

  it('rotate-then-translate composition and rx round-trip (test_moved bs8/bs9)', async () => {
    const s = await runShape([
      ...BOX,
      'let r1 = await cq.moved(b, cq.Location([0, 0, 0], [-45, 0, 0]))',
      'let wp_out = await cq.moved(r1, { rx: 45 })',
    ])
    expect(volume(s)).toBeCloseTo(1, 6)
    expect(bbox(s)).toEqual([-0.5, -0.5, 0, 0.5, 0.5, 1])
  })

  it('composeLocations: a*b applies b first (upstream Location.__mul__)', () => {
    const l1 = cq.Location([-1, 0, 0])
    const l3 = cq.Location([0, 1, 0], [45, 0, 0])
    const c = cq.composeLocations(l3, l1)
    // p -> R45·(p + (-1,0,0)) + (0,1,0);  R45·(-1,0,0) = (-1,0,0)
    expect(c.pos[0]).toBeCloseTo(-1, 9)
    expect(c.pos[1]).toBeCloseTo(1, 9)
    expect(c.pos[2]).toBeCloseTo(0, 9)
    expect(c.rot[0]).toBeCloseTo(45, 9)
    expect(c.rot[1]).toBeCloseTo(0, 9)
    expect(c.rot[2]).toBeCloseTo(0, 9)
    // identity · identity stays identity
    const id = cq.composeLocations(cq.Location(), cq.Location())
    expect(id.pos).toEqual([0, 0, 0])
    expect(id.rot).toEqual([0, 0, 0])
  })

  it('moved over composed locations: 4 solids, vol 4 (test_moved bs3)', async () => {
    const s = await runShape([
      ...BOX,
      'let l1 = cq.Location([-1, 0, 0])',
      'let l2 = cq.Location([1, 0, 0])',
      'let l3 = cq.Location([0, 1, 0], [45, 0, 0])',
      'let l4 = cq.Location([0, -1, 0], [-45, 0, 0])',
      'let c31 = cq.composeLocations(l3, l1)',
      'let c32 = cq.composeLocations(l3, l2)',
      'let c41 = cq.composeLocations(l4, l1)',
      'let c42 = cq.composeLocations(l4, l2)',
      'let wp_out = await cq.moved(b, [c31, c32, c41, c42])',
    ])
    expect(volume(s)).toBeCloseTo(4, 6)
    expect(count(s, 'getSolids')).toBe(4)
    expect(count(s, 'getFaces')).toBe(24)
  })

  it('upstream chained form: bs1 (a 2-solid compound) moved again -> 4 solids', async () => {
    // This is the literal upstream form `bs3 = bs1.moved(l3, l4)`. It only works
    // because `moved` builds the compound WITHOUT a `simplify` pass: with
    // `cleanShapes` applied the OCCT handle is not re-attached across the
    // statement boundary and the second call fails E_BREP_ONLY_INPUT.
    const s = await runShape([
      ...BOX,
      'let l1 = cq.Location([-1, 0, 0])',
      'let l2 = cq.Location([1, 0, 0])',
      'let bs1 = await cq.moved(b, l1, l2)',
      'let l3 = cq.Location([0, 1, 0], [45, 0, 0])',
      'let l4 = cq.Location([0, -1, 0], [-45, 0, 0])',
      'let wp_out = await cq.moved(bs1, l3, l4)',
    ])
    expect(volume(s)).toBeCloseTo(4, 6)
    expect(count(s, 'getSolids')).toBe(4)
    expect(count(s, 'getFaces')).toBe(24)
  }, 60000)

  it('move() is the immutable-workplane alias of moved() (test_moved bs5/bs9)', async () => {
    const s = await runShape([...BOX, 'let m1 = await cq.moved(b, [1, 0, 0])', 'let wp_out = await cq.move(m1, [-1, 0, 0])'])
    expect(volume(s)).toBeCloseTo(1, 6)
    expect(bbox(s)).toEqual([-0.5, -0.5, 0, 0.5, 0.5, 1])
  })
})
