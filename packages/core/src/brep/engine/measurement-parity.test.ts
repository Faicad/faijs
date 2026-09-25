/**
 * @vitest-environment node
 *
 * measurement-parity — occt 与 brepkit 双引擎下测量结果一致性
 *
 * 本测试钉死的事实：
 * 1. **BrepEngineApi 测量方法两引擎 parity 成立**：getVolume / getCenterOfMass /
 *    getBoundingBox 对同一几何（盒/球）结果一致（1% 容差）。
 *
 * （2026-09-25 core-decouple Phase 2：原「vendored 测量面双引擎 parity」与「注入
 * 缓存重置」两组用例随 occt-kernel-bridge 删除——core 不再注入 vendored registry，
 * 相关对拍迁至 packages/tests 自装配套件；本文件只保留与引擎注册表直接相关的
 * BrepEngineApi parity。）
 *
 * Run: npx vitest run src/brep/engine/measurement-parity.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { __resetEngineRegistriesForTests, getBrepEngine } from './registry'
import { registerOcctBrepEngine } from './adapters/occt'
import { registerBrepkitBrepEngine } from './adapters/brepkit'
import type { BrepEngineApi } from './primitives'

let occtApi: BrepEngineApi
let brepkitApi: BrepEngineApi

beforeAll(async () => {
  // occt 先（2026-09-25 core-decouple Phase 2：注册只管 core 引擎注册表，
  // 不再向 vendored registry 注入）
  await registerOcctBrepEngine()
  occtApi = (await getBrepEngine()).primitives

  __resetEngineRegistriesForTests()
  await registerBrepkitBrepEngine()
  brepkitApi = (await getBrepEngine()).primitives

  // 恢复 occt 为默认（其它测试文件不受影响）
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

const BOX_VOLUME = 20 * 10 * 5 // 1000
const BOX_AREA = 2 * (20 * 10 + 20 * 5 + 10 * 5) // 700
const SPHERE_R = 10
const SPHERE_VOLUME = (4 / 3) * Math.PI * SPHERE_R ** 3

describe('BrepEngineApi 测量方法：两引擎结果一致', () => {
  it('getVolume：盒体积一致（1% 容差）且等于解析值', () => {
    const occtBox = occtApi.makeBox(20, 10, 5)
    const bkBox = brepkitApi.makeBox(20, 10, 5)
    try {
      const occtV = occtApi.getVolume(occtBox)
      const bkV = brepkitApi.getVolume(bkBox)
      expect(occtV).toBeCloseTo(BOX_VOLUME, -1)
      expect(Math.abs(occtV - bkV) / occtV).toBeLessThan(0.01)
    } finally {
      occtApi.release(occtBox)
      brepkitApi.release(bkBox)
    }
  })

  it('getVolume：球体积一致（1% 容差）且等于解析值', () => {
    const occtS = occtApi.makeSphere(SPHERE_R)
    const bkS = brepkitApi.makeSphere(SPHERE_R)
    try {
      const occtV = occtApi.getVolume(occtS)
      const bkV = brepkitApi.getVolume(bkS)
      expect(occtV).toBeCloseTo(SPHERE_VOLUME, -2)
      expect(Math.abs(occtV - bkV) / occtV).toBeLessThan(0.01)
    } finally {
      occtApi.release(occtS)
      brepkitApi.release(bkS)
    }
  })

  it('getCenterOfMass：盒质心一致（角在原点 → (10,5,2.5)）', () => {
    const occtBox = occtApi.makeBox(20, 10, 5)
    const bkBox = brepkitApi.makeBox(20, 10, 5)
    try {
      const occtC = occtApi.getCenterOfMass(occtBox)
      const bkC = brepkitApi.getCenterOfMass(bkBox)
      expect(occtC.x).toBeCloseTo(10, 1)
      expect(occtC.y).toBeCloseTo(5, 1)
      expect(occtC.z).toBeCloseTo(2.5, 1)
      expect(bkC.x).toBeCloseTo(occtC.x, 1)
      expect(bkC.y).toBeCloseTo(occtC.y, 1)
      expect(bkC.z).toBeCloseTo(occtC.z, 1)
    } finally {
      occtApi.release(occtBox)
      brepkitApi.release(bkBox)
    }
  })

  it('getBoundingBox：球包围盒一致（r=10 → [-10,10]³）', () => {
    const occtS = occtApi.makeSphere(SPHERE_R)
    const bkS = brepkitApi.makeSphere(SPHERE_R)
    try {
      const occtB = occtApi.getBoundingBox(occtS)
      const bkB = brepkitApi.getBoundingBox(bkS)
      for (const k of ['xmin', 'ymin', 'zmin'] as const) {
        expect(occtB[k]).toBeCloseTo(-SPHERE_R, 0)
        expect(bkB[k]).toBeCloseTo(occtB[k], 0)
      }
      for (const k of ['xmax', 'ymax', 'zmax'] as const) {
        expect(occtB[k]).toBeCloseTo(SPHERE_R, 0)
        expect(bkB[k]).toBeCloseTo(occtB[k], 0)
      }
    } finally {
      occtApi.release(occtS)
      brepkitApi.release(bkS)
    }
  })
})

