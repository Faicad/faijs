/**
 * @vitest-environment node
 *
 * engine-switch-p3 — Phase 3 验收（方案 §Phase 3：能力收口）
 *
 * 1. 编译期守卫：L1 能力方法 ⊆ BrepEngineApi 接口键
 *    （能力表声明了 → 接口必须登记；缺失 → tsc 报错列出方法名）；
 * 2. occt 适配器：L1 登记方法实例完整 + 平台方法在原生内核上完整；
 * 3. brepkit 适配器：capabilities.methods 声明 ⊆ 实例实现面（不声明能力表外方法）。
 *
 * Run: npx vitest run src/brep/engine/engine-switch-p3.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  __resetEngineRegistriesForTests,
  getBrepEngine,
} from './registry'
import { registerOcctBrepEngine } from './adapters/occt'
import { registerBrepkitBrepEngine } from './adapters/brepkit'
import type { BrepEngineApi } from './primitives'
import type { BrepHandle, BrepMethodKind } from './types'
import * as capabilityMap from '../../api/surface/capability-map.json'

/**
 * 编译期守卫用的 L1 方法全量（== BrepEngineApi 接口键，Phase 4 收窄后 99 个）。
 * 能力表声明了 → 接口必须登记；与 `keyof BrepEngineApi` 保持同步（缺失 → tsc 报错）。
 */
const CAPABILITY_METHODS = [
  'release',
  'dispose',
  'makeBox',
  'makeBoxFromCorners',
  'makeCylinder',
  'makeSphere',
  'makeCone',
  'makeRectangle',
  'makeEllipsoid',
  'makeTorus',
  'makeVertex',
  'extrude',
  'revolveVec',
  'sew',
  'sewAndSolidify',
  'shell',
  'hullFromPoints',
  'fuse',
  'cut',
  'common',
  'intersect',
  'fuseAll',
  'sectionByPlane',
  'splitByPlane',
  'chamfer',
  'chamferDistAngle',
  'fillet',
  'filletVariable',
  'filletWithHistory',
  'translate',
  'scale',
  'transform',
  'located',
  'locate',
  'generalTransform',
  'copy',
  'copyShape',
  'composeTransform',
  'mirror',
  'linearPattern',
  'circularPattern',
  'gridPattern',
  'makeLineEdge',
  'makeArcEdge',
  'makeBezierEdge',
  'makeCircleEdge',
  'makeWire',
  'makeFace',
  'makeCompound',
  'addHolesInFace',
  'buildTriFace',
  'meshShape',
  'wireframe',
  'getSubShapes',
  'subShapeHashes',
  'hashCode',
  'isSame',
  'isSolid',
  'shapeOrientation',
  'edgeToFaceMap',
  'adjacentFaces',
  'sharedEdges',
  'curveType',
  'curvePointAtParam',
  'curveTangent',
  'curveParameters',
  'curveIsClosed',
  'curveLength',
  'surfaceType',
  'surfaceNormal',
  'pointOnSurface',
  'uvBounds',
  'surfaceCenterOfMass',
  'getFaceCylinderData',
  'getNurbsCurveData',
  'interpolatePoints',
  'defeature',
  'draft',
  'removeHolesFromFace',
  'reverseShape',
  'projectEdges',
  'getBoundingBox',
  'getVolume',
  'getCenterOfMass',
  'getSurfaceArea',
  'getLength',
  'isValid',
  'unifySameDomain',
  'healSolid',
  'fixShape',
  'fixFaceOrientations',
  'removeDegenerateEdges',
  'importStep',
  'exportStep',
  'importStl',
  'fromBREP',
  'cutWithHistory',
  'fuseWithHistory',
  'intersectWithHistory',
] as const

type CapabilityMethod = (typeof CAPABILITY_METHODS)[number]
type ApiKeys = keyof BrepEngineApi

/** 编译期守卫：L1 能力方法（在 BrepEngineApi 里的）必须全部覆盖。 */
type _Assert<T extends never> = T
type _MissingCapability = Exclude<CapabilityMethod, ApiKeys>
const _coverageGuard: _Assert<_MissingCapability> = undefined as never

/** L1 方法（在 BrepEngineApi 里）——在 primitives 上检查。 */
const L1_METHODS = [
  'surfaceCenterOfMass',
  'locate',
  'copyShape',
  'dispose',
  'composeTransform',
  'hullFromPoints',
  'makeEllipsoid',
  'makeTorus',
  'makeVertex',
  'mirror',
  'revolveVec',
  'sew',
  'shell',
] as const satisfies readonly (keyof BrepEngineApi)[]

/** 平台方法（occt-only 原生内核方法）——在原生内核上检查。 */
const PLATFORM_METHODS = [
  'isNull',
  'iterShapes',
  'downcast',
  'buildExtrusionLaw',
  'healFace',
  'healWire',
  'makeFaceOnSurface',
  'simplePipe',
  'simplify',
  'split',
  'sweepPipeShell',
] as const

let occtApi: BrepEngineApi
let nativeKernel: Record<string, unknown>

beforeAll(async () => {
  await registerOcctBrepEngine()
  occtApi = (await getBrepEngine()).primitives
  const { getOcctKernel } = await import('../../occt-kernel/occtKernel')
  nativeKernel = getOcctKernel() as unknown as Record<string, unknown>
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

describe('Phase 3 接口覆盖：capability-map 43 方法 → BrepEngineApi', () => {
  it('capability-map 唯一内核方法数 = 43（底表快照，与静态清单一致）', () => {
    const fromMap = [...new Set(capabilityMap.entries.flatMap((e) => e.kernelMethods as string[]))]
    expect(fromMap.length).toBe(43)
  })

  it('编译期守卫生效：_coverageGuard 类型为 never（见文件顶 type _Assert）', () => {
    expect(typeof _coverageGuard).toBe('undefined')
  })

  it('L1 方法清单 ⊆ capability-map 方法集', () => {
    const set = new Set(CAPABILITY_METHODS)
    for (const m of L1_METHODS) {
      expect(set.has(m as CapabilityMethod), `清单外方法: ${m}`).toBe(true)
    }
  })
})

describe('Phase 3 occt 适配器：L1 + 平台方法实例完整 + 组合代理冒烟', () => {
  it('注册后 L1 方法在 primitives 上全部存在（typeof function）', () => {
    for (const m of L1_METHODS) {
      expect(typeof occtApi[m], `occt primitives 缺 L1 方法: ${m}`).toBe('function')
    }
  })

  it('注册后平台方法在原生内核上全部存在（typeof function）', () => {
    for (const m of PLATFORM_METHODS) {
      expect(typeof nativeKernel[m], `occt native 缺平台方法: ${m}`).toBe('function')
    }
  })

  it('组合代理冒烟：getBoundingBox / surfaceCenterOfMass 真返回', () => {
    const box = occtApi.makeBox(10, 10, 10)
    let face: BrepHandle | undefined
    try {
      const bb = occtApi.getBoundingBox(box)
      expect(bb.xmax - bb.xmin).toBeCloseTo(10)
      expect(bb.ymax - bb.ymin).toBeCloseTo(10)
      expect(bb.zmax - bb.zmin).toBeCloseTo(10)
      const faces = occtApi.getSubShapes(box, 'face')
      face = faces[0]
      const com = occtApi.surfaceCenterOfMass(face)
      expect(typeof com.x).toBe('number')
      expect(com.x >= -5.01 && com.x <= 5.01).toBe(true)
      expect(com.y >= -5.01 && com.y <= 5.01).toBe(true)
      expect(com.z >= -5.01 && com.z <= 5.01).toBe(true)
      expect([com.x, com.y, com.z].some((v) => Math.abs(Math.abs(v) - 5) < 0.01)).toBe(true)
    } finally {
      occtApi.release(box)
      if (face !== undefined) occtApi.release(face)
    }
  })

  it('原生代理冒烟：makeVertex / makeEllipsoid 真返回', () => {
    const box = occtApi.makeBox(10, 10, 10)
    let v: BrepHandle | undefined
    let e: BrepHandle | undefined
    try {
      v = occtApi.makeVertex(1, 2, 3)
      e = occtApi.makeEllipsoid(2, 3, 4)
      expect(typeof v).toBe('number')
      expect(typeof e).toBe('number')
    } finally {
      occtApi.release(box)
      if (v !== undefined) occtApi.release(v)
      if (e !== undefined) occtApi.release(e)
    }
  })
})

describe('Phase 3 brepkit 适配器：声明 ⊆ 实例（能力表外方法不声明）', () => {
  it('brepkit 真实现接线冒烟：5 个新声明方法真可用（不崩、返回有效句柄）', async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    const engine = await getBrepEngine()
    try {
      const api = engine.primitives
      const box = api.makeBox(10, 10, 10)
      const ell = api.makeEllipsoid(2, 3, 4)
      const v = api.makeVertex(1, 2, 3)
      const torus = api.makeTorus(5, 2)
      const mirrored = api.mirror(box, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
      expect(typeof ell).toBe('number')
      expect(typeof v).toBe('number')
      expect(typeof torus).toBe('number')
      expect(typeof mirrored).toBe('number')
      const faces = api.getSubShapes(box, 'face')
      expect(faces.length).toBeGreaterThan(0)
      const hollow = api.shell(box, [faces[0]], 1, 0.01)
      expect(typeof hollow).toBe('number')
      expect(api.getVolume(hollow as never)).toBeGreaterThan(0)
    } finally {
      __resetEngineRegistriesForTests()
      await registerOcctBrepEngine()
      occtApi = (await getBrepEngine()).primitives
    }
  })

  it('capabilities.methods 每个声明方法在实例上存在（typeof function）', async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    const engine = await getBrepEngine()
    try {
      for (const m of engine.capabilities!.methods!) {
        expect(
          typeof engine.primitives[m as keyof BrepEngineApi],
          `brepkit 声明了实例缺失方法: ${m}`,
        ).toBe('function')
      }
    } finally {
      __resetEngineRegistriesForTests()
      await registerOcctBrepEngine()
      occtApi = (await getBrepEngine()).primitives
    }
  })

  it('brepkit 侧平台方法保持未声明（unsupported 桩不伪造能力）', async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    const engine = await getBrepEngine()
    try {
      const declared = new Set(engine.capabilities!.methods)
      const brepkitReal = new Set([
        'surfaceCenterOfMass',
        'makeEllipsoid', 'makeTorus', 'makeVertex', 'mirror', 'shell',
        // 2026-09-26 A 批：brepkitKernel 真实实现 dispose（GC 型 no-op）与
        // copyShape（调 kernel.copySolid）——补入白名单使能力声明合法。
        'dispose', 'copyShape',
        // 2026-09-26 B 批：brepkitKernel.hullFromPoints 真实现（→ kernel.convexHull，
        // brepkitKernel.ts:477）——convexHull op 降级后如实声明此方法。
        'hullFromPoints',
      ])
      for (const m of L1_METHODS) {
        if (brepkitReal.has(m as string)) continue
        expect(declared.has(m as BrepMethodKind), `brepkit 不应声明桩方法: ${m}`).toBe(false)
      }
    } finally {
      __resetEngineRegistriesForTests()
      await registerOcctBrepEngine()
      occtApi = (await getBrepEngine()).primitives
    }
  })
})
