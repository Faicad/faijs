/**
 * api ops — BREP-backed creator/placement ops direct coverage (buildProfileShape,
 * punchSolidOf / buildPunchHole, buildSketchOnFaceWith, buildTopologyAdjacency).
 *
 * Runs the real occt-wasm. Each op is exercised through its exported function so
 * the CI API-coverage gate counts it as referenced.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../runtime-state'
import { initOcctWasm, getOcctKernel } from '../occt-kernel/occtKernel'
import { primitiveToBrepSolid } from '../primitives/brep-primitives'
import { brepOf, fromBrep } from '../shape'
import { buildProfileShape, type ProfileLoop } from './profile'
import { buildPunchHole, punchSolidOf } from './punch-hole'
import { buildSketchOnFaceWith } from './sketch-on-face'
import { buildTopologyAdjacency } from '../occt-kernel/topologyExt'
import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'

let kernel: any

beforeAll(async () => {
  await initOcctWasm()
  kernel = getOcctKernel() as any
  configureBackends(makeBackends(kernel))
}, 120000)

function makeBackends(kernelBrep: unknown): Backends {
  return {
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'brep', brepCapabilities: undefined },
    kernel: { brep: kernelBrep, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends
}

function wrapSolid(solid: BrepHandle): Shape {
  return fromBrep({ positions: new Float32Array(0), indices: new Uint32Array(0) } as unknown as Shape, { solid })
}

/** 2D unit-ish square contour on z=0 (4 closed line segments). */
function squareContour(side = 8): ProfileLoop {
  const s = side / 2
  const pts: [number, number][] = [
    [-s, -s], [s, -s], [s, s], [-s, s],
  ]
  return {
    segments: pts.map(([x1, y1], i) => {
      const [x2, y2] = pts[(i + 1) % pts.length]!
      return { kind: 'line', x1, y1, x2, y2 }
    }),
  }
}

function buildBox(): { solid: BrepHandle; shape: Shape } {
  const { solid } = primitiveToBrepSolid(kernel, 'box', { width: 10, depth: 10, height: 10 })
  return { solid, shape: wrapSolid(solid) }
}

/** 1-based ordinal of the box face whose surface centroid has the max z. */
function topFaceOrdinal(solid: BrepHandle): number {
  const faces = kernel.getSubShapes(solid, 'face')
  let best = 1
  let bz = -Infinity
  for (let i = 0; i < faces.length; i++) {
    const bb = kernel.getBoundingBox(faces[i])
    if (bb.zmax > bz) {
      bz = bb.zmax
      best = i + 1
    }
  }
  return best
}

describe('buildProfileShape', () => {
  it('builds a planar face from a square 2D contour', () => {
    const shape = buildProfileShape({ contours: [squareContour()] })
    const solid = brepOf(shape) as BrepHandle | undefined
    expect(solid).toBeTruthy()
    const face = kernel.getSubShapes(solid, 'face')[0]
    expect(kernel.surfaceType(face)).toBe('plane')
    kernel.release(solid)
  })

  it('builds the outer wire in as:wire mode', () => {
    const shape = buildProfileShape({ contours: [squareContour()], as: 'wire' })
    const solid = brepOf(shape) as BrepHandle
    // as:'wire' returns a non-empty handle (a wire curve on the host plane)
    expect(solid).toBeTruthy()
    kernel.release(solid)
  })
})

describe('buildTopologyAdjacency', () => {
  it('produces face→edge / edge→face / face→vertex tables for a box', () => {
    const { solid } = buildBox()
    try {
      const adj = buildTopologyAdjacency(kernel, solid)
      expect(adj.faceEdgeOrdinals).toHaveLength(6)
      expect(adj.edgeFaceOrdinals.some((row) => row.length >= 2)).toBe(true)
      expect(adj.faceVertexOrdinals).toHaveLength(6)
    } finally {
      kernel.release(solid)
    }
  })
})

describe('punchSolidOf / buildPunchHole / buildSketchOnFaceWith', () => {
  it('buildSketchOnFaceWith places a square face on the box top face', () => {
    const { solid, shape } = buildBox()
    try {
      const top = topFaceOrdinal(solid)
      const face = buildSketchOnFaceWith(kernel, { contours: [squareContour(6)], on: shape, face: top })
      const handle = brepOf(face) as BrepHandle
      const faces = kernel.getSubShapes(handle, 'face')
      expect(faces.length).toBeGreaterThan(0)
      kernel.release(handle)
    } finally {
      kernel.release(solid)
    }
  })

  it('punchSolidOf cuts a square through the box on the top face', () => {
    const { solid, shape } = buildBox()
    try {
      const top = topFaceOrdinal(solid)
      const holed = punchSolidOf(kernel, solid, { contours: [squareContour(6)], on: shape, face: top })
      expect(kernel.getVolume(holed)).toBeGreaterThan(0)
      expect(kernel.getVolume(holed)).toBeLessThan(1000)
      kernel.release(holed)
    } finally {
      kernel.release(solid)
    }
  })

  it('buildPunchHole returns a Shape wrapping the punched solid', () => {
    const { solid, shape } = buildBox()
    try {
      const top = topFaceOrdinal(solid)
      const holedShape = buildPunchHole(kernel, { contours: [squareContour(6)], on: shape, face: top })
      expect(brepOf(holedShape)).toBeTruthy()
      kernel.release(brepOf(holedShape))
    } finally {
      kernel.release(solid)
    }
  })
})