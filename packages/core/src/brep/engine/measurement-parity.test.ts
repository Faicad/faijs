/**
 * @vitest-environment node
 *
 * measurement-parity — occt 与 brepkit 双引擎下测量结果一致性 + vendored 测量面边界
 *
 * 三层事实（本测试钉死）：
 * 1. **BrepEngineApi 测量方法两引擎 parity 成立**：getVolume / getCenterOfMass /
 *    getBoundingBox 对同一几何（盒/球）结果一致（1% 容差）。
 * 2. **vendored 测量面双引擎 parity（BrepEngineApi 已具备的能力）**：
 *    `wrapBrepEngineApi` 在包装层合成胶水方法（createVector3d 等 6 个）并把
 *    vendored 测量方法名映射到 BrepEngineApi（volume→getVolume、centerOfMass→
 *    getCenterOfMass 元组化、boundingBox→getBoundingBox min/max 元组化），brepkit
 *    注入成功且 measureVolume / measureVolumeProps 与 occt 一致。
 *    GOTCHA（引擎契约缺口）：Phase 6 收口（D7）前 vendored `area` / `length` /
 *    `linearCenterOfMass` 在 BrepEngineApi 无对应能力，适配器上为 undefined；
 *    Phase 6 后 `area` / `length` 已映射到 L1 测量面（getSurfaceArea / getLength，
 *    Phase 4 D9 接线），brepkit 适配器同样真实可用；`linearCenterOfMass` 无 L1
 *    对应（L2 平台面）仍是真实缺口——不补桩、不返回 0，测试内联钉住 undefined。
 * 3. **注入缓存重置（防回归）**：同进程 occt 注入 → 重置 → brepkit 再注入，必须
 *    返回 brepkit 适配器。旧实现 `_injected` 无重置钩子会短路返回 occt 旧适配器
 *    （把 brepkit 数字句柄当 occt-wasm 指针解引用 → OOM/崩溃）。
 *
 * Run: npx vitest run src/brep/engine/measurement-parity.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { __resetEngineRegistriesForTests, getBrepEngine } from './registry'
import { registerOcctBrepEngine } from './adapters/occt'
import { registerBrepkitBrepEngine } from './adapters/brepkit'
import {
  injectCurrentBrepEngineAsKernel,
  isKernelInjected,
  __resetKernelInjectionForTests,
} from '../../api/occt-kernel-bridge'
import { handle as occtWasmHandleView } from '@faicad/faijs-brepjs/kernel/occtWasm/helpers'
import { fromHandle } from '../../brep/handle-bridge'
import type { BrepHandle } from '../../brep/engine/types'
import { measureArea, measureLength, measureVolume } from '../../api/generated/measurement'
import {
  measureVolume as vendoredMeasureVolume,
  measureVolumeProps,
} from '@faicad/faijs-brepjs/measurement/measureFns'
import type { BrepEngineApi } from './primitives'
import { configureBackends } from '../../runtime-state'

let occtApi: BrepEngineApi
let brepkitApi: BrepEngineApi

beforeAll(async () => {
  // occt 先（其注册内部完成 injectCurrentBrepEngineAsKernel——本进程唯一一次注入）
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

describe('vendored 测量面：双引擎 parity（BrepEngineApi 已具备的能力）', () => {
  it('occt：经注入的 vendored kernel，measureVolume / measureVolumeProps 正常且等于解析值', async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    const adapter = await injectCurrentBrepEngineAsKernel()
    expect(adapter).toBeDefined()
    const api = (await getBrepEngine()).primitives
    const box = api.makeBox(20, 10, 5)
    try {
      const h = { wrapped: occtWasmHandleView('solid' as never, box as never) }
      // vendored 层函数（绕生成 op 的 assertEngineFor 与借入——本测试直接构造
      // vendored 句柄，验证桥接映射本身）。
      const v = vendoredMeasureVolume(h as never)
      expect(v.ok).toBe(true)
      expect((v as { ok: true; value: number }).value).toBeCloseTo(BOX_VOLUME, -1)

      const props = measureVolumeProps(h as never)
      expect(props.ok).toBe(true)
      const vp = props as unknown as { ok: true; value: { volume: number; centerOfMass: readonly number[] } }
      expect(vp.value.volume).toBeCloseTo(BOX_VOLUME, -1)
      expect(vp.value.centerOfMass[0]).toBeCloseTo(10, 1)
      expect(vp.value.centerOfMass[1]).toBeCloseTo(5, 1)
      expect(vp.value.centerOfMass[2]).toBeCloseTo(2.5, 1)
    } finally {
      api.release(box)
    }
  })

  it('brepkit：注入成功（胶水方法由包装层合成），映射后的测量方法与解析值一致', async () => {
    __resetEngineRegistriesForTests()
    __resetKernelInjectionForTests()
    await registerBrepkitBrepEngine()
    const adapter = await injectCurrentBrepEngineAsKernel()
    expect(adapter).toBeDefined()
    expect(isKernelInjected()).toBe(true)
    const api = (await getBrepEngine()).primitives
    const box = api.makeBox(20, 10, 5)
    try {
      // 直接断言映射后的适配器方法（volume→getVolume / centerOfMass→元组 /
      // boundingBox→min/max 元组）——走真实 BrepEngineApi 数据，与 occt 同口径。
      const h = { wrapped: box }
      expect(adapter.volume(h as never)).toBeCloseTo(BOX_VOLUME, -1)
      const com = adapter.centerOfMass(h as never) as [number, number, number]
      expect(com[0]).toBeCloseTo(10, 1)
      expect(com[1]).toBeCloseTo(5, 1)
      expect(com[2]).toBeCloseTo(2.5, 1)
      const bb = adapter.boundingBox(h as never) as { min: number[]; max: number[] }
      expect(bb.min).toEqual([0, 0, 0])
      expect(bb.max).toEqual([20, 10, 5])
    } finally {
      api.release(box)
    }
  })

  it('GOTCHA：brepkit v1 适配器缺 shapeType/isNull → vendored measureVolumeProps 在装配期后仍会执行期抛错', async () => {
    // 缺陷④映射层只解决「方法名不对」；measureVolumeProps 还无条件调
    // kernel.isNull + kernel.shapeType（measureFns.ts:30,:60）。brepkit v1 白名单
    // 把这两个 BrepEngineApi 方法显式抛错（brepkitKernel.ts:577-578），且 wasm 层
    // 无类型查询能力（getEntityCounts/getCompoundSolids/toBrepJson 均无法区分
    // solid/compound，实测）——这是**引擎适配器能力缺口**（同缺陷⑤性质），不是
    // 桥接层缺口，属独立议题。此处钉死现状：经 vendored 面调 brepkit 体积会抛错。
    __resetEngineRegistriesForTests()
    __resetKernelInjectionForTests()
    await registerBrepkitBrepEngine()
    await injectCurrentBrepEngineAsKernel()
    const api = (await getBrepEngine()).primitives
    const box = api.makeBox(20, 10, 5)
    try {
      const h = { wrapped: box }
      // measureVolumeProps 先调 isNull（measureFns.ts:30）；isNull 已从 BrepEngineApi
      // 移至 occt 平台面，brepkit 侧无此方法 → 运行时抛 "isNull is not a function"。
      // （这是 vendored 函数层行为；生成 op 面在 brepkit 下由 assertEngineFor
      // 执行前报错，见「Phase 6 平台声明」测试。）
      expect(() => vendoredMeasureVolume(h as never)).toThrow(/isNull/)
    } finally {
      api.release(box)
    }
  })

  // vendored measureSurfaceProps 依赖 `area`：Phase 6 后 area 已映射（L1 测量面）。
  // 但 measureSurfaceProps 还调 kernel.isNull（measureFns.ts:30，occt 平台面）——
  // brepkit 侧抛错（上文 GOTCHA 测试钉住），故 vendored 面仍 occt-only；
  // brepkit 的面积可用性由下方「Phase 6 收口」测试直接断言适配器方法。
  it('occt：measureVolumeProps 面积分量一致（表面积 700）', async () => {
    __resetEngineRegistriesForTests()
    __resetKernelInjectionForTests()
    await registerOcctBrepEngine()
    await injectCurrentBrepEngineAsKernel()
    const api = (await getBrepEngine()).primitives
    const box = api.makeBox(20, 10, 5)
    try {
      const { measureSurfaceProps } = await import('@faicad/faijs-brepjs/measurement/measureFns')
      const h = { wrapped: occtWasmHandleView('solid' as never, box as never) }
      const sp = measureSurfaceProps(h as never)
      expect(sp.ok).toBe(true)
      expect((sp as { ok: true; value: { area: number } }).value.area).toBeCloseTo(BOX_AREA, -1)
    } finally {
      api.release(box)
    }
  })

  it('Phase 6 收口：area/length 在 brepkit 适配器真实可用；linearCenterOfMass 仍缺口（不补桩）', async () => {
    __resetEngineRegistriesForTests()
    __resetKernelInjectionForTests()
    await registerBrepkitBrepEngine()
    const adapter = await injectCurrentBrepEngineAsKernel()
    const api = (await getBrepEngine()).primitives
    const box = api.makeBox(20, 10, 5)
    try {
      // D7：area→getSurfaceArea / length→getLength（L1 测量面，两引擎同口径）。
      const h = { wrapped: box }
      expect(adapter.area(h as never)).toBeCloseTo(BOX_AREA, -1)
      expect(adapter.length(h as never)).toBeCloseTo(20, -1)
      // linearCenterOfMass 是 L2 平台面（primitives.ts 注释）：无 L1 对应，
      // 保持 undefined——静默 0 比崩溃更糟。
      expect((adapter as unknown as Record<string, unknown>)['linearCenterOfMass']).toBeUndefined()
    } finally {
      api.release(box)
    }
  })

  it('Phase 6 平台声明：vendored 测量 op 面在 brepkit 下执行前报错（D7→D11）', async () => {
    // vendored 投影面整体绑定 occt-wasm（l3-bridge 借入层 shapeType + 依赖
    // occt-only 内核方法），12 个 measurement query op 在 arg-spec 全部声明
    // engines: ['occt']——生成函数体第一行 assertEngineFor 在触碰内核之前
    // 报出可定位错误（D11-4 文案同构），而非执行期 TypeError。
    __resetEngineRegistriesForTests()
    __resetKernelInjectionForTests()
    await registerBrepkitBrepEngine()
    await injectCurrentBrepEngineAsKernel()
    configureBackends({
      contractVersion: 1,
      config: { mode: 'brep', brepCapabilities: {}, brepEngineId: 'brepkit' },
      kernel: { brep: null, csg: undefined, sdf: undefined },
      fonts: undefined,
      texture: undefined,
      assets: undefined,
      events: undefined,
      cad: {} as never,
    })
    const api = (await getBrepEngine()).primitives
    const box = api.makeBox(20, 10, 5)
    try {
      // 断言在函数体第一行执行，先于借入/内核调用——shape 只需满足类型（运行时
      // 不触碰它），构造最小 Shape 即可（无需 fromHandle / 网格化）。
      const shape = { positions: new Float32Array(0), indices: new Uint32Array(0) } as never
      expect(() => measureArea(shape)).toThrow(/E_BREP_UNSUPPORTED: op 'measureArea' requires engine occt \(current=brepkit\)/)
      expect(() => measureLength(shape)).toThrow(/E_BREP_UNSUPPORTED: op 'measureLength' requires engine occt \(current=brepkit\)/)
      expect(() => measureVolume(shape)).toThrow(/E_BREP_UNSUPPORTED: op 'measureVolume' requires engine occt \(current=brepkit\)/)
    } finally {
      api.release(box)
    }
  })

  it('Phase 6 平台声明：occt 下生成 op 面全链路可用（借入 → vendored → 数值）', async () => {
    __resetEngineRegistriesForTests()
    __resetKernelInjectionForTests()
    await registerOcctBrepEngine()
    await injectCurrentBrepEngineAsKernel()
    configureBackends({
      contractVersion: 1,
      config: { mode: 'brep', brepCapabilities: {}, brepEngineId: 'occt' },
      kernel: {
        brep: { meshShape: () => ({ positions: [0, 0, 0], indices: [0] }) } as never,
        csg: undefined,
        sdf: undefined,
      },
      fonts: undefined,
      texture: undefined,
      assets: undefined,
      events: undefined,
      cad: {} as never,
    })
    const api = (await getBrepEngine()).primitives
    const box = api.makeBox(20, 10, 5)
    try {
      const shape = fromHandle(box as BrepHandle)
      expect(measureArea(shape)).toBeCloseTo(BOX_AREA, -1)
      expect(measureVolume(shape)).toBeCloseTo(BOX_VOLUME, -1)
      // occt getLength 对 solid 按「边-面」计数（每条边计入两个相邻面）：
      // 20×10×5 盒 12 条边总长 140，实测 2×140 = 280。数值钉住（vendored
      // measureLinearProps 走 kernel.length 直通，无归一化）。
      expect(measureLength(shape)).toBeCloseTo(280, -1)
    } finally {
      api.release(box)
    }
  })
})

describe('注入缓存重置（防回归）：切引擎后再注入跟随当前引擎', () => {
  it('occt 注入 → 重置 → brepkit 再注入，返回 brepkit 适配器（非 occt 旧适配器）', async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    const occtAdapter = await injectCurrentBrepEngineAsKernel()

    __resetEngineRegistriesForTests()
    __resetKernelInjectionForTests()
    await registerBrepkitBrepEngine()
    const brepkitAdapter = await injectCurrentBrepEngineAsKernel()

    // 旧 bug：短路返回 occt 旧适配器（把 brepkit 数字句柄当指针解引用 → OOM）。
    expect(brepkitAdapter).not.toBe(occtAdapter)
    // brepkit 数字句柄能安全测量 = 不是 occt 指针适配器。
    const api = (await getBrepEngine()).primitives
    const box = api.makeBox(10, 10, 10)
    try {
      const v = brepkitAdapter.volume({ wrapped: box } as never)
      expect(v).toBeCloseTo(1000, -1)
    } finally {
      api.release(box)
    }
  })
})
