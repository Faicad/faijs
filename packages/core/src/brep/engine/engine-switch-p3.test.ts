/**
 * @vitest-environment node
 *
 * engine-switch-p3 — Phase 3 验收（方案 §Phase 3：能力收口）
 *
 * 1. 编译期守卫：capability-map 64 个唯一内核方法 ⊆ BrepEngineApi 接口键
 *    （能力表声明了 → 接口必须登记；缺失 → tsc 报错列出方法名）；
 * 2. occt 适配器：33 个 Phase 3 登记方法实例完整（能力表声明 ≠ 实例缺失——
 *    静态判定放行后实例缺方法 = 运行时崩，红线）；组合面代理冒烟；
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

// ── Phase 3 能力收口底表（capability-map 64 个唯一内核方法，静态快照） ──
const CAPABILITY_METHODS = [
  'addHolesInFace',
  'applyComposedTransformWithHistory',
  'boundingBox',
  'buildEdgeOnSurface',
  'buildExtrusionLaw',
  'buildTriFace',
  'circularPattern',
  'composeTransform',
  'copyShape',
  'curveParameters',
  'curvePointAtParam',
  'curveTangent',
  'cut',
  'cutWithHistory',
  'dispose',
  'downcast',
  'extrude',
  'fixSelfIntersection',
  'fixShape',
  'fuse',
  'fuseAll',
  'fuseWithHistory',
  'generalTransformNonOrthogonal',
  'generalTransformWithHistory',
  'gridPattern',
  'hashCode',
  'healFace',
  'healSolid',
  'healWire',
  'hullFromPoints',
  'isNull',
  'isValid',
  'iterShapes',
  'linearPattern',
  'locate',
  'loftAdvanced',
  'makeCylinder',
  'makeEllipsoid',
  'makeFace',
  'makeFaceOnSurface',
  'makeLineEdge',
  'makeTorus',
  'makeVertex',
  'makeWireFromMixed',
  'mirror',
  'mirrorWithHistory',
  'offsetWithHistory',
  'revolveVec',
  'rotateWithHistory',
  'section',
  'sew',
  'sewAndSolidify',
  'shapeType',
  'shell',
  'shellWithHistory',
  'simplePipe',
  'simplify',
  'split',
  'surfaceCenterOfMass',
  'surfaceNormal',
  'surfaceType',
  'sweepPipeShell',
  'translateWithHistory',
  'uvBounds',
] as const

type CapabilityMethod = (typeof CAPABILITY_METHODS)[number]
type ApiKeys = keyof BrepEngineApi

/** 编译期守卫：能力表缺失的接口键必须为 never（能力方法不在 BrepEngineApi → tsc 报错）。 */
type _Assert<T extends never> = T
type _MissingCapability = Exclude<CapabilityMethod, ApiKeys>
const _coverageGuard: _Assert<_MissingCapability> = undefined as never

/** 33 个 Phase 3 新登记方法（BrepEngineApi 接口增量；其余 31 个此前已声明）。 */
const PHASE3_METHODS = [
  'boundingBox',
  'shapeType',
  'isNull',
  'iterShapes',
  'surfaceCenterOfMass',
  'locate',
  'copyShape',
  'downcast',
  'dispose',
  'composeTransform',
  'buildExtrusionLaw',
  'buildEdgeOnSurface',
  'healFace',
  'healWire',
  'fixSelfIntersection',
  'hullFromPoints',
  'loftAdvanced',
  'makeEllipsoid',
  'makeFaceOnSurface',
  'makeTorus',
  'makeVertex',
  'makeWireFromMixed',
  'mirror',
  'revolveVec',
  'sew',
  'shell',
  'simplePipe',
  'simplify',
  'split',
  'sweepPipeShell',
  'generalTransformNonOrthogonal',
  'generalTransformWithHistory',
  'applyComposedTransformWithHistory',
] as const satisfies readonly (keyof BrepEngineApi)[]

let occtApi: BrepEngineApi

beforeAll(async () => {
  await registerOcctBrepEngine()
  occtApi = (await getBrepEngine()).primitives
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

describe('Phase 3 接口覆盖：capability-map 64 方法 → BrepEngineApi', () => {
  it('capability-map 唯一内核方法数 = 64（底表快照，与静态清单一致）', () => {
    const fromMap = [...new Set(capabilityMap.entries.flatMap((e) => e.kernelMethods as string[]))]
    expect(fromMap.length).toBe(64)
  })

  it('编译期守卫生效：_coverageGuard 类型为 never（见文件顶 type _Assert）', () => {
    // 运行时无接口反射；此用例钉住编译期守卫的类型变量被消费（防误删守卫）。
    expect(typeof _coverageGuard).toBe('undefined')
  })

  it('33 个 Phase 3 方法清单 ⊆ capability-map 方法集（清单与底表一致）', () => {
    const set = new Set(CAPABILITY_METHODS)
    for (const m of PHASE3_METHODS) expect(set.has(m as CapabilityMethod), `清单外方法: ${m}`).toBe(true)
  })
})

describe('Phase 3 occt 适配器：33 登记方法实例完整 + 组合代理冒烟', () => {
  it('注册后实例的 33 个方法全部存在（typeof function）', () => {
    for (const m of PHASE3_METHODS) {
      expect(typeof occtApi[m], `occt 实例缺能力方法: ${m}`).toBe('function')
    }
  })

  it('组合代理冒烟：boundingBox / shapeType / surfaceCenterOfMass 真返回', () => {
    const box = occtApi.makeBox(10, 10, 10)
    let face: BrepHandle | undefined
    try {
      const bb = occtApi.boundingBox(box)
      expect(bb.xmax - bb.xmin).toBeCloseTo(10)
      expect(bb.ymax - bb.ymin).toBeCloseTo(10)
      expect(bb.zmax - bb.zmin).toBeCloseTo(10)
      expect(occtApi.shapeType(box)).toBe('solid')
      const faces = occtApi.getSubShapes(box, 'face')
      face = faces[0]
      const com = occtApi.surfaceCenterOfMass(face)
      // 面序不定：质心必为盒表面上的面中心（某坐标 ≈±5，其余 ≈0）
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

  it('原生代理冒烟：downcast / makeVertex / makeEllipsoid 真返回', () => {
    const box = occtApi.makeBox(10, 10, 10)
    let v: BrepHandle | undefined
    let e: BrepHandle | undefined
    try {
      const faces = occtApi.getSubShapes(box, 'face')
      const f = faces[0]
      const down = occtApi.downcast(f, 'face')
      expect(typeof down).toBe('number')
      v = occtApi.makeVertex(1, 2, 3)
      e = occtApi.makeEllipsoid(2, 3, 4)
      expect(occtApi.shapeType(e)).toBe('solid')
      occtApi.release(f)
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
      // shell：抽壳（移除一个面，brepkit wasm(solid, thickness, open_faces)）
      const faces = api.getSubShapes(box, 'face')
      expect(faces.length).toBeGreaterThan(0)
      const hollow = api.shell(box, [faces[0]], 1, 0.01)
      expect(typeof hollow).toBe('number')
      // 真几何校验：抽壳后仍为有效 solid
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

  it('brepkit 侧 33 个新登记方法保持未声明（unsupported 桩不伪造能力）', async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
    const engine = await getBrepEngine()
    try {
      const declared = new Set(engine.capabilities!.methods)
      // brepkit 真实现映射 7 个（wasm 导出存在且已接线）——允许声明；其余 Phase 3
      // 方法 brepkitKernel 为 unsupported 桩或语义不匹配 → 不得声明（否则静态判定
      // 放行后死在桩上 = 红线）。
      const brepkitReal = new Set([
        'boundingBox', 'surfaceCenterOfMass',
        'makeEllipsoid', 'makeTorus', 'makeVertex', 'mirror', 'shell',
      ])
      for (const m of PHASE3_METHODS) {
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
