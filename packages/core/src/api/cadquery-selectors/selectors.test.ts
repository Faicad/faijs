/**
 * @vitest-environment node
 *
 * cadquery-selectors — in-process validation of the string-syntax selector
 * engine against the LOCKED cadquery 2.8.0 reference (plan §5.2 / §5.5.5).
 *
 * The reference probe (recording preserved under C:\cqenv\sel_probe.py and the
 * captured output referenced inline) established the ground truth for the
 * canonical fixture `box(1,1,1).translate((.5,.5,.5))` — a unit cube spanning
 * 0..1 in all axes. This suite re-derives those exact numbers through the
 * faijs OCCT kernel, so a passing run proves semantic parity.
 *
 * GOTCHA: bare `X` (and `+X`/`-X`) use DirectionSelector (signed angle≈0), so
 * only the +X face qualifies; `|X` (parallel) is sign-insensitive and returns
 * both X faces. `>X[k]` first applies a parallel pre-filter THEN the Nth step.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm, getKernel } from '../../occt-kernel/occtKernel'
import { primitiveToBrepSolid } from '../../primitives/brep-primitives'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import { parseSelector } from './grammar'
import { faceGeom, edgeGeom, vertexGeom, subShapeHandles } from './entity'
import { resolveSelection, resolveStepHandles, EmptyNthError } from './resolve'
import type { EntityGeom, ShapeHandle } from './entity'
import type { SelStep } from './types'

let kernel: BrepEngineApi

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel() as unknown as BrepEngineApi
}, 120000)

/** Build the unit cube spanning 0..1 (matches the reference `box(1,1,1)` probe). */
function unitCube(): ShapeHandle {
  const res = primitiveToBrepSolid(kernel, 'box', { width: 1, depth: 1, height: 1 })
  return res.solid as unknown as ShapeHandle
}

function project(solid: ShapeHandle, kind: 'face' | 'edge' | 'vertex'): EntityGeom[] {
  const handles = subShapeHandles(solid, kind)
  return handles.map((h) =>
    kind === 'face' ? faceGeom(h) : kind === 'edge' ? edgeGeom(h) : vertexGeom(h),
  )
}

function resolve(owner: ShapeHandle, kind: 'face' | 'edge' | 'vertex', src: string): EntityGeom[] {
  const handles = resolveStepHandles(owner, kind, src)
  return handles.map((h) =>
    kind === 'face' ? faceGeom(h) : kind === 'edge' ? edgeGeom(h) : vertexGeom(h),
  )
}

function resolveChain(src: ShapeHandle, chain: SelStep[]): EntityGeom[] {
  const { handles } = resolveSelection(src, chain)
  const kind = chain[chain.length - 1].kind
  return handles.map((h) =>
    kind === 'face' ? faceGeom(h) : kind === 'edge' ? edgeGeom(h) : vertexGeom(h),
  )
}

function centerSet(items: EntityGeom[]): string[] {
  return items.map((g) => {
    const c = g.center()
    return `${c.x},${c.y},${c.z}`
  }).sort()
}

describe('cadquery-selector parity: unit cube (box(1,1,1))', () => {
  let solid: ShapeHandle
  let faces: EntityGeom[]
  let edges: EntityGeom[]
  let verts: EntityGeom[]

  beforeAll(() => {
    solid = unitCube()
    faces = project(solid, 'face')
    edges = project(solid, 'edge')
    verts = project(solid, 'vertex')
    expect(faces.length).toBe(6)
    expect(edges.length).toBe(12)
    expect(verts.length).toBe(8)
  })

  describe('faces', () => {
    it('>Z picks the single top face', () => {
      const r = resolve(solid, 'face', '>Z')
      expect(r.length).toBe(1)
      expect(centerSet(r)).toEqual(['0.5,0.5,1'])
    })
    it('<Z picks the bottom face', () => {
      expect(centerSet(resolve(solid, 'face', '<Z'))).toEqual(['0.5,0.5,0'])
    })
    it('|Z returns both top and bottom faces', () => {
      expect(resolve(solid, 'face', '|Z').length).toBe(2)
    })
    it('#Z returns the 4 side faces (perpendicular to Z)', () => {
      expect(resolve(solid, 'face', '#Z').length).toBe(4)
    })
    it('|X returns the two +/-X faces (parallel, sign-insensitive)', () => {
      expect(resolve(solid, 'face', '|X').length).toBe(2)
    })
    it('bare X is DirectionSelector: only the +X face', () => {
      expect(centerSet(resolve(solid, 'face', 'X'))).toEqual(['1,0.5,0.5'])
    })
    it('+X equals bare X', () => {
      expect(centerSet(resolve(solid, 'face', '+X'))).toEqual(['1,0.5,0.5'])
    })
    it('-X picks the 0 face', () => {
      expect(centerSet(resolve(solid, 'face', '-X'))).toEqual(['0,0.5,0.5'])
    })
    it('|XY returns [] (no face normal parallel to (1,1,0))', () => {
      expect(resolve(solid, 'face', '|XY')).toEqual([])
    })
    it('+XY returns [] (DirectionSelector to (1,1,0))', () => {
      expect(resolve(solid, 'face', '+XY')).toEqual([])
    })
    it('>XY picks the 2-face tied extreme cluster', () => {
      const r = resolve(solid, 'face', '>XY')
      expect(r.length).toBe(2)
      expect(centerSet(r)).toEqual(['0.5,1,0.5', '1,0.5,0.5'].sort())
    })
    it('%PLANE selects all 6', () => {
      expect(resolve(solid, 'face', '%PLANE').length).toBe(6)
    })
    it('%CYLINDER selects none', () => {
      expect(resolve(solid, 'face', '%CYLINDER')).toEqual([])
    })
    it('>Z[-2] is the bottom face (Python negative index)', () => {
      expect(centerSet(resolve(solid, 'face', '>Z[-2]'))).toEqual(['0.5,0.5,0'])
    })
    it('>Z[0] / >Z[1] = bottom / top (DirectionNth over parallel pre-filter)', () => {
      expect(centerSet(resolve(solid, 'face', '>Z[0]'))).toEqual(['0.5,0.5,0'])
      expect(centerSet(resolve(solid, 'face', '>Z[1]'))).toEqual(['0.5,0.5,1'])
    })
    it('constraints: >Z and %PLANE', () => {
      expect(resolve(solid, 'face', '>Z and %PLANE').length).toBe(1)
    })
    it('or: X or Z = the +X face + the +Z face', () => {
      expect(centerSet(resolve(solid, 'face', 'X or Z'))).toEqual(['0.5,0.5,1', '1,0.5,0.5'].sort())
    })
    it('named views: front=maxZ, bottom=minY', () => {
      expect(centerSet(resolve(solid, 'face', 'top'))).toEqual(['0.5,1,0.5'])
      expect(centerSet(resolve(solid, 'face', 'bottom'))).toEqual(['0.5,0,0.5'])
    })
  })

  describe('edges', () => {
    it('|Z returns the 4 vertical edges (tangent parallel Z)', () => {
      const r = resolve(solid, 'edge', '|Z')
      expect(r.length).toBe(4)
      expect(centerSet(r)).toEqual(['0,0,0.5', '0,1,0.5', '1,0,0.5', '1,1,0.5'].sort())
    })
    it('#Z returns the 8 horizontal edges (perpendicular Z)', () => {
      expect(resolve(solid, 'edge', '#Z').length).toBe(8)
    })
    it('>>Z (max cluster) returns the 4 top edges', () => {
      const r = resolve(solid, 'edge', '>>Z')
      expect(r.length).toBe(4)
      expect(centerSet(r)).toEqual(['0,0.5,1', '0.5,0,1', '0.5,1,1', '1,0.5,1'].sort())
    })
    it('<<Z returns the 4 bottom edges', () => {
      expect(resolve(solid, 'edge', '<<Z').length).toBe(4)
    })
    it('%LINE selects all 12', () => {
      expect(resolve(solid, 'edge', '%LINE').length).toBe(12)
    })
    it('%CIRCLE selects none', () => {
      expect(resolve(solid, 'edge', '%CIRCLE')).toEqual([])
    })
    it('bare X picks the 4 tangent-parallel edges', () => {
      const r = resolve(solid, 'edge', 'X')
      expect(r.length).toBe(4)
      expect(centerSet(r)).toEqual(['0.5,0,0', '0.5,0,1', '0.5,1,0', '0.5,1,1'].sort())
    })
    it('+X or +Y union = 8', () => {
      expect(resolve(solid, 'edge', '+X or +Y').length).toBe(8)
    })
  })

  describe('vertices', () => {
    // The base direction operators DO NOT test vertices (BaseDirSelector skips
    // non-face / non-edge entities), so these are all empty.
    it('|Z / #Z / +Z / bare X all return [] for vertices', () => {
      expect(resolve(solid, 'vertex', '|Z')).toEqual([])
      expect(resolve(solid, 'vertex', '#Z')).toEqual([])
      expect(resolve(solid, 'vertex', '+Z')).toEqual([])
      expect(resolve(solid, 'vertex', 'X')).toEqual([])
    })
    // Cluster-based selectors DO apply to vertices (CenterNth / DirectionMinMax).
    it('>Z picks the 4 top vertices', () => {
      expect(resolve(solid, 'vertex', '>Z').length).toBe(4)
    })
    it('>>Z / <<Z return 4 top / 4 bottom', () => {
      expect(resolve(solid, 'vertex', '>>Z').length).toBe(4)
      expect(resolve(solid, 'vertex', '<<Z').length).toBe(4)
    })
    it('>XY picks the 2 tied-far corners', () => {
      const r = resolve(solid, 'vertex', '>XY')
      expect(r.length).toBe(2)
      expect(centerSet(r)).toEqual(['1,1,0', '1,1,1'].sort())
    })
    it('>(1,0,0) picks the 4 x=1 vertices', () => {
      expect(resolve(solid, 'vertex', '>(1,0,0)').length).toBe(4)
    })
    it('>Z[1] raises an error (direction pre-filter is empty for vertices)', () => {
      expect(() => resolve(solid, 'vertex', '>Z[1]')).toThrow(EmptyNthError)
    })
    it('%VERTEX is a grammar/syntax error (VERTEX is not a valid type name)', () => {
      expect(() => parseSelector('%VERTEX')).toThrow()
    })
    it('X and Y returns []', () => {
      expect(resolve(solid, 'vertex', 'X and Y')).toEqual([])
    })
  })

  describe('selChain narrowing', () => {
    // CadQuery `_collectProperty` + `_filter`: each step narrows the candidate
    // sub-entity set of the previous step's survivors (plan §4.5, matrix C1-C5).
    it('faces(">Z").vertices()=4 (top face only, not all 8)', () => {
      expect(resolveChain(solid, [{ kind: 'face', sel: '>Z' }, { kind: 'vertex', sel: '' }]).length).toBe(4)
    })
    it('faces("|Z").vertices()=8 (top+bottom faces)', () => {
      expect(resolveChain(solid, [{ kind: 'face', sel: '|Z' }, { kind: 'vertex', sel: '' }]).length).toBe(8)
    })
    it('faces(">Z").vertices("<XY")=(0,0,1) — the top face vert with min x+y', () => {
      const r = resolveChain(solid, [{ kind: 'face', sel: '>Z' }, { kind: 'vertex', sel: '<XY' }])
      expect(r.length).toBe(1)
      expect(centerSet(r)).toEqual(['0,0,1'])
    })
    it('empty narrowing: vertices().edges()=0, edges().faces()=0', () => {
      expect(resolveChain(solid, [{ kind: 'vertex', sel: '' }, { kind: 'edge', sel: '' }])).toEqual([])
      expect(resolveChain(solid, [{ kind: 'edge', sel: '' }, { kind: 'face', sel: '' }])).toEqual([])
    })
  })
})