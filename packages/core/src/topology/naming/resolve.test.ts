/**
 * naming/resolve.test.ts — M2 面解析全链路测试
 *
 * resolveFaceTopo / resolveTopoRef / resolveTopoArgs / captureTopoRef /
 * buildPartNaming：全部纯函数，不 init wasm（fake kernel 驱动 BREP 现场打分，
 * row 快照驱动 mesh/primitive 打分）。
 */

import { describe, it, expect } from 'vitest'
import { asPartName } from '../../identity'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { BrepHandle } from '../../brep/engine/types'
import { resolveFaceTopo, type FaceCandidateEntry, type ResolutionContext } from './resolve-face'
import { resolveTopoRef, buildTopoError } from './resolver'
import { resolveTopoArgs, originOf } from './ref-params'
import { captureTopoRef } from './capture-topo-ref'
import { buildPartNaming, findOriginRole } from './build-naming'
import type { FaceHint, FaceTopoRef, RoleTable } from './types'

// ── fake kernel（平面，可切换法向/中心）──

function planeKernel(normal: [number, number, number], center: [number, number, number]): BrepEngineApi {
  return {
    getSubShapes: () => [],
    subShapeHashes: () => [],
    surfaceType: () => 'plane',
    surfaceNormal: () => ({ x: normal[0], y: normal[1], z: normal[2] }),
    uvBounds: () => ({ uMin: 0, uMax: 1, vMin: 0, vMax: 1 }),
    getSurfaceCenterOfMass: () => ({ x: center[0], y: center[1], z: center[2] }),
    release: () => undefined,
    hashCode: (h) => h as unknown as number,
    isSame: (a, b) => a === b,
    isSolid: () => true,
    shapeOrientation: () => 'forward',
    curveType: () => 'line',
    curvePointAtParam: () => ({ x: 0, y: 0, z: 0 }),
    curveTangent: () => ({ x: 1, y: 0, z: 0 }),
    curveParameters: () => ({ first: 0, last: 1 }),
    curveIsClosed: () => false,
    curveLength: () => 0,
    pointOnSurface: () => ({ x: 0, y: 0, z: 0 }),
    getFaceCylinderData: () => null,
    getNurbsCurveData: () => null,
    getBoundingBox: () => ({ xmin: 0, ymin: 0, zmin: 0, xmax: 1, ymax: 1, zmax: 1 }),
    getVolume: () => 1,
    getCenterOfMass: () => ({ x: 0, y: 0, z: 0 }),
    isValid: () => true,
    unifySameDomain: (s) => s,
    healSolid: (s) => s,
    fixShape: (s) => s,
    fixFaceOrientations: (s) => s,
    removeDegenerateEdges: (s) => s,
    queryBatch: () => [],
    meshShape: () => ({ positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0), vertexCount: 0, triangleCount: 0 }),
    wireframe: () => ({ points: new Float32Array(0), edgeGroups: new Int32Array(0), pointCount: 0, edgeCount: 0 }),
    makeBox: () => 1 as BrepHandle,
    makeBoxFromCorners: () => 1 as BrepHandle,
    makeCylinder: () => 1 as BrepHandle,
    makeSphere: () => 1 as BrepHandle,
    makeCone: () => 1 as BrepHandle,
    makeRectangle: () => 1 as BrepHandle,
    extrude: () => 1 as BrepHandle,
    loft: () => 1 as BrepHandle,
    fuse: (a) => a,
    cut: (a) => a,
    common: (a) => a,
    intersect: (a) => a,
    section: () => 1 as BrepHandle,
    fuseAll: (ss) => ss[0] ?? (1 as BrepHandle),
    translate: (s) => s,
    scale: (s) => s,
    transform: (s) => s,
    located: (s) => s,
    generalTransform: (s) => s,
    copy: (s) => s,
    makeLineEdge: () => 1 as BrepHandle,
    makeArcEdge: () => 1 as BrepHandle,
    makeBezierEdge: () => 1 as BrepHandle,
    makeWire: () => 1 as BrepHandle,
    makeFace: () => 1 as BrepHandle,
    makeCompound: () => 1 as BrepHandle,
    sewAndSolidify: () => 1 as BrepHandle,
    buildTriFace: () => 1 as BrepHandle,
    addHolesInFace: () => 1 as BrepHandle,
    importStep: () => 1 as BrepHandle,
    exportStep: () => '',
    importStl: () => 1 as BrepHandle,
    fromBREP: () => 1 as BrepHandle,
    cutWithHistory: () => ({ result: 1 as BrepHandle, modified: [], generated: [], deleted: [] }),
    fuseWithHistory: () => ({ result: 1 as BrepHandle, modified: [], generated: [], deleted: [] }),
    intersectWithHistory: () => ({ result: 1 as BrepHandle, modified: [], generated: [], deleted: [] }),
    createXCAFDocument: () => ({ addShape: () => undefined, exportSTEP: () => '', close: () => undefined }),
    importXCAFFromSTEP: () => ({ addShape: () => undefined, exportSTEP: () => '', close: () => undefined }),
    chamfer: () => 1 as BrepHandle,
    chamferDistAngle: () => 1 as BrepHandle,
    fillet: () => 1 as BrepHandle,
    filletVariable: () => 1 as BrepHandle,
    filletWithHistory: () => ({ result: 1 as BrepHandle, modified: [], generated: [], deleted: [] }),
    chamferWithHistory: () => ({ result: 1 as BrepHandle, modified: [], generated: [], deleted: [] }),
} as BrepEngineApi
}

/** box 六面候选（序号 1..6，hash 11..16；+X,-X,+Y,-Y,+Z,-Z 语义序）。 */
function boxCandidates(): FaceCandidateEntry[] {
  return [
    { ordinal: 1, hash: 11, handle: 1 as BrepHandle },
    { ordinal: 2, hash: 12, handle: 2 as BrepHandle },
    { ordinal: 3, hash: 13, handle: 3 as BrepHandle },
    { ordinal: 4, hash: 14, handle: 4 as BrepHandle },
    { ordinal: 5, hash: 15, handle: 5 as BrepHandle },
    { ordinal: 6, hash: 16, handle: 6 as BrepHandle },
  ]
}

const boxTable: RoleTable = new Map([
  [asPartName('box'), new Map([
    ['box:top', [15]],
    ['box:bottom', [16]],
    ['box:front', [14]],
  ])],
])

const boxRef = (role: string, hint?: Partial<FaceHint>): FaceTopoRef => ({
  kind: 'face',
  origin: asPartName('box'),
  role,
  hint: { kind: 'face', surfaceType: 'plane', normal: [0, 0, 1], center: [5, 5, 10], ...hint },
})

function ctxFor(kernel: BrepEngineApi, faces: FaceCandidateEntry[], roleTable?: RoleTable): ResolutionContext {
  return { kernel, faces, roleTable }
}

// ── resolveFaceTopo：exact / deleted / 分裂 / 几何兜底 / ambiguous / not-found ──

describe('resolveFaceTopo', () => {
  it('resolves an untouched role exactly (box:bottom 未受影响面 exact 命中)', () => {
    const kernel = planeKernel([0, 0, -1], [5, 5, 0])
    const res = resolveFaceTopo(boxRef('box:bottom'), ctxFor(kernel, boxCandidates(), boxTable))
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.ordinal).toBe(6)
      expect(res.confidence).toBe('exact')
    }
  })

  it('reports deleted when the role was removed by an upstream edit', () => {
    const kernel = planeKernel([0, 0, 1], [5, 5, 10])
    // front 的 hash 14 在完整候选中存在；构造候选只有 1..3，front(14) 被删
    const shrunk = boxCandidates().filter((c) => c.ordinal <= 3)
    const res2 = resolveFaceTopo(boxRef('box:front'), ctxFor(kernel, shrunk, boxTable))
    expect(res2.ok).toBe(false)
    if (!res2.ok) expect(res2.reason).toBe('deleted')
  })

  it('disambiguates a 1→many split only among the survivors', () => {
    // top 面（hash 15）分裂成 15a/15b 两个候选，hint 匹配 15b
    const faces: FaceCandidateEntry[] = [
      { ordinal: 1, hash: 11, handle: 1 as BrepHandle },
      { ordinal: 2, hash: 15, handle: 2 as BrepHandle },
      { ordinal: 3, hash: 15, handle: 3 as BrepHandle },
    ]
    // 只让 ordinal 3 匹配 hint（center 接近 10；ordinal 2 的中心远到分差 ≥ 0.1）
    const kernelMatch = {
      ...planeKernel([0, 0, 1], [5, 5, 10]),
      getSurfaceCenterOfMass: (h: BrepHandle) =>
        (h as unknown as number) === 3 ? { x: 5, y: 5, z: 10 } : { x: 5, y: 5, z: 20 },
    } as BrepEngineApi
    const res = resolveFaceTopo(boxRef('box:top'), ctxFor(kernelMatch, faces, boxTable))
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.ordinal).toBe(3)
      expect(res.confidence).toBe('geometric-fallback')
    }
  })

  it('falls back to whole-shape geometry when the role is not tracked', () => {
    // 单个匹配候选（无 roleTable → 只走几何兜底）；对称多候选会 ambiguous（R5）
    const kernel = planeKernel([0, 0, 1], [5, 5, 10])
    const faces: FaceCandidateEntry[] = [{ ordinal: 1, hash: 11, handle: 1 as BrepHandle }]
    const noTable = ctxFor(kernel, faces)
    const res = resolveFaceTopo(boxRef('box:top'), noTable)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.confidence).toBe('geometric-fallback')
  })

  it('reports ambiguous for tied candidates', () => {
    // 两候选同法向同中心（对称几何，R5）→ ambiguous
    const kernel = planeKernel([0, 0, 1], [5, 5, 10])
    const faces: FaceCandidateEntry[] = [
      { ordinal: 1, hash: 11, handle: 1 as BrepHandle },
      { ordinal: 2, hash: 12, handle: 2 as BrepHandle },
    ]
    const res = resolveFaceTopo(boxRef('box:top'), ctxFor(kernel, faces))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('ambiguous')
  })

  it('reports not-found when nothing clears the minimum score', () => {
    // 候选是 cylinder 面而 hint 是 plane → 类型硬门全拒 → not-found
    const kernel = { ...planeKernel([0, 0, 1], [5, 5, 10]), surfaceType: () => 'cylinder' } as BrepEngineApi
    const faces: FaceCandidateEntry[] = [{ ordinal: 1, hash: 11, handle: 1 as BrepHandle }]
    const res = resolveFaceTopo(boxRef('box:top'), ctxFor(kernel, faces))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('not-found')
  })
})

// ── resolveTopoRef / buildTopoError ──

describe('resolveTopoRef / buildTopoError', () => {
  it('returns { ordinal, handle } on success', () => {
    const kernel = planeKernel([0, 0, -1], [5, 5, 0])
    const entity = resolveTopoRef(boxRef('box:bottom'), ctxFor(kernel, boxCandidates(), boxTable))
    expect(entity.ordinal).toBe(6)
    expect(entity.handle).toBe(6)
  })

  it('throws TopoRefError with E_TOPO_DELETED on deletion', () => {
    const kernel = planeKernel([0, 0, 1], [5, 5, 10])
    const shrunk = boxCandidates().filter((c) => c.ordinal <= 3)
    try {
      resolveTopoRef(boxRef('box:front'), ctxFor(kernel, shrunk, boxTable))
      expect.unreachable('should have thrown')
    } catch (e) {
      const err = e as { code?: string; refKind?: string }
      expect(err.code).toBe('E_TOPO_DELETED')
      expect(err.refKind).toBe('face')
    }
  })

  it('builds the three error codes from reasons', () => {
    expect(buildTopoError('deleted', 'face').code).toBe('E_TOPO_DELETED')
    expect(buildTopoError('ambiguous', 'face').code).toBe('E_TOPO_AMBIGUOUS')
    expect(buildTopoError('not-found', 'face').code).toBe('E_TOPO_NOT_FOUND')
  })

  it('resolves edge refs through the lineage resolver (M3)', () => {
    const kernel = planeKernel([0, 0, 1], [5, 5, 10])
    const edgeRef = {
      kind: 'edge' as const,
      faces: [{ origin: asPartName('box'), role: 'box:top' }, { origin: asPartName('box'), role: 'box:front' }] as const,
      hint: { kind: 'edge' as const, length: 10 },
    }
    // 无邻接 → hint-only 兜底；无 edges 表 → not-found（E_TOPO_NOT_FOUND）
    try {
      resolveTopoRef(edgeRef, ctxFor(kernel, boxCandidates(), boxTable))
      expect.unreachable('should have thrown')
    } catch (e) {
      const err = e as { code?: string; refKind?: string }
      expect(err.code).toBe('E_TOPO_NOT_FOUND')
      expect(err.refKind).toBe('edge')
    }
  })
})

// ── resolveTopoArgs / originOf ──

describe('resolveTopoArgs / originOf', () => {
  it('recursively replaces TopoRefs in params (arrays + nested objects)', () => {
    const kernel = planeKernel([0, 0, -1], [5, 5, 0])
    const ctx = ctxFor(kernel, boxCandidates(), boxTable)
    const lookup = (origin: string) => (origin === 'box' ? ctx : undefined)
    const resolved = resolveTopoArgs({
      face: boxRef('box:bottom'),
      edges: [boxRef('box:top'), { nested: { f: boxRef('box:front') } }],
      plain: 42,
    }, lookup)
    expect(resolved.face).toEqual({ ordinal: 6, handle: 6 })
    expect((resolved.edges as unknown[])[0]).toEqual({ ordinal: 5, handle: 5 })
    expect((resolved.edges as unknown[])[1]).toEqual({ nested: { f: { ordinal: 4, handle: 4 } } })
    expect(resolved.plain).toBe(42)
  })

  it('throws when a ref origin has no input shape', () => {
    expect(() => resolveTopoArgs({ face: boxRef('box:top') }, () => undefined))
      .toThrowError(/no input shape/)
  })

  it('derives origin for edge refs from faces[0]', () => {
    const edgeRef = {
      kind: 'edge' as const,
      faces: [{ origin: asPartName('box'), role: 'box:top' }, { origin: asPartName('box'), role: 'box:front' }] as const,
      hint: { kind: 'edge' as const },
    }
    expect(originOf(edgeRef)).toBe('box')
  })
})

// ── captureTopoRef ──

describe('captureTopoRef', () => {
  it('converts a face naming row to a FaceTopoRef', () => {
    const ref = captureTopoRef({
      origin: asPartName('box'),
      role: 'box:top',
      hint: { kind: 'face', surfaceType: 'plane' },
    })
    expect(ref).toEqual({ kind: 'face', origin: asPartName('box'), role: 'box:top', hint: { kind: 'face', surfaceType: 'plane' } })
  })

  it('converts an edge naming row with lineage to an EdgeTopoRef', () => {
    const ref = captureTopoRef({
      faces: [{ origin: asPartName('box'), role: 'box:top' }, { origin: asPartName('box'), role: 'box:front' }],
      hint: { kind: 'edge', length: 10 },
    })
    expect(ref.kind).toBe('edge')
    if (ref.kind === 'edge') expect(ref.faces[0].role).toBe('box:top')
  })

  it('throws for an edge naming row without lineage (mesh limitation)', () => {
    expect(() => captureTopoRef({ faces: null, hint: { kind: 'edge', length: 10 } }))
      .toThrowError(/no adjacent-face lineage/)
  })
})

// ── buildPartNaming / findOriginRole ──

describe('buildPartNaming / findOriginRole', () => {
  const ordinalToHash = [11, 12, 13, 14, 15, 16]

  it('finds the origin+role of an ordinal across multiple origins (boolean merge)', () => {
    const merged: RoleTable = new Map([
      [asPartName('box'), new Map([['box:top', [15]]])],
      [asPartName('tool'), new Map([['tool:lateral', [11]]])],
    ])
    expect(findOriginRole(merged, ordinalToHash, 5)).toEqual({ origin: asPartName('box'), role: 'box:top' })
    expect(findOriginRole(merged, ordinalToHash, 1)).toEqual({ origin: asPartName('tool'), role: 'tool:lateral' })
    expect(findOriginRole(merged, ordinalToHash, 3)).toBeUndefined()
  })

  it('builds BREP naming rows with origin+role', () => {
    // ordinalToHash：下标 i ↔ 序号 i+1；[11, 15, 16] → 序号 1→11、2→15、3→16
    const ordinalToHash = [11, 15, 16]
    const naming = buildPartNaming({
      source: 'brep',
      partName: asPartName('part0'),
      faces: [
        { surfaceType: 'plane', normal: [1, 0, 0], center: [5, 5, 5], area: 100 },
        { surfaceType: 'plane', normal: [0, 0, 1], center: [5, 5, 10], area: 100 },
        { surfaceType: 'plane', normal: [0, 0, -1], center: [5, 5, 0], area: 100 },
      ],
      edges: [{ length: 10, center: [0, 0, 10] }],
      roleTable: boxTable,
      ordinalToHash,
      edgeFaceOrdinals: [[2, 3]],
    })
    expect(naming.faceNaming[0].role).toBe('') // hash 11 不在表里 → 空 role
    expect(naming.faceNaming[1].role).toBe('box:top')
    expect(naming.faceNaming[1].origin).toBe(asPartName('box'))
    expect(naming.faceNaming[2].role).toBe('box:bottom')
    expect(naming.edgeNaming[0].faces).toEqual([
      { origin: asPartName('box'), role: 'box:top' },
      { origin: asPartName('box'), role: 'box:bottom' },
    ])
  })

  it('builds mesh naming rows hint-only (role="")', () => {
    const naming = buildPartNaming({
      source: 'mesh',
      partName: asPartName('stl1'),
      faces: [{ surfaceType: 'plane', normal: [0, 0, 1], center: [5, 5, 10], area: 42 }],
      edges: [],
    })
    expect(naming.faceNaming[0].role).toBe('')
    expect(naming.faceNaming[0].origin).toBe(asPartName('stl1'))
    expect(naming.faceNaming[0].hint.surfaceType).toBe('plane')
  })

  it('uses primitiveRoles for primitive parts', () => {
    const naming = buildPartNaming({
      source: 'primitive',
      partName: asPartName('cube1'),
      faces: [{ surfaceType: 'plane', normal: [1, 0, 0], center: [5, 5, 5], area: 100 }],
      edges: [],
      primitiveRoles: ['box:right'],
    })
    expect(naming.faceNaming[0].role).toBe('box:right')
  })
})
