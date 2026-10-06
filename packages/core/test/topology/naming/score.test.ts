/**
 * naming/score.test.ts + geom-hint.test.ts — M0 打分器与 hint 捕获测试
 *
 * 打分器纯逻辑（row 快照路径零 kernel），BREP 现场路径用 fake kernel 验证
 * 同一套权重口径。
 */

import { describe, it, expect } from 'vitest'
import type { BrepEngineApi } from '../../../src/brep/engine/primitives'
import type { BrepHandle } from '../../../src/brep/engine/types'
import { scoreCandidate, scoreFaceRow, defaultFaceScorer, MIN_SCORE } from '../../../src/topology/naming/score'
import type { FaceHint } from '../../../src/topology/naming/types'
import { faceRowToHint, edgeRowToHint } from '../../../src/topology/naming/geom-hint'

// ── scoreFaceRow（面行快照路径）──

describe('scoreFaceRow', () => {
  const hint: FaceHint = {
    kind: 'face',
    surfaceType: 'plane',
    normal: [0, 0, 1],
    center: [5, 5, 10],
    area: 100,
  }

  it('scores a matching row above MIN_SCORE', () => {
    const s = scoreFaceRow(hint, {
      surfaceType: 'plane',
      normal: [0, 0, 1],
      center: [5, 5, 10],
      area: 100,
    })
    expect(s).toBeGreaterThan(MIN_SCORE)
  })

  it('rejects a surface type mismatch with -Infinity', () => {
    const s = scoreFaceRow(hint, {
      surfaceType: 'cylinder',
      normal: [0, 0, 1],
      center: [5, 5, 10],
      area: 100,
    })
    expect(s).toBe(-Infinity)
  })

  it('rejects a misaligned normal (dot < 0.707)', () => {
    const s = scoreFaceRow(hint, {
      surfaceType: 'plane',
      normal: [0, 1, 0],
      center: [5, 5, 10],
      area: 100,
    })
    expect(s).toBe(-Infinity)
  })

  it('rejects a far-away center (distSq > 100)', () => {
    const s = scoreFaceRow(hint, {
      surfaceType: 'plane',
      normal: [0, 0, 1],
      center: [50, 50, 50],
      area: 100,
    })
    expect(s).toBe(-Infinity)
  })

  it('penalizes a wildly different area', () => {
    const s = scoreFaceRow(hint, {
      surfaceType: 'plane',
      normal: [0, 0, 1],
      center: [5, 5, 10],
      area: 1, // |log(100/1)| = 4.6 > 1
    })
    expect(s).toBeLessThan(1.0)
  })
})

// ── defaultFaceScorer（BREP 现场路径，fake kernel）──

function planeKernel(): BrepEngineApi {
  return {
    getSubShapes: () => [],
    subShapeHashes: () => [],
    surfaceType: () => 'plane',
    surfaceNormal: () => ({ x: 0, y: 0, z: 1 }),
    uvBounds: () => ({ uMin: 0, uMax: 1, vMin: 0, vMax: 1 }),
    surfaceCenterOfMass: () => ({ x: 5, y: 5, z: 10 }),
    release: () => undefined,
    hashCode: (h) => h as unknown as number,
    isSame: (a, b) => a === b,
    isSolid: () => true,
    shapeType: () => 'SOLID',
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
    meshShape: () => ({ positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0), vertexCount: 0, triangleCount: 0 }),
    wireframe: () => ({ points: new Float32Array(0), edgeGroups: new Int32Array(0), pointCount: 0, edgeCount: 0 }),
    makeBox: () => 1 as BrepHandle,
    makeBoxFromCorners: () => 1 as BrepHandle,
    makeCylinder: () => 1 as BrepHandle,
    makeSphere: () => 1 as BrepHandle,
    makeCone: () => 1 as BrepHandle,
    makeRectangle: () => 1 as BrepHandle,
    makeEllipsoid: () => 1 as BrepHandle,
    makeTorus: () => 1 as BrepHandle,
    makeVertex: () => 1 as BrepHandle,
    makeCircleEdge: () => 1 as BrepHandle,
    extrude: () => 1 as BrepHandle,
    revolveVec: () => 1 as BrepHandle,
    sew: () => 1 as BrepHandle,
    sewAndSolidify: () => 1 as BrepHandle,
    shell: () => 1 as BrepHandle,
    hullFromPoints: () => 1 as BrepHandle,
    fuse: (a) => a,
    cut: (a) => a,
    common: (a) => a,
    intersect: (a) => a,
    fuseAll: (ss) => ss[0] ?? (1 as BrepHandle),
    sectionByPlane: () => [],
    splitByPlane: () => ({ positive: 1 as BrepHandle, negative: 2 as BrepHandle }),
    translate: (s) => s,
    scale: (s) => s,
    transform: (s) => s,
    located: (s) => s,
    locate: (s) => s,
    generalTransform: (s) => s,
    copy: (s) => s,
    copyShape: (s) => s,
    composeTransform: () => [],
    mirror: (s) => s,
    linearPattern: () => [],
    circularPattern: () => [],
    gridPattern: () => 1 as BrepHandle,
    makeLineEdge: () => 1 as BrepHandle,
    makeArcEdge: () => 1 as BrepHandle,
    makeBezierEdge: () => 1 as BrepHandle,
    makeBSplineEdge: () => 1 as BrepHandle,
    curveSplit: () => [1 as BrepHandle, 2 as BrepHandle],
    makeWire: () => 1 as BrepHandle,
    makeFace: () => 1 as BrepHandle,
    makeCompound: () => 1 as BrepHandle,
    addHolesInFace: () => 1 as BrepHandle,
    buildTriFace: () => 1 as BrepHandle,
    importStep: () => 1 as BrepHandle,
    exportStep: () => '',
    importStl: () => 1 as BrepHandle,
    fromBREP: () => 1 as BrepHandle,
    cutWithHistory: () => ({ result: 1 as BrepHandle, modified: [], generated: [], deleted: [] }),
    fuseWithHistory: () => ({ result: 1 as BrepHandle, modified: [], generated: [], deleted: [] }),
    intersectWithHistory: () => ({ result: 1 as BrepHandle, modified: [], generated: [], deleted: [] }),
    filletWithHistory: () => ({ result: 1 as BrepHandle, modified: [], generated: [], deleted: [] }),
    chamfer: () => 1 as BrepHandle,
    chamferDistAngle: () => 1 as BrepHandle,
    fillet: () => 1 as BrepHandle,
    filletVariable: () => 1 as BrepHandle,
    dispose: () => undefined,
    interpolatePoints: () => 1 as BrepHandle,
    defeature: (s) => s,
    draft: (s) => s,
    removeHolesFromFace: (s) => s,
    reverseShape: (s) => s,
    projectEdges: () => undefined,
    getSurfaceArea: () => 1,
    getLength: () => 1,
    edgeToFaceMap: () => ({}),
    adjacentFaces: () => [],
    sharedEdges: () => [],
  } as BrepEngineApi
}

describe('defaultFaceScorer (BREP live)', () => {
  it('scores a live handle with the same weights as the row path', () => {
    const kernel = planeKernel()
    const scorer = defaultFaceScorer(kernel)
    const hint: FaceHint = { kind: 'face', surfaceType: 'plane', normal: [0, 0, 1], center: [5, 5, 10] }
    const s = scorer(hint, { handle: 1 as BrepHandle })
    // 与 scoreFaceRow 同口径：surfaceType +1、法向 +1、质心距² 0
    const rowScore = scoreFaceRow(hint, { surfaceType: 'plane', normal: [0, 0, 1], center: [5, 5, 10] })
    expect(s).toBe(rowScore)
    expect(s).toBeGreaterThan(MIN_SCORE)
  })

  it('rejects a live handle whose surface type mismatches', () => {
    const kernel = { ...planeKernel(), surfaceType: () => 'cylinder' } as BrepEngineApi
    const scorer = defaultFaceScorer(kernel)
    const hint: FaceHint = { kind: 'face', surfaceType: 'plane', normal: [0, 0, 1], center: [5, 5, 10] }
    expect(scorer(hint, { handle: 1 as BrepHandle })).toBe(-Infinity)
  })
})

// ── scoreCandidate 通用入口 ──

describe('scoreCandidate', () => {
  it('prefers the handle path when both handle and row are present', () => {
    const kernel = planeKernel()
    const hint: FaceHint = { kind: 'face', surfaceType: 'plane', normal: [0, 0, 1], center: [5, 5, 10] }
    // handle 匹配、row 故意不匹配 —— handle 优先，分高
    const s = scoreCandidate(kernel, hint, { handle: 1 as BrepHandle, row: { surfaceType: 'cylinder' } })
    expect(s).toBeGreaterThan(MIN_SCORE)
  })
})

// ── faceRowToHint / edgeRowToHint ──

describe('faceRowToHint', () => {
  it('extracts surfaceType/normal/center/area from a face row', () => {
    const hint = faceRowToHint({
      surfaceType: 'plane',
      normal: [0, 0, 1],
      center: [1, 2, 3],
      area: 42.5,
    })
    expect(hint).toEqual({ kind: 'face', surfaceType: 'plane', normal: [0, 0, 1], center: [1, 2, 3], area: 42.5 })
  })

  it('omits missing fields', () => {
    const hint = faceRowToHint({ surfaceType: 'plane' })
    expect(hint).toEqual({ kind: 'face', surfaceType: 'plane' })
    expect(hint.normal).toBeUndefined()
    expect(hint.center).toBeUndefined()
    expect(hint.area).toBeUndefined()
  })

  it('ignores null normal/center (mesh rows may carry nulls)', () => {
    const hint = faceRowToHint({ surfaceType: 'plane', normal: null, center: null })
    expect(hint.normal).toBeUndefined()
    expect(hint.center).toBeUndefined()
  })
})

describe('edgeRowToHint', () => {
  it('extracts length and midpoint from an edge row', () => {
    const hint = edgeRowToHint({ length: 20, center: [0, -10, 10] })
    expect(hint).toEqual({ kind: 'edge', length: 20, midpoint: [0, -10, 10] })
  })

  it('omits missing fields', () => {
    expect(edgeRowToHint({})).toEqual({ kind: 'edge' })
  })
})
