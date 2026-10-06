/**
 * three-compat-smoke — the executable proof of M3a ("only basic API").
 *
 * `three-surface.test.ts` pins *which* three API core may use. This file pins
 * that the pinned subset behaves the same on the two three lines faijs must run
 * on: r184 (web host) and r162 (weapp host — the end-side canvas is WebGL1-only,
 * so the version is hardware-locked and cannot follow the web host).
 *
 * Both copies are installed: `three` (r184) and the npm alias `three-162`
 * (`npm i -D three-162@npm:three@0.162.0`). Comparing the live modules, rather
 * than trusting a changelog, is the point — a silent behaviour change in a
 * "basic" API is exactly the cross-host breakage this plan exists to prevent.
 *
 * Known-and-accepted divergences are listed in `KNOWN_DIVERGENCES` with the
 * measurement that motivated each entry; anything else fails.
 */
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import * as THREE162 from 'three-162'

/**
 * Divergences measured between r162 and r184 inside the whitelisted subset.
 *
 * `coneGeometry` — r163 generalised cone/frustum vertex generation, so the
 * tessellation of the *same* parameters differs (vertex/index counts included).
 * Accepted: core reaches cones through `mesh/primitives.ts`'s `cone()`, which
 * builds a `CylinderGeometry` for every non-degenerate frustum and only uses
 * `ConeGeometry` for a true apex. BREP tessellation, not this generator, is what
 * platform geometry is exported from.
 */
const KNOWN_DIVERGENCES = new Set(['coneGeometry'])

const round = (v: number): number => Math.round(v * 1e6) / 1e6
const roundAll = (a: ArrayLike<number>): number[] => Array.from(a, round)

/**
 * A numeric digest of the whitelisted API's behaviour. Everything is reduced to
 * plain numbers so the two versions can be compared exactly (after rounding),
 * independent of class identity across the two module instances.
 *
 * @param M - the three module under test.
 * @returns the digest, keyed by API area.
 */
function digest(M: typeof THREE) {
  const v3 = (x: number, y: number, z: number) => new M.Vector3(x, y, z)

  const v = v3(1, 2, 3)
  const cross = new M.Vector3().crossVectors(v, v3(0, 1, 0)).normalize()
  const v2 = new M.Vector2(3, 4).normalize()

  const q = new M.Quaternion().setFromUnitVectors(v3(0, 0, 1), v3(1, 0, 0))
  const e = new M.Euler(0.3, -0.2, 1.1, 'XYZ')
  const qFromEuler = new M.Quaternion().setFromEuler(e)
  const eRoundTrip = new M.Euler().setFromQuaternion(qFromEuler, 'XYZ')

  const m = new M.Matrix4().makeRotationFromQuaternion(q)
  m.setPosition(4, 5, 6)
  const mv = v3(1, 1, 1).applyMatrix4(m)

  const plane = new M.Plane(new M.Vector3(0, 0, 1), -2)
  const box = new M.Box3(v3(-1, -2, -3), v3(1, 2, 3))
  const sphere = new M.Sphere(v3(1, 1, 1), 2)

  const geo = new M.BufferGeometry()
  geo.setAttribute('position', new M.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
  geo.setIndex(new M.BufferAttribute(new Uint32Array([0, 1, 2]), 1))
  geo.computeBoundingBox()
  const fb = new M.Float32BufferAttribute(new Float32Array([1, 2, 3, 4]), 2)

  // The generators core actually reaches for platform primitives.
  const boxGeo = new M.BoxGeometry(2, 3, 4)
  const sphereGeo = new M.SphereGeometry(5, 12, 8)
  const cylGeo = new M.CylinderGeometry(1, 2, 3, 16)
  const coneGeo = new M.ConeGeometry(3, 4, 12)

  // `ShapeUtils.triangulateShape` — the ear-clipping used by cross-sections.
  const contour = [new M.Vector2(0, 0), new M.Vector2(4, 0), new M.Vector2(4, 4), new M.Vector2(0, 4)]
  const hole = [new M.Vector2(1, 1), new M.Vector2(1, 2), new M.Vector2(2, 2), new M.Vector2(2, 1)]
  const tris = M.ShapeUtils.triangulateShape(contour, [hole])

  return {
    revision: Number(M.REVISION),
    vector3: [...roundAll(cross.toArray()), round(v.length()), round(v.dot(v3(4, 5, 6)))],
    vector2: roundAll(v2.toArray()),
    quaternionSetFromUnitVectors: roundAll(q.toArray()),
    quaternionSetFromEulerXYZ: roundAll(qFromEuler.toArray()),
    eulerRoundTrip: roundAll([eRoundTrip.x, eRoundTrip.y, eRoundTrip.z]),
    matrix4: roundAll(m.elements),
    vector3ApplyMatrix4: roundAll(mv.toArray()),
    plane: [round(plane.distanceToPoint(v3(0, 0, 0))), ...roundAll(plane.normal.toArray())],
    box3: [...roundAll(box.min.toArray()), ...roundAll(box.max.toArray()), round(box.getSize(v3(0, 0, 0)).length())],
    sphere: round(sphere.distanceToPoint(v3(0, 0, 0))),
    bufferGeometryBoundingBox: [...roundAll(geo.boundingBox!.min.toArray()), ...roundAll(geo.boundingBox!.max.toArray())],
    float32BufferAttribute: [...roundAll(fb.array), fb.itemSize],
    boxGeometry: [boxGeo.attributes.position.count, boxGeo.index!.count],
    sphereGeometry: [sphereGeo.attributes.position.count, sphereGeo.index!.count],
    cylinderGeometry: [cylGeo.attributes.position.count, cylGeo.index!.count],
    coneGeometry: [coneGeo.attributes.position.count, coneGeo.index!.count],
    triangulateShape: tris.flatMap((t) => t),
  }
}

describe('M3a — whitelisted three API behaves identically on r162 and r184', () => {
  it('the two installs really are different versions (self-check)', () => {
    expect(Number(THREE.REVISION)).toBe(184)
    expect(Number(THREE162.REVISION)).toBe(162)
  })

  it('every symbol core may use exists in both versions', () => {
    // Keep in sync with THREE_ALLOWED in three-surface.test.ts (the guard that
    // decides what core may touch); this test proves the subset is portable.
    const symbols = [
      'Vector2', 'Vector3', 'Matrix3', 'Matrix4', 'Quaternion', 'Euler', 'Plane', 'Box3', 'Sphere',
      'BufferGeometry', 'BufferAttribute', 'Float32BufferAttribute',
      'BoxGeometry', 'SphereGeometry', 'CylinderGeometry', 'ConeGeometry',
      'ShapeUtils', 'Line3', 'Ray', 'Triangle',
    ]
    for (const symbol of symbols) {
      expect((THREE as unknown as Record<string, unknown>)[symbol], `three r184 missing ${symbol}`).toBeDefined()
      expect((THREE162 as unknown as Record<string, unknown>)[symbol], `three r162 missing ${symbol}`).toBeDefined()
    }
  })

  it('behaviour digest matches, except the entries documented as divergences', () => {
    const web = digest(THREE)
    const weapp = digest(THREE162)
    const differing = Object.keys(web)
      .filter((key) => key !== 'revision' && JSON.stringify(web[key as keyof typeof web]) !== JSON.stringify(weapp[key as keyof typeof weapp]))
      .filter((key) => !KNOWN_DIVERGENCES.has(key))
    expect(differing, `undocumented three divergence(s) between r162 and r184: ${differing.join(', ')}`).toEqual([])
  })

  it('ConeGeometry divergence is real and stays confined to that generator', () => {
    // Guards the exemption above: if a future three release makes r162/r184 cone
    // output agree, the exemption should be deleted, not silently kept.
    const web = digest(THREE)
    const weapp = digest(THREE162)
    expect(web.coneGeometry).not.toEqual(weapp.coneGeometry)
    // …while the frustum path core actually uses agrees.
    expect(web.cylinderGeometry).toEqual(weapp.cylinderGeometry)
  })
})
