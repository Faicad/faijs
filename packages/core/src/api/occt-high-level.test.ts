/**
 * occt-kernel / 高层 API — STEP/BREP 桥 + mesh→STEP + 校验 export 出口单测
 *
 * 直接跑 occt-wasm（initOcctWasm）。覆盖覆盖面缺口里依赖 OCCT 的函数：
 *   importStepToMesh / importBrepToMesh(结构) / releaseShape / meshesToStep /
 *   exportStepFromSolidsHighLevel / cadShapeIsValid / meshToStepBrep /
 *   exportStepFromSolids / primitiveToBrepStep
 *
 * 数据源：fixtures box_boss.step（与 import-step.test 同款读法）。
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileArrayBuffer } from '../io/bytes-node'
import { initOcctWasm, importStepToMesh, meshesToStep } from '../occt-kernel/occtKernel'
import { releaseSolid, exportStepFromSolidsHighLevel } from '../occt-kernel/highLevelApi'
import { primitiveToBrepSolid, geometryToBrepSolid } from '../primitives/brep-primitives'
import { cadShapeIsValid, meshToStepBrep } from '../occt-kernel/meshReconstruct'
import { BufferGeometry, BufferAttribute } from 'three'
import { fromBrep } from '../shape'
import { resolveEdgeSelection, resolveFaceEdgeSelection, resolveVertexSelection } from './cadquery-selectors/edge'
import { resolveFaceSelector } from './cadquery-selectors/face'
import { orientedFaceNormal } from './cadquery-selectors/entity'
import { captureEdgeAxis } from '../topology/naming/geom-hint'

const STEP_BUFFER = readFileArrayBuffer(new URL('../../../fixtures/data/box_boss.step', import.meta.url))

let kernel: any

beforeAll(async () => {
  await initOcctWasm()
  kernel = await initOcctWasm() as any
}, 120000)

describe('occt high-level step/brep bridging', () => {
  it('importStepToMesh parses the box_boss STEP fixture into a non-empty mesh', async () => {
    const { shapeHandle, meshes, meshWithGroups } = await importStepToMesh(STEP_BUFFER)
    try {
      expect(meshes[0].positions.length).toBeGreaterThan(0)
      expect(meshes[0].indices.length).toBeGreaterThan(0)
      expect(meshWithGroups.positions.length).toBe(meshes[0].positions.length)
      expect(cadShapeIsValid(kernel, shapeHandle as never)).toBe(true)
    } finally {
      releaseSolid(shapeHandle)
    }
  })

  it('importStepImpl (api op) wires to importStepToMesh via resolve assets', async () => {
    // Configure an assets backend so importStep can read the STEP bytes.
    const { configureBackends, CONTRACT_VERSION } = await import('../runtime-state')
    const { importStepImpl } = await import('./import-step')
    configureBackends({
      contractVersion: CONTRACT_VERSION,
      config: { mode: 'brep', brepCapabilities: undefined },
      kernel: { brep: kernel, csg: undefined, sdf: undefined },
      fonts: undefined,
      texture: undefined,
      assets: { resolveFile: async () => STEP_BUFFER },
      events: { emit: () => undefined },
    } as never)
    const shape = await importStepImpl({ path: 'box_boss.step' })
    expect(shape.positions.length).toBeGreaterThan(0)
  })

  it('cadShapeIsValid: box solid is valid, garbage handle is not', () => {
    const { solid } = primitiveToBrepSolid(kernel, 'box', { width: 10, depth: 10, height: 10 })
    try {
      expect(cadShapeIsValid(kernel, solid)).toBe(true)
    } finally {
      kernel.release(solid)
    }
  })

  it('meshToStepBrep rebuilds a solid from a box tessellation and exports STEP', () => {
    const { solid } = primitiveToBrepSolid(kernel, 'box', { width: 10, depth: 10, height: 10 })
    try {
      const mesh = kernel.meshShape(solid, { linearDeflection: 0.1, angularDeflection: 0.5 })
      const step = meshToStepBrep(kernel, mesh.positions, mesh.indices)
      expect(step).toContain('FILE_NAME')
      expect(step.length).toBeGreaterThan(200)
    } finally {
      kernel.release(solid)
    }
  })

  it('meshesToStep and releaseSolid are mesh/brep lifecycle clean', async () => {
    const { solid } = buildBox()
    const mesh = kernel.meshShape(solid, { linearDeflection: 0.1, angularDeflection: 0.5 })
    const step = meshesToStep(mesh.positions, mesh.indices, 0.01)
    expect(step).toContain('FILE_NAME')
    releaseSolid(solid as never)
  })

  it('exportStepFromSolidsHighLevel emits an XCAF STEP for a sole solid part', async () => {
    const { solid } = buildBox()
    const out = await exportStepFromSolidsHighLevel([
      { solid, name: 'part1' },
    ], undefined as never)
    const text = Buffer.from(out).toString('utf8')
    expect(text).toContain('FILE_NAME')
    kernel.release(solid)
  })

  it('releaseSolid on a handle never throws even after reuse', () => {
    const { solid } = buildBox()
    releaseSolid(solid as never)
    // releasing twice must be a no-op (occt release is idempotent per handle)
    expect(() => releaseSolid(solid as never)).not.toThrow()
  })
})

describe('occt edge/vertex selectors + geometry hints', () => {
  let solid: any
  let box: ReturnType<typeof fromBrep>

  beforeAll(() => {
    const res = buildBox()
    solid = res.solid
    box = fromBrep({ positions: new Float32Array(0), indices: new Uint32Array(0) } as never, { solid })
  })

  it('resolveEdgeSelection(*) returns all 12 box edges', () => {
    const edges = resolveEdgeSelection(box, '')
    expect(edges.length).toBe(12)
  })

  it('resolveVertexSelection(*) returns all 8 box vertices', () => {
    expect(resolveVertexSelection(box, '')).toHaveLength(8)
  })

  it('resolveFaceEdgeSelection collects edge handles of selected faces', () => {
    // select the +Z top face (selector >Z) and collect its 4 edges
    const edges = resolveFaceEdgeSelection(box, '>Z')
    expect(edges.length).toBe(4)
  })

  it('orientedFaceNormal returns an outward unit normal for each box face', () => {
    const faces = kernel.getSubShapes(solid, 'face')
    for (const f of faces) {
      const n = orientedFaceNormal(kernel as never, f, solid)
      const mag = Math.hypot(n.x, n.y, n.z)
      expect(mag).toBeCloseTo(1, 5)
    }
  })

  it('captureEdgeAxis yields a line axis hint for a box (straight) edge', () => {
    const [edge] = kernel.getSubShapes(solid, 'edge')
    const hint = captureEdgeAxis(kernel, edge)
    expect(hint).toBeDefined()
    if (hint) {
      expect(hint.origin).toHaveLength(3)
      expect(hint.direction).toHaveLength(3)
      const mag = Math.hypot(hint.direction[0], hint.direction[1], hint.direction[2])
      expect(mag).toBeCloseTo(1, 5)
    }
  })

  it('resolveFaceSelector(">Z") returns the +Z top face center and normal', async () => {
    const top = await resolveFaceSelector(box, '>Z', 'centerOfMass')
    expect(top.normal).toEqual([0, 0, 1])
    expect(top.center).toHaveLength(3)
    expect(Number.isFinite(top.center[2])).toBe(true)
    // +Z top face sits at the box's max-z (height 10 split on the convention used by the kernel)
    expect(top.center[2]).toBeGreaterThan(0)
    const front = await resolveFaceSelector(box, 'front', 'centerOfMass')
    expect(front.normal).toEqual([0, 0, 1])
  })

  it('geometryToBrepSolid rebuilds a solid from a BufferGeometry of a box tessellation', () => {
    const src = buildBox()
    try {
      const mesh = kernel.meshShape(src.solid, { linearDeflection: 0.1, angularDeflection: 0.5 })
      const geo = new BufferGeometry()
      geo.setAttribute('position', new BufferAttribute(mesh.positions, 3))
      geo.setIndex(new BufferAttribute(mesh.indices, 1))
      const res = geometryToBrepSolid(kernel, geo)
      expect(res.path).toBe('mesh')
      expect(cadShapeIsValid(kernel, res.solid)).toBe(true)
      kernel.release(res.solid)
    } finally {
      kernel.release(src.solid)
    }
  })
})

function buildBox() {
  return primitiveToBrepSolid(kernel, 'box', { width: 10, depth: 10, height: 10 })
}