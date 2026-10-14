/**
 * @vitest-environment node
 *
 * cadquery-selectors — brepkit 引擎等价测试。
 *
 * 目标（2026-10-12 内核无关化）：CadQuery 选择器语法在 brepkit 内核上的求值
 * 与 occt 语义**几何一致**——这是"小程序端（brepkit）也能用这个风格的选择器
 * 语法"的验收。选择器引擎只经 `getBrepApi()`（BrepEngineApi，引擎中立）访问
 * 内核；occt 语义由 `selectors.test.ts` 钉住（同一组期望值），本文件装配
 * brepkit 后断言**同一组几何期望**——两文件各自通过即证明双内核等价。
 *
 * ⚠️ 装配纪律：选择器引擎取全局 backends 的当前引擎（`getBrepApi()`），
 * 因此本文件**只装配 brepkit**，绝不在同一进程内切换 occt/brepkit
 * （双引擎切换会把 A 内核句柄喂给 B 内核，产生 "invalid shell handle"）。
 *
 * 参照长方体：20×10×5，居中到原点（-10..10 × -5..5 × -2.5..2.5）。
 * occt 与 brepkit 的 `TopExp::MapShapes` 枚举序不同——本测试刻意不断言序号，
 * 只断言几何身份（center 集合）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getActiveBrepEngine, __resetEngineRegistriesForTests } from '../../../src/brep/engine/registry'
import { registerBrepkitBrepEngine } from '../../../src/brep/engine/adapters/brepkit'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../../src/runtime-state'
import { getBrepApi } from '../../../src/brep/handle-bridge'
import type { BrepHandle } from '../../../src/brep/engine/types'
import type { BrepEngineApi } from '../../../src/brep/engine/primitives'
import { resolveStepHandles, resolveSelection } from '../../../src/api/cadquery-selectors/resolve'
import { faceGeom, edgeGeom, vertexGeom, subShapeHandles } from '../../../src/api/cadquery-selectors/entity'
import type { EntityGeom } from '../../../src/api/cadquery-selectors/entity'
import type { SelStep } from '../../../src/api/cadquery-selectors/types'
import { disposeBrepkit } from '../../../src/brepkit-kernel/brepkitKernel'

/** 装配 brepkit 引擎并返回其 L1 契约面（选择器引擎经它访问内核）。 */
async function assemble(): Promise<BrepEngineApi> {
  __resetEngineRegistriesForTests()
  await registerBrepkitBrepEngine()
  const brep = await getActiveBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepEngineId: 'brepkit' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
  return getBrepApi()
}

/** 20×10×5 长方体，居中到原点（-10..10 × -5..5 × -2.5..2.5）。 */
function box(api: BrepEngineApi): BrepHandle {
  return api.makeBoxFromCorners({ x: -10, y: -5, z: -2.5 }, { x: 10, y: 5, z: 2.5 })
}

function project(kind: EntityGeom['kind'], h: BrepHandle): EntityGeom {
  return kind === 'face' ? faceGeom(h) : kind === 'edge' ? edgeGeom(h) : vertexGeom(h)
}

/** 结果几何集合（center 排序后的稳定字符串）。 */
function centerSet(kind: EntityGeom['kind'], handles: BrepHandle[]): string[] {
  return handles
    .map((h) => {
      const c = project(kind, h).center()
      return `${c.x},${c.y},${c.z}`
    })
    .sort()
}

// 6 张面中心：±X 面 (±10,0,0)、±Y 面 (0,±5,0)、±Z 面 (0,0,±2.5)
const FACE_CENTERS = ['-10,0,0', '10,0,0', '0,-5,0', '0,5,0', '0,0,-2.5', '0,0,2.5'].sort()

describe('cadquery-selectors brepkit 等价（box 20×10×5，与 selectors.test.ts occt 同一期望）', () => {
  let api: BrepEngineApi
  let solid: BrepHandle

  beforeAll(async () => {
    api = await assemble()
    solid = box(api)
  }, 120000)

  afterAll(() => {
    disposeBrepkit()
    __resetEngineRegistriesForTests()
  })

  it('面/边/顶点枚举数量与几何一致（6 面 / 12 边 / 8 顶点）', () => {
    expect(centerSet('face', subShapeHandles(solid, 'face'))).toEqual(FACE_CENTERS)
    expect(subShapeHandles(solid, 'edge').length).toBe(12)
    expect(subShapeHandles(solid, 'vertex').length).toBe(8)
  })

  it('面选择器：">Z" / "|Z" / "top" 与 occt 语义一致', () => {
    // 极值顶面恰 1 张，center (0,0,2.5)
    expect(centerSet('face', resolveStepHandles(solid, 'face', '>Z'))).toEqual(['0,0,2.5'])
    // 法向平行 Z 的面 2 张（顶+底）
    expect(centerSet('face', resolveStepHandles(solid, 'face', '|Z'))).toEqual(['0,0,-2.5', '0,0,2.5'])
    // 命名视图 top = CadQuery (0,1,0) 极值 = Y 正方向面（selectors.py:687-694），
    // 与 selectors.test.ts 的 occt 断言（top → y=1 面）同一语义
    expect(centerSet('face', resolveStepHandles(solid, 'face', 'top'))).toEqual(['0,5,0'])
  })

  it('边选择器："|Z" / ">Z" / "%LINE" 与 occt 语义一致', () => {
    // 全部 12 条边都是直线（brepkit curveType 大写 'LINE'——kind 归一后命中）
    expect(resolveStepHandles(solid, 'edge', '%LINE').length).toBe(12)
    // 平行 Z 的 4 条竖边（center z=0）
    expect(centerSet('edge', resolveStepHandles(solid, 'edge', '|Z'))).toEqual([
      '-10,-5,0', '-10,5,0', '10,-5,0', '10,5,0',
    ].sort())
    // 极值 >Z：顶面 4 条边（z=2.5）的中点（与 selectors.test.ts `>>Z` 的
    // 边中点断言同一语义：'0,0.5,1' 一类）
    expect(centerSet('edge', resolveStepHandles(solid, 'edge', '>Z'))).toEqual([
      '0,-5,2.5', '0,5,2.5', '-10,0,2.5', '10,0,2.5',
    ].sort())
  })

  it('顶点选择器：">Z" 顶部 4 顶点 与 occt 语义一致', () => {
    expect(centerSet('vertex', resolveStepHandles(solid, 'vertex', '>Z'))).toEqual([
      '-10,-5,2.5', '-10,5,2.5', '10,-5,2.5', '10,5,2.5',
    ].sort())
  })

  it('链式收窄 {face:">Z"} → {vertex:"<XY"} 与 occt 语义一致', () => {
    const chain: SelStep[] = [{ kind: 'face', sel: '>Z' }, { kind: 'vertex', sel: '<XY' }]
    const { kind, handles } = resolveSelection(solid, chain)
    expect(kind).toBe('vertex')
    // 顶面里 x+y 最小的顶点 = (-10,-5,2.5)
    expect(centerSet('vertex', handles)).toEqual(['-10,-5,2.5'])
  })

  it('BrepEngineApi 新原语：vertexPosition / containsPoint（brepkit 映射）', () => {
    const verts = subShapeHandles(solid, 'vertex')
    // 8 个顶点坐标必须落在长方体角点上
    const positions = verts.map((v) => api.vertexPosition(v))
    const key = (p: { x: number; y: number; z: number }): string => `${p.x},${p.y},${p.z}`
    expect(positions.map(key).sort()).toEqual([
      '-10,-5,-2.5', '-10,-5,2.5', '-10,5,-2.5', '-10,5,2.5',
      '10,-5,-2.5', '10,-5,2.5', '10,5,-2.5', '10,5,2.5',
    ].sort())
    // 体内点 → true；体外点 → false
    expect(api.containsPoint(solid, { x: 0, y: 0, z: 0 }, 1e-9)).toBe(true)
    expect(api.containsPoint(solid, { x: 100, y: 100, z: 100 }, 1e-9)).toBe(false)
  })
})
