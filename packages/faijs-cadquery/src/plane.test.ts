/**
 * Plane coordinate-transform parity — CadQuery 2.8.0 `Plane.toLocalCoords` /
 * `Plane.mirrorInPlane` (audit §3.4, P2).
 *
 * Truth is captured once from a real CadQuery 2.8.0 install
 * (tests/ref-harness/plane-transform-probe.py, NOT run in CI) and hardened
 * here as literal expectations; the faijs engine re-derives the same numbers
 * through the occt-wasm `generalTransform` matrix, so a passing run proves
 * semantic parity for arbitrary (axis-aligned / translated / tilted / arbitrary
 * normal) planes.
 *
 * GOTCHA (probe-verified): CadQuery `mirrorInPlane(axis='X')` reflects about the
 * plane's X *axis* (local y AND z flip), not across the Y–Z plane. CadQuery also
 * returns a `Shell`; faijs keeps the input topology (solid → solid). The
 * mirrored geometry (centre) is identical — only the topological type differs,
 * so these tests assert centre, not volume, for mirrorInPlane.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { setupNativeKernel } from './gear-test-harness'
import { wrapShape, unwrapShape, type CqShape } from './shape-class'
import {
  toLocalCoords,
  mirrorInPlane,
  toLocalCoordsVec,
  mirrorInPlaneVec,
  type CqPlane,
} from './plane'

function kern(): OcctKernel {
  return getKernel() as unknown as OcctKernel
}

/** CadQuery `box(1,1,1)` is centred at the origin; faijs `makeBox` is not, so centre it. */
function boxCentered(): CqShape {
  const h = kern().makeBox(1, 1, 1)
  const c = kern().translate(h, -0.5, -0.5, -0.5)
  return wrapShape('solid', c)
}

/** A box whose centre sits at (2,3,4), matching the probe's `OFF` fixture. */
function boxOff(): CqShape {
  const h = kern().translate(unwrapShape(boxCentered()), 2, 3, 4)
  return wrapShape('solid', h)
}

/** A box whose corner sits at the origin — CadQuery `Solid.makeBox(1,1,1)`
 *  semantics (centre at (0.5,0.5,0.5)). Used to assert the flip axes of
 *  mirrorInPlane, which an origin-centred box would hide. */
function boxCorner(): CqShape {
  return wrapShape('solid', kern().makeBox(1, 1, 1))
}

function bboxCentre(h: ShapeHandle): [number, number, number] {
  const bb = kern().getBoundingBox(h)
  return [(bb.xmin + bb.xmax) / 2, (bb.ymin + bb.ymax) / 2, (bb.zmin + bb.zmax) / 2]
}

const XY: CqPlane = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] }
const TR: CqPlane = { origin: [2, 3, 4], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] }
const C45 = Math.cos(Math.PI / 4)
const S45 = Math.sin(Math.PI / 4)
const TILT: CqPlane = {
  origin: [0, 0, 0],
  xDir: [C45, S45, 0],
  yDir: [-S45, C45, 0],
  normal: [0, 0, 1],
}
const Y: CqPlane = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, -1], normal: [0, 1, 0] }

const close = (got: [number, number, number], exp: [number, number, number], label: string) => {
  expect(Math.abs(got[0] - exp[0]), `${label}.x`).toBeLessThan(1e-6)
  expect(Math.abs(got[1] - exp[1]), `${label}.y`).toBeLessThan(1e-6)
  expect(Math.abs(got[2] - exp[2]), `${label}.z`).toBeLessThan(1e-6)
}

describe('Plane.toLocalCoords parity', () => {
  beforeAll(setupNativeKernel)

  it('XY/ROOT — identity plane, centred box → local origin', () => {
    const out = toLocalCoords(XY, boxCentered())
    close(bboxCentre(unwrapShape(out)), [0, 0,0], 'XY/ROOT')
  })
  it('XY/OFF — identity plane, offset box → world centre', () => {
    const out = toLocalCoords(XY, boxOff())
    close(bboxCentre(unwrapShape(out)), [2, 3, 4], 'XY/OFF')
  })
  it('TR/ROOT — translated plane pulls the box origin to local origin', () => {
    const out = toLocalCoords(TR, boxCentered())
    close(bboxCentre(unwrapShape(out)), [-2, -3, -4], 'TR/ROOT')
  })
  it('TR/OFF — offset box on the translated plane → local origin', () => {
    const out = toLocalCoords(TR, boxOff())
    close(bboxCentre(unwrapShape(out)), [0, 0, 0], 'TR/OFF')
  })
  it('TILT/OFF — 45° rotated frame rotates the offset box into local coords', () => {
    const out = toLocalCoords(TILT, boxOff())
    close(bboxCentre(unwrapShape(out)), [3.535534, 0.707107, 4.0], 'TILT/OFF')
  })
  it('Y/OFF — arbitrary normal (+Y) frame', () => {
    const out = toLocalCoords(Y, boxOff())
    close(bboxCentre(unwrapShape(out)), [2, -4, 3], 'Y/OFF')
  })
})

describe('Plane.mirrorInPlane parity (axis = reflect about that axis)', () => {
  beforeAll(setupNativeKernel)

  it('XY/OFF axis=X — y and z flip', () => {
    const out = mirrorInPlane(XY, boxOff(), 'X')
    close(bboxCentre(unwrapShape(out)), [2, -3, -4], 'XY/OFF')
  })
  it('TR/ROOT axis=X — reflect about the axis through the plane origin', () => {
    const out = mirrorInPlane(TR, boxCentered(), 'X')
    close(bboxCentre(unwrapShape(out)), [0, 6, 8], 'TR/ROOT')
  })
  it('TR/OFF axis=X — box centre lies on the axis → unchanged', () => {
    const out = mirrorInPlane(TR, boxOff(), 'X')
    close(bboxCentre(unwrapShape(out)), [2, 3, 4], 'TR/OFF')
  })
  it('TILT/OFF axis=X — rotated frame reflects in its local y/z', () => {
    const out = mirrorInPlane(TILT, boxOff(), 'X')
    close(bboxCentre(unwrapShape(out)), [3, 2, -4], 'TILT/OFF')
  })
  it('Y/OFF axis=X — arbitrary normal frame', () => {
    const out = mirrorInPlane(Y, boxOff(), 'X')
    close(bboxCentre(unwrapShape(out)), [2, -3, -4], 'Y/OFF')
  })
  it('Y/ROOT axis=Y — x and y flip, z stays (matches testPlaneMethods __mirror_box)', () => {
    // CadQuery Solid.makeBox(1,1,1): corner at origin, centre (0.5,0.5,0.5).
    // mirrorInPlane(Y) reflects about the plane's Y axis → (x,y,z) -> (-x,-y,z).
    const out = mirrorInPlane(Y, boxCorner(), 'Y')
    close(bboxCentre(unwrapShape(out)), [-0.5, -0.5, 0.5], 'Y/ROOT/Y')
  })
  it('Y/ROOT axis=Y is an involution on a corner box (mirror twice → identity)', () => {
    const once = mirrorInPlane(Y, boxCorner(), 'Y')
    const twice = mirrorInPlane(Y, once, 'Y')
    close(bboxCentre(unwrapShape(twice)), [0.5, 0.5, 0.5], 'Y/ROOT/Y involution')
  })
})

describe('Plane vector-form transforms (pure basis math, self-checked)', () => {
  beforeAll(setupNativeKernel)

  it('toLocalCoordsVec on the identity plane returns the point unchanged', () => {
    close(toLocalCoordsVec(XY, [2, 3, 4]), [2, 3, 4], 'toLocalCoordsVec')
  })
  it('toLocalCoordsVec on the rotated frame matches the shape transform', () => {
    close(toLocalCoordsVec(TILT, [2, 3, 4]), [3.535534, 0.707107, 4.0], 'toLocalCoordsVec/TILT')
  })
  it('mirrorInPlaneVec is an involution (mirror twice → identity)', () => {
    const v: [number, number, number] = [2, 3, 4]
    const once = mirrorInPlaneVec(XY, v, 'X')
    const twice = mirrorInPlaneVec(XY, once, 'X')
    close(twice, v, 'mirrorInPlaneVec involution')
  })
  it('mirrorInPlaneVec axis=X flips y and z, keeps x', () => {
    close(mirrorInPlaneVec(XY, [2, 3, 4], 'X'), [2, -3, -4], 'mirrorInPlaneVec/XY')
  })
  it('mirrorInPlaneVec axis=Y flips x and z, keeps y', () => {
    close(mirrorInPlaneVec(XY, [2, 3, 4], 'Y'), [-2, 3, -4], 'mirrorInPlaneVec/Y')
  })
})
