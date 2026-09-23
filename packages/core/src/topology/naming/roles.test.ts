/**
 * naming/roles.test.ts — M0 纯函数测试（roles 传播/合并/位置名/反查 + assignRoles）
 *
 * 不 init wasm：assignRoles 用可枚举的 fake kernel（句柄 → 预置面描述），
 * 其余是纯 Map 逻辑。
 */

import { describe, it, expect } from 'vitest'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { BrepHandle, BrepSubShapeType } from '../../brep/engine/types'

import {
  assignRoles,
  boxRoleFromNormal,
  nextHashes,
  propagateRoles,
  mergeRoleTables,
  roleOfOrdinal,
} from './roles'
import { formatRoleName } from './role-name'
import type { HashEvolution } from './roles'
import type { RoleTable } from './types'

// ── fake kernel：可枚举的面描述（handle → surfaceType/normal/center）──

interface FakeFace {
  surfaceType: string
  normal: [number, number, number]
  center: [number, number, number]
}

function fakeKernel(faces: FakeFace[]): BrepEngineApi {
  const handles = faces.map((_, i) => (i + 1) as BrepHandle)
  const byHandle = new Map<number, FakeFace>()
  faces.forEach((f, i) => byHandle.set(i + 1, f))
  return {
    getSubShapes: (shape: BrepHandle, type: BrepSubShapeType) =>
      type === 'face' ? [...handles] : type === 'solid' ? [shape] : [],
    subShapeHashes: (shape: BrepHandle, type: BrepSubShapeType) =>
      type === 'face' ? handles.map((h) => h) : [],
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
    hashCode: (shape: BrepHandle) => shape as unknown as number,
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
    linearPattern: () => [],
    circularPattern: () => [],
    gridPattern: () => 0 as unknown as never,
    // Phase 3 登记方法（capability-map 64 方法收口）：fake kernel 不实现 —— 显式暴露缺失（同 *WithHistory 桩纪律，不伪造）。
    boundingBox: () => { throw new Error('not implemented: boundingBox') },
    shapeType: () => { throw new Error('not implemented: shapeType') },
    isNull: () => { throw new Error('not implemented: isNull') },
    iterShapes: () => { throw new Error('not implemented: iterShapes') },
    surfaceCenterOfMass: () => { throw new Error('not implemented: surfaceCenterOfMass') },
    locate: () => { throw new Error('not implemented: locate') },
    copyShape: () => { throw new Error('not implemented: copyShape') },
    downcast: () => { throw new Error('not implemented: downcast') },
    dispose: () => { throw new Error('not implemented: dispose') },
    composeTransform: () => { throw new Error('not implemented: composeTransform') },
    buildExtrusionLaw: () => { throw new Error('not implemented: buildExtrusionLaw') },
    buildEdgeOnSurface: () => { throw new Error('not implemented: buildEdgeOnSurface') },
    healFace: () => { throw new Error('not implemented: healFace') },
    healWire: () => { throw new Error('not implemented: healWire') },
    fixSelfIntersection: () => { throw new Error('not implemented: fixSelfIntersection') },
    hullFromPoints: () => { throw new Error('not implemented: hullFromPoints') },
    loftAdvanced: () => { throw new Error('not implemented: loftAdvanced') },
    makeEllipsoid: () => { throw new Error('not implemented: makeEllipsoid') },
    makeFaceOnSurface: () => { throw new Error('not implemented: makeFaceOnSurface') },
    makeTorus: () => { throw new Error('not implemented: makeTorus') },
    makeVertex: () => { throw new Error('not implemented: makeVertex') },
    makeWireFromMixed: () => { throw new Error('not implemented: makeWireFromMixed') },
    mirror: () => { throw new Error('not implemented: mirror') },
    revolveVec: () => { throw new Error('not implemented: revolveVec') },
    sew: () => { throw new Error('not implemented: sew') },
    shell: () => { throw new Error('not implemented: shell') },
    simplePipe: () => { throw new Error('not implemented: simplePipe') },
    simplify: () => { throw new Error('not implemented: simplify') },
    split: () => { throw new Error('not implemented: split') },
    sweepPipeShell: () => { throw new Error('not implemented: sweepPipeShell') },
    generalTransformNonOrthogonal: () => { throw new Error('not implemented: generalTransformNonOrthogonal') },
    generalTransformWithHistory: () => { throw new Error('not implemented: generalTransformWithHistory') },
    applyComposedTransformWithHistory: () => { throw new Error('not implemented: applyComposedTransformWithHistory') },
} as BrepEngineApi
}

/** 标准 10×10×10 box 的六面（顺序按 TopExp::MapShapes：+X,-X,+Y,-Y,+Z,-Z 枚举）。 */
function boxFaces(): FakeFace[] {
  return [
    { surfaceType: 'plane', normal: [1, 0, 0], center: [5, 5, 5] },
    { surfaceType: 'plane', normal: [-1, 0, 0], center: [0, 5, 5] },
    { surfaceType: 'plane', normal: [0, 1, 0], center: [5, 5, 5] },
    { surfaceType: 'plane', normal: [0, -1, 0], center: [5, 0, 5] },
    { surfaceType: 'plane', normal: [0, 0, 1], center: [5, 5, 10] },
    { surfaceType: 'plane', normal: [0, 0, -1], center: [5, 5, 0] },
  ]
}

// ── boxRoleFromNormal ──

describe('boxRoleFromNormal', () => {
  it('names the six cardinal directions（Phase 1.12：返回 RoleName 结构值，线格式无前缀）', () => {
    // GOTCHA：boxRoleFromNormal 曾返回 'box:top' 这类扁平串；1.12 后返回 RoleName
    // 结构值（{ kind:'semantic', name:'top' }），线格式串经 formatRoleName 取得。
    expect(formatRoleName(boxRoleFromNormal([1, 0, 0])!)).toBe('right')
    expect(formatRoleName(boxRoleFromNormal([-1, 0, 0])!)).toBe('left')
    expect(formatRoleName(boxRoleFromNormal([0, 1, 0])!)).toBe('back')
    expect(formatRoleName(boxRoleFromNormal([0, -1, 0])!)).toBe('front')
    expect(formatRoleName(boxRoleFromNormal([0, 0, 1])!)).toBe('top')
    expect(formatRoleName(boxRoleFromNormal([0, 0, -1])!)).toBe('bottom')
  })

  it('returns undefined for non-cardinal normals', () => {
    expect(boxRoleFromNormal([0.5, 0.5, 0.707])).toBeUndefined()
    // 阈值判定（abs(component)>0.9 即命中，不做主成分校验——与 brepjs 一致）
    expect(formatRoleName(boxRoleFromNormal([1, 1, 1])!)).toBe('top')
    expect(boxRoleFromNormal([0, 0, 0])).toBeUndefined()
  })
})

// ── assignRoles ──

describe('assignRoles', () => {
  it('assigns semantic box roles by outward normal（Phase 1.7：无前缀）', () => {
    const kernel = fakeKernel(boxFaces())
    const roles = assignRoles(kernel, 1 as BrepHandle, 'box')
    expect(roles.get('top')).toEqual([5])
    expect(roles.get('bottom')).toEqual([6])
    expect(roles.get('front')).toEqual([4])
    expect(roles.get('back')).toEqual([3])
    expect(roles.get('right')).toEqual([1])
    expect(roles.get('left')).toEqual([2])
    expect(roles.size).toBe(6)
  })

  it('emits nothing for unknown op types — no positional fallback（Phase 1.7，GOTCHA）', () => {
    // GOTCHA：assignRoles 曾对无语义命名的面兜底 `${opType}:face_${i}`——
    // index 是 OCCT 枚举序号，改参即漂（违反 R3）。Phase 1.7 删除：
    // opType 无命名器（如位置传入的 'part0'）⇒ 全部面不进表（显式无身份），
    // 而不是伪造位置名。
    const kernel = fakeKernel(boxFaces())
    const roles = assignRoles(kernel, 1 as BrepHandle, 'part0')
    expect(roles.size).toBe(0)
  })

  it('gives cylinder lateral + caps（Phase 1.7：无前缀）', () => {
    const kernel = fakeKernel([
      { surfaceType: 'cylinder', normal: [0, 0, 0], center: [0, 0, 5] },
      { surfaceType: 'plane', normal: [0, 0, 1], center: [0, 0, 10] },
      { surfaceType: 'plane', normal: [0, 0, -1], center: [0, 0, 0] },
    ])
    const roles = assignRoles(kernel, 1 as BrepHandle, 'cylinder')
    expect(roles.get('lateral')).toEqual([1])
    expect(roles.get('top')).toEqual([2])
    expect(roles.get('bottom')).toEqual([3])
  })
})

// ── nextHashes ──

describe('nextHashes', () => {
  const evo: HashEvolution = {
    modified: new Map([[2, [20, 21]]]), // 1→2 分裂
    deleted: new Set([3]),
  }

  it('drops deleted, replaces modified with all successors, keeps unchanged', () => {
    expect(nextHashes([1, 2, 3], evo)).toEqual([1, 20, 21])
  })

  it('dedupes a shared successor', () => {
    expect(nextHashes([2, 20], evo)).toEqual([20, 21])
  })
})

// ── propagateRoles ──

describe('propagateRoles', () => {
  // Phase 1.6：RoleTable 外层键 = StmtId 串形（branded 类型不改变运行期形态，测试用串字面量 + 显式泛型）
  const table = new Map([
    ['s0', new Map([
      ['top', [5]],
      ['front', [4]],
      ['bottom', [6]],
    ])],
    ['s1', new Map([['top', [7]]])],
  ])

  it('advances only the target origin', () => {
    const evo: HashEvolution = { modified: new Map([[4, [40]]]), deleted: new Set([6]) }
    const next = propagateRoles(table as unknown as RoleTable, 's0' as never, evo)
    expect(next.get('s0' as never)?.get('top')).toEqual([5])
    expect(next.get('s0' as never)?.get('front')).toEqual([40])
    expect(next.get('s0' as never)?.get('bottom')).toBeUndefined() // deleted
    // 另一 origin 原样保留
    expect(next.get('s1' as never)?.get('top')).toEqual([7])
    // 原表不变（immutable）
    expect((table as Map<string, Map<string, number[]>>).get('s0')?.get('front')).toEqual([4])
  })

  it('returns the same table when origin is absent', () => {
    const evo: HashEvolution = { modified: new Map(), deleted: new Set() }
    expect(propagateRoles(table as unknown as RoleTable, 'sX' as never, evo)).toBe(table)
  })
})

// ── mergeRoleTables（布尔合流，§3.4）──

describe('mergeRoleTables', () => {
  it('merges target and tool tables after separate propagation（origin=StmtId 串形）', () => {
    const target = new Map([
      ['s0', new Map([['top', [1]], ['front', [2]]])],
    ])
    const tool = new Map([
      ['s1', new Map([['top', [3]]])],
    ])
    const merged = mergeRoleTables(
      target as unknown as RoleTable,
      { modified: new Map([[2, [20]]]), deleted: new Set() },
      tool as unknown as RoleTable,
      { modified: new Map(), deleted: new Set() },
      's2' as never,
      1,
    )
    expect(merged.get('s0' as never)?.get('top')).toEqual([1])
    expect(merged.get('s0' as never)?.get('front')).toEqual([20])
    expect(merged.get('s1' as never)?.get('top')).toEqual([3])
    // 缝面 origin=本次语句 StmtId；Phase 1.7：不给位置名，登记空子表占位
    expect(merged.get('s2' as never)).toBeDefined()
    expect(merged.get('s2' as never)?.size).toBe(0)
    expect(merged.size).toBe(3)
  })

  it('handles a tool side that drops a face', () => {
    const target = new Map([
      ['s0', new Map([['top', [1]]])],
    ])
    const tool = new Map([
      ['s1', new Map([['top', [3]]])],
    ])
    const merged = mergeRoleTables(
      target as unknown as RoleTable,
      { modified: new Map(), deleted: new Set([1]) },
      tool as unknown as RoleTable,
      { modified: new Map(), deleted: new Set([3]) },
      's2' as never,
      0,
    )
    expect(merged.get('s0' as never)?.get('top')).toBeUndefined()
    expect(merged.get('s1' as never)?.get('top')).toBeUndefined()
    expect(merged.get('s2' as never)).toBeUndefined()
  })
})

// ── roleOfOrdinal ──

describe('roleOfOrdinal', () => {
  it('reverse-looks-up the role of an ordinal via the ordinal→hash table', () => {
    const roles = new Map<string, number[]>([
      ['box:top', [5]],
      ['box:front', [2]],
    ])
    // ordinalToHash：下标 i ↔ 序号 i+1 的 hash（subShapeHashes 约定）
    const ordinalToHash = [11, 2, 33, 44, 5]
    expect(roleOfOrdinal(roles, ordinalToHash, 5)).toBe('box:top')
    expect(roleOfOrdinal(roles, ordinalToHash, 2)).toBe('box:front')
    expect(roleOfOrdinal(roles, ordinalToHash, 1)).toBeUndefined() // 不在表中
    expect(roleOfOrdinal(roles, ordinalToHash, 9)).toBeUndefined() // 越界
  })
})
