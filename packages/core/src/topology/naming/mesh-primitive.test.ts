/**
 * naming/mesh-primitive.test.ts — M4 mesh/primitive 兼容测试（§5）
 *
 * Phase 1.8（D6）后的形态：
 * - **assignPrimitiveFaceRoles 已删除**——primitive 假拓扑不再派生 role
 *   （拓扑身份是 BREP 专有能力）。本文件改为钉住「primitive/mesh 行只填 hint、
 *   origin/role 显式 null」这一新契约。
 * - mesh hint-only：origin=null、role=null（GOTCHA：曾是 `role=''` + origin=part 名，
 *   1.8 后空串兜底已删，消费方不得再期待非空 role）。
 * - 链切换降级（§5.4）：BREP 面 hint 快照在解析时走 geometric-fallback
 */

import { describe, it, expect } from 'vitest'
import { asPartName } from '../../identity'
import { buildPartNaming } from './build-naming'
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- fixture kernel retained for future BREP 对照测试
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
    fillet: () => 1 as BrepHandle,
    filletVariable: () => 1 as BrepHandle,
    filletWithHistory: () => ({ result: 1 as BrepHandle, modified: [], generated: [], deleted: [] }),
    chamferWithHistory: () => ({ result: 1 as BrepHandle, modified: [], generated: [], deleted: [] }),
    // Phase 0.1：BrepEngineApi 补了 7 个 *WithHistory。测试 kernel 不提供面演化，
    // 以抛错桩显式暴露缺失 —— 注意不要改成 `as unknown as BrepEngineApi`：
    // 那会切断对象字面量的上下文类型，令上面所有箭头函数参数退化成 implicit any。
    translateWithHistory: (): never => { throw new Error('[test-kernel] translateWithHistory not provided') },
    rotateWithHistory: (): never => { throw new Error('[test-kernel] rotateWithHistory not provided') },
    mirrorWithHistory: (): never => { throw new Error('[test-kernel] mirrorWithHistory not provided') },
    scaleWithHistory: (): never => { throw new Error('[test-kernel] scaleWithHistory not provided') },
    shellWithHistory: (): never => { throw new Error('[test-kernel] shellWithHistory not provided') },
    offsetWithHistory: (): never => { throw new Error('[test-kernel] offsetWithHistory not provided') },
    thickenWithHistory: (): never => { throw new Error('[test-kernel] thickenWithHistory not provided') },
} as BrepEngineApi
}

// ── primitive 假拓扑已删（Phase 1.8 / D6）──
// GOTCHA：assignPrimitiveFaceRoles 曾按「固定面序 + 面行几何」给 primitive 面
// 派生语义 role（'box:top' 等）——那是 mesh 侧的伪拓扑：不跨 op 传播、不抗参数
// 变化，且与 roles.ts 的 ROLE_ASSIGNERS 是同一词汇表的第二次手抄。Phase 1.8
// 整体删除：primitive/mesh 的 naming 行只填 hint，origin/role 显式 null。
// 与预期不一致的消费方式（期待非空 role）必须改为按 null 显式分支。

describe('buildPartNaming primitive（Phase 1.8 后：无身份，只填 hint）', () => {
  it('emits origin=null / role=null rows for primitive parts (D6)', () => {
    const naming = buildPartNaming({
      source: 'primitive',
      partName: asPartName('cube1'),
      faces: cubeFaceRows,
      edges: [],
    })
    expect(naming.faceNaming).toHaveLength(cubeFaceRows.length)
    for (const row of naming.faceNaming) {
      expect(row.origin).toBeNull()
      expect(row.role).toBeNull()
      expect(row.hint.surfaceType).toBe('plane')
    }
  })
})

// ── mesh hint-only（§5.3）──

describe('mesh hint-only naming（§5.3 + Phase 1.8）', () => {
  it('fills only hints with origin=null / role=null for mesh parts (GOTCHA: was role="")', () => {
    const naming = buildPartNaming({
      source: 'mesh',
      partName: asPartName('stl1'),
      faces: [{ surfaceType: 'plane', normal: [0, 0, 1], center: [5, 5, 10], area: 42 }],
      edges: [{ length: 10, center: [0, 0, 10] }],
    })
    // Phase 1.8：role='' 静默兜底已删——无身份是显式 null，消费方按 null 分支
    expect(naming.faceNaming[0].role).toBeNull()
    expect(naming.faceNaming[0].origin).toBeNull()
    expect(naming.edgeNaming[0].faces).toBeNull() // 无邻接
  })

  it('captures a hint-only FaceTopoRef from a mesh naming row and resolves by geometry', () => {
    // STL 选面 → 几何兜底解析（§5.3）。身份字段为 null 的行不能构造 TopoRef——
    // 这里直接以 hint 构造 ref 验证「mesh 只能几何兜底」的解析路径仍可用。
    const naming = buildPartNaming({
      source: 'mesh',
      partName: asPartName('stl1'),
      faces: [{ surfaceType: 'plane', normal: [0, 0, 1], center: [5, 5, 10], area: 42 }],
      edges: [],
    })
    const ref: FaceTopoRef = {
      kind: 'face',
      origin: 's0' as never, // 无真实 StmtId 语境：只走几何兜底，origin 不参与匹配
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
      origin: 's_box' as never,
      role: 'top',
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
      origin: 's_box' as never,
      role: 'top',
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
