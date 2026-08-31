/**
 * naming/roles.test.ts — M0 纯函数测试（roles 传播/合并/位置名/反查 + assignRoles）
 *
 * 不 init wasm：assignRoles 用可枚举的 fake kernel（句柄 → 预置面描述），
 * 其余是纯 Map 逻辑。
 */

import { describe, it, expect } from 'vitest'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { BrepHandle, BrepSubShapeType } from '../../brep/engine/types'
import { asPartName } from '../../identity'
import {
  assignRoles,
  boxRoleFromNormal,
  nextHashes,
  propagateRoles,
  mergeRoleTables,
  assignGeneratedPositionalRoles,
  roleOfOrdinal,
} from './roles'
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
  it('names the six cardinal directions', () => {
    expect(boxRoleFromNormal([1, 0, 0])).toBe('box:right')
    expect(boxRoleFromNormal([-1, 0, 0])).toBe('box:left')
    expect(boxRoleFromNormal([0, 1, 0])).toBe('box:back')
    expect(boxRoleFromNormal([0, -1, 0])).toBe('box:front')
    expect(boxRoleFromNormal([0, 0, 1])).toBe('box:top')
    expect(boxRoleFromNormal([0, 0, -1])).toBe('box:bottom')
  })

  it('returns undefined for non-cardinal normals', () => {
    expect(boxRoleFromNormal([0.5, 0.5, 0.707])).toBeUndefined()
    // 阈值判定（abs(component)>0.9 即命中，不做主成分校验——与 brepjs 一致）
    expect(boxRoleFromNormal([1, 1, 1])).toBe('box:top')
    expect(boxRoleFromNormal([0, 0, 0])).toBeUndefined()
  })
})

// ── assignRoles ──

describe('assignRoles', () => {
  it('assigns semantic box roles by outward normal', () => {
    const kernel = fakeKernel(boxFaces())
    const roles = assignRoles(kernel, 1 as BrepHandle, 'box')
    expect(roles.get('box:top')).toEqual([5])
    expect(roles.get('box:bottom')).toEqual([6])
    expect(roles.get('box:front')).toEqual([4])
    expect(roles.get('box:back')).toEqual([3])
    expect(roles.get('box:right')).toEqual([1])
    expect(roles.get('box:left')).toEqual([2])
    expect(roles.size).toBe(6)
  })

  it('falls back to positional roles for unknown op types', () => {
    const kernel = fakeKernel(boxFaces())
    const roles = assignRoles(kernel, 1 as BrepHandle, 'part0')
    expect(roles.get('part0:face_0')).toEqual([1])
    expect(roles.get('part0:face_5')).toEqual([6])
    expect(roles.size).toBe(6)
  })

  it('gives cylinder lateral + caps', () => {
    const kernel = fakeKernel([
      { surfaceType: 'cylinder', normal: [0, 0, 0], center: [0, 0, 5] },
      { surfaceType: 'plane', normal: [0, 0, 1], center: [0, 0, 10] },
      { surfaceType: 'plane', normal: [0, 0, -1], center: [0, 0, 0] },
    ])
    const roles = assignRoles(kernel, 1 as BrepHandle, 'cylinder')
    expect(roles.get('cylinder:lateral')).toEqual([1])
    expect(roles.get('cylinder:top')).toEqual([2])
    expect(roles.get('cylinder:bottom')).toEqual([3])
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
  const table: RoleTable = new Map([
    [asPartName('part0'), new Map([
      ['box:top', [5]],
      ['box:front', [4]],
      ['box:bottom', [6]],
    ])],
    [asPartName('part1'), new Map([['box:top', [7]]])],
  ])

  it('advances only the target origin', () => {
    const evo: HashEvolution = { modified: new Map([[4, [40]]]), deleted: new Set([6]) }
    const next = propagateRoles(table, asPartName('part0'), evo)
    expect(next.get(asPartName('part0'))?.get('box:top')).toEqual([5])
    expect(next.get(asPartName('part0'))?.get('box:front')).toEqual([40])
    expect(next.get(asPartName('part0'))?.get('box:bottom')).toBeUndefined() // deleted
    // 另一 origin 原样保留
    expect(next.get(asPartName('part1'))?.get('box:top')).toEqual([7])
    // 原表不变（immutable）
    expect(table.get(asPartName('part0'))?.get('box:front')).toEqual([4])
  })

  it('returns the same table when origin is absent', () => {
    const evo: HashEvolution = { modified: new Map(), deleted: new Set() }
    expect(propagateRoles(table, asPartName('nope'), evo)).toBe(table)
  })
})

// ── mergeRoleTables（布尔合流，§3.4）──

describe('mergeRoleTables', () => {
  it('merges target and tool tables after separate propagation', () => {
    const target: RoleTable = new Map([
      [asPartName('part0'), new Map([['box:top', [1]], ['box:front', [2]]])],
    ])
    const tool: RoleTable = new Map([
      [asPartName('part1'), new Map([['box:top', [3]]])],
    ])
    const merged = mergeRoleTables(
      target,
      { modified: new Map([[2, [20]]]), deleted: new Set() },
      tool,
      { modified: new Map(), deleted: new Set() },
      asPartName('part2'),
      1,
    )
    expect(merged.get(asPartName('part0'))?.get('box:top')).toEqual([1])
    expect(merged.get(asPartName('part0'))?.get('box:front')).toEqual([20])
    expect(merged.get(asPartName('part1'))?.get('box:top')).toEqual([3])
    // 缝面以 outPart 为新 origin
    expect(merged.get(asPartName('part2'))?.get('part2:face_0')).toEqual([])
    expect(merged.size).toBe(3)
  })

  it('handles a tool side that drops a face', () => {
    const target: RoleTable = new Map([
      [asPartName('part0'), new Map([['box:top', [1]]])],
    ])
    const tool: RoleTable = new Map([
      [asPartName('part1'), new Map([['box:top', [3]]])],
    ])
    const merged = mergeRoleTables(
      target,
      { modified: new Map(), deleted: new Set([1]) },
      tool,
      { modified: new Map(), deleted: new Set([3]) },
      asPartName('part2'),
      0,
    )
    expect(merged.get(asPartName('part0'))?.get('box:top')).toBeUndefined()
    expect(merged.get(asPartName('part1'))?.get('box:top')).toBeUndefined()
    expect(merged.get(asPartName('part2'))).toBeUndefined()
  })
})

// ── assignGeneratedPositionalRoles ──

describe('assignGeneratedPositionalRoles', () => {
  it('names seam faces positionally under the out-part origin', () => {
    const roles = assignGeneratedPositionalRoles('part2', 2)
    expect(roles.get('part2:face_0')).toEqual([])
    expect(roles.get('part2:face_1')).toEqual([])
    expect(roles.size).toBe(2)
  })
})

// ── roleOfOrdinal ──

describe('roleOfOrdinal', () => {
  it('is a placeholder contract: ordinal→role 由调用方提供序号↔hash 对照', () => {
    const roles = new Map([['box:top', [5]]])
    expect(roleOfOrdinal(roles, 1)).toBeUndefined()
  })
})
