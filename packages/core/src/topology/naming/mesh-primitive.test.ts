/**
 * naming/mesh-primitive.test.ts — M4 mesh/primitive 兼容测试（§5）
 *
 * - assignPrimitiveFaceRoles：primitive 假拓扑「固定面序 → 语义 role」，
 *   与 BREP assignRoles 同一套命名器对照一致（cube 六面）
 * - buildPartNaming primitive 分支：role 来自 primitiveRoles
 * - mesh hint-only：role=''，只能几何兜底
 * - 链切换降级（§5.4）：BREP 面 hint 快照在解析时走 geometric-fallback
 */

import { describe, it, expect } from 'vitest'
import { asPartName } from '../../identity'
import { assignPrimitiveFaceRoles, buildPartNaming } from './build-naming'
import { assignRoles } from './roles'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { BrepHandle } from '../../brep/engine/types'
import { resolveFaceTopo, type ResolutionContext } from './resolve-face'
import { resolveTopoRef } from './resolver'
import type { FaceTopoRef } from './types'

// ── cube 固定面序（与 3d_editor lib/primitives-topology/cube.ts 一致：+X,-X,+Y,-Y,+Z,-Z）──

const cubeFaceRows = [
  { surfaceType: 'plane', normal: [1, 0, 0], center: [5, 5, 5], area: 100 },
  { surfaceType: 'plane', normal: [-1, 0, 0], center: [0, 5, 5], area: 100 },
  { surfaceType: 'plane', normal: [0, 1, 0], center: [5, 5, 5], area: 100 },
  { surfaceType: 'plane', normal: [0, -1, 0], center: [5, 0, 5], area: 100 },
  { surfaceType: 'plane', normal: [0, 0, 1], center: [5, 5, 10], area: 100 },
  { surfaceType: 'plane', normal: [0, 0, -1], center: [5, 5, 0], area: 100 },
]

// ── fake kernel（BREP assignRoles 对照用，可枚举面描述）──

function fakeKernel(faces: Array<{ surfaceType: string; normal: [number, number, number]; center: [number, number, number] }>): BrepEngineApi {
  const handles = faces.map((_, i) => (i + 1) as BrepHandle)
  const byHandle = new Map<number, (typeof faces)[number]>()
  faces.forEach((f, i) => byHandle.set(i + 1, f))
  return {
    getSubShapes: (shape: BrepHandle, type: string) =>
      type === 'face' ? [...handles] : type === 'solid' ? [shape] : [],
    subShapeHashes: (shape: BrepHandle, type: string) => (type === 'face' ? handles.map((h) => h) : []),
    surfaceType: (face: BrepHandle) => byHandle.get(face)?.surfaceType ?? 'plane',
    surfaceNormal: (face: BrepHandle) => {
      const n = byHandle.get(face)?.normal ?? [0, 0, 1]
      return { x: n[0], y: n[1], z: n[2] }
    },
    uvBounds: () => ({ uMin: 0, uMax: 1, vMin: 0, vMax: 1 }),
    getSurfaceCenterOfMass: (face: BrepHandle) => {
      const c = byHandle.get(face)?.center ?? [0, 0, 0]
      return { x: c[0], y: c[1], z: c[2] }
    },
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
  } as BrepEngineApi
}

// ── assignPrimitiveFaceRoles ──

describe('assignPrimitiveFaceRoles（§5.2 primitive 语义命名）', () => {
  it('names the cube fixed face order with box semantics (matches BREP assignRoles)', () => {
    const roles = assignPrimitiveFaceRoles(cubeFaceRows, asPartName('cube1'))
    expect(roles).toEqual([
      'box:right',   // f0 +X
      'box:left',    // f1 -X
      'box:back',    // f2 +Y
      'box:front',   // f3 -Y
      'box:top',     // f4 +Z
      'box:bottom',  // f5 -Z
    ])
  })

  it('produces the same roles as BREP assignRoles on the same cube', () => {
    // BREP 真拓扑：同一 cube 六面 → 语义名对照一致（§3.2 对照表）
    const kernel = fakeKernel(cubeFaceRows.map((r) => ({
      surfaceType: r.surfaceType!,
      normal: r.normal as [number, number, number],
      center: r.center as [number, number, number],
    })))
    const brepRoles = assignRoles(kernel, 1 as BrepHandle, 'box')
    const primitiveRoles = assignPrimitiveFaceRoles(cubeFaceRows, asPartName('cube1'))
    // 语义名集合一致（顺序可能不同——BREP 按 TopExp 枚举序，primitive 按固定面序）
    expect(new Set([...brepRoles.keys()])).toEqual(new Set(primitiveRoles))
  })

  it('names cylinder lateral + planar caps, and falls back to positional', () => {
    // primitive 无 opType 信息：平面端盖按几何命名（+Z plane → box:top，与 cube 同命名器）；
    // BREP 的 cylinderRole 会给 cylinder:top/bottom（语义名集合在 cube 上完全一致，见上一测试）
    const roles = assignPrimitiveFaceRoles([
      { surfaceType: 'cylinder', normal: [0, 0, 0], center: [0, 0, 5], area: 100 },
      { surfaceType: 'plane', normal: [0, 0, 1], center: [0, 0, 10], area: 100 },
      { surfaceType: 'plane', normal: [0.3, 0.3, 0.3], center: [0, 0, 0], area: 100 },
    ], asPartName('cyl1'))
    expect(roles).toEqual(['cylinder:lateral', 'box:top', 'cyl1:face_2'])
  })

  it('guarantees every face gets a role', () => {
    const roles = assignPrimitiveFaceRoles([
      { surfaceType: 'torus', center: [0, 0, 0], area: 100 },
    ], asPartName('weird1'))
    expect(roles).toEqual(['weird1:face_0'])
  })
})

// ── buildPartNaming primitive 分支 ──

describe('buildPartNaming primitive（§5.2）', () => {
  it('uses semantic roles for primitive parts', () => {
    const naming = buildPartNaming({
      source: 'primitive',
      partName: asPartName('cube1'),
      faces: cubeFaceRows,
      edges: [],
      primitiveRoles: assignPrimitiveFaceRoles(cubeFaceRows, asPartName('cube1')),
    })
    expect(naming.faceNaming[4].role).toBe('box:top')
    expect(naming.faceNaming[4].origin).toBe(asPartName('cube1'))
    expect(naming.faceNaming[0].hint.surfaceType).toBe('plane')
  })
})

// ── mesh hint-only（§5.3）──

describe('mesh hint-only naming（§5.3）', () => {
  it('fills only hints with role="" for mesh parts', () => {
    const naming = buildPartNaming({
      source: 'mesh',
      partName: asPartName('stl1'),
      faces: [{ surfaceType: 'plane', normal: [0, 0, 1], center: [5, 5, 10], area: 42 }],
      edges: [{ length: 10, center: [0, 0, 10] }],
    })
    expect(naming.faceNaming[0].role).toBe('')
    expect(naming.faceNaming[0].origin).toBe(asPartName('stl1'))
    expect(naming.edgeNaming[0].faces).toBeNull() // 无邻接
  })

  it('captures a hint-only FaceTopoRef from a mesh naming row and resolves by geometry', () => {
    // STL 选面 → FaceTopoRef{ role:'', hint }（§5.3）
    const naming = buildPartNaming({
      source: 'mesh',
      partName: asPartName('stl1'),
      faces: [{ surfaceType: 'plane', normal: [0, 0, 1], center: [5, 5, 10], area: 42 }],
      edges: [],
    })
    const ref: FaceTopoRef = {
      kind: 'face',
      origin: asPartName('stl1'),
      role: '',
      hint: { kind: 'face', surfaceType: 'plane', normal: [0, 0, 1], center: [5, 5, 10], area: 42 },
    }
    // 解析走「面 hint 快照」geometric-fallback（无 roleTable）
    const ctx: ResolutionContext = {
      kernel: null,
      faces: [{ ordinal: 1, row: naming.faceNaming[0].hint }],
    }
    const res = resolveFaceTopo(ref, ctx)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.ordinal).toBe(1)
      expect(res.confidence).toBe('geometric-fallback')
    }
  })
})

// ── 链切换降级（§5.4）──

describe('链切换降级（§5.4 reference-resolution degradation）', () => {
  it('resolves a BREP-face TopoRef through the face-hint snapshot after the chain drops to mesh', () => {
    // 切换点：solid 句柄消失、hash 血缘终止，但 {origin,role} 与 hint 作为纯数据保留。
    // 该 part 的 roleTable 不再更新/不再适用（mesh 快照无 hash）→ 解析走面 hint 快照几何兜底。
    const ref: FaceTopoRef = {
      kind: 'face',
      origin: asPartName('box'),
      role: 'box:top',
      hint: { kind: 'face', surfaceType: 'plane', normal: [0, 0, 1], center: [5, 5, 10], area: 100 },
    }
    const hintSnapshot = { surfaceType: 'plane', normal: [0, 0, 1], center: [5, 5, 10], area: 100 }
    const ctx: ResolutionContext = {
      kernel: null,
      faces: [{ ordinal: 3, row: hintSnapshot }],
      // 链切换后 roleTable 不适用于 mesh 快照：缺省（不传）→ 只走几何兜底
    }
    const res = resolveFaceTopo(ref, ctx)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.ordinal).toBe(3)
      expect(res.confidence).toBe('geometric-fallback')
    }
  })

  it('reports not-found when the degraded hint matches nothing (explicit, no silent ordinal)', () => {
    const ref: FaceTopoRef = {
      kind: 'face',
      origin: asPartName('box'),
      role: 'box:top',
      hint: { kind: 'face', surfaceType: 'plane', normal: [0, 0, 1], center: [5, 5, 10], area: 100 },
    }
    const ctx: ResolutionContext = {
      kernel: null,
      faces: [{ ordinal: 1, row: { surfaceType: 'cylinder', center: [100, 100, 100] } }],
    }
    try {
      resolveTopoRef(ref, ctx)
      expect.unreachable('should have thrown')
    } catch (e) {
      expect((e as { code?: string }).code).toBe('E_TOPO_NOT_FOUND')
    }
  })
})
