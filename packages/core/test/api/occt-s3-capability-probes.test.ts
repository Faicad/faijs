/**
 * @vitest-environment node
 *
 * occt S3 能力探针（长期保留，可重复跑）——方案 §3.4.4 `halfSpace` 的落点判据。
 *
 * 背景：`halfSpace(origin, normal)` 产**无限半空间实体**，作无界布尔切割工具。
 * 本仓所有 brep op 产物都要经 `solidToShape` 即时三角化（`brep/brep-ops.ts:57-81`），
 * 所以必须实证两条，才能决定它是「可接入」还是「显式排除」：
 *   A. 无限半空间三角化的实测结果（崩？空？）；
 *   B. 以它为 `cut` 工具切有限体的实测结果（能否真切出）。
 *
 * 本文件钉住当前实测值；若上游/本仓改变（有界化、惰性三角化等），断言需相应翻转。
 *
 * Run: npx vitest run test/api/occt-s3-capability-probes.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initOcctWasm, getOcctKernel } from '../../src/occt-kernel/occtKernel'
import { __resetEngineRegistriesForTests, getBrepEngine } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { solidToShape } from '../../src/brep/brep-ops'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import type { BrepHandle } from '../../src/brep/engine/types'

beforeAll(async () => {
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
  await initOcctWasm()
  const brep = await getBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepCapabilities: brep.capabilities, brepEngineId: 'occt' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

describe('halfSpace — 无限半空间实体的实测行为（方案 §3.4.4）', () => {
  it('A. 原生 halfSpace 产句柄；直接 solidToShape 三角化 → 成功但 mesh 为空（0 顶点）', () => {
    const k = getOcctKernel()
    const h = k.halfSpace({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }) as unknown as BrepHandle
    expect(h).toBeDefined()
    // 实测：无限半空间**可以**被三角化（不抛错），但产出空 mesh（无有限面可离散）。
    const s = solidToShape(getBrepApi(), h)
    expect(s.positions.length).toBe(0)
    expect(s.indices.length).toBe(0)
  })

  it('B. 作 cut 工具切有限体：z=5 的半空间把 10³ box 切成 z∈[0,5] → 体积 500', () => {
    const kernel = getBrepApi()
    const k = getOcctKernel()
    const boxShape = kernel.makeBox(10, 10, 10)
    expect(kernel.getVolume(boxShape)).toBeCloseTo(1000, 6)

    const half = k.halfSpace({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 1 }) as unknown as BrepHandle
    const cut = kernel.cut(boxShape, half) as unknown as BrepHandle
    // 实测：半空间（平面在 z=5）作为无界工具**可用**——切出 z∈[0,5] 的板。
    expect(Math.abs(kernel.getVolume(cut))).toBeCloseTo(500, 3)
    const bbox = kernel.getBoundingBox(cut)
    expect(bbox.zmax).toBeCloseTo(5, 3)
    expect(bbox.zmin).toBeCloseTo(0, 3)
  })

  it('C. 对照：z=0 的半空间把整个 box 包住 ⇒ cut 后为空（体积 0，与几何一致）', () => {
    const kernel = getBrepApi()
    const k = getOcctKernel()
    const boxShape = kernel.makeBox(10, 10, 10)
    const half = k.halfSpace({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }) as unknown as BrepHandle
    const cut = kernel.cut(boxShape, half) as unknown as BrepHandle
    expect(Math.abs(kernel.getVolume(cut))).toBeCloseTo(0, 3)
  })
})

describe('law 族 — buildExtrusionLaw / trimLaw / sweepWithLaw 的上游可达性（方案 §3.4.3 / §5.4）', () => {
  /**
   * 4×4 方截面 + 沿 +Z 的 50mm 脊柱，皆经 L1 契约构造（可复现）。
   * GOTCHA：occt 原生的 `sweepFull` 只吃 **wire** 截面，传 face 会
   * `BRepFill_Section: bad shape type of section`（op 层的「面 → 外环」适配由
   * `api/internal/profile-wire.ts` 承担，不在原生层）。
   */
  function profileAndSpine(): { face: BrepHandle; wire: BrepHandle; spine: BrepHandle } {
    const kernel = getBrepApi()
    const v = (x: number, y: number, z: number) => ({ x, y, z })
    const edge = (a: [number, number, number], b: [number, number, number]): BrepHandle =>
      kernel.makeLineEdge(v(...a), v(...b)) as unknown as BrepHandle
    const square = kernel.makeWire([
      edge([-2, -2, 0], [2, -2, 0]),
      edge([2, -2, 0], [2, 2, 0]),
      edge([2, 2, 0], [-2, 2, 0]),
      edge([-2, 2, 0], [-2, -2, 0]),
    ]) as unknown as BrepHandle
    return {
      wire: square,
      face: kernel.makeFace(square) as unknown as BrepHandle,
      spine: kernel.makeWire([edge([0, 0, 0], [0, 0, 50])]) as unknown as BrepHandle,
    }
  }

  /** 三个 law 原生在 raw 模块上的 typeof（`getRawKernel` 是 occt-wasm 的集成面逃生口）。 */
  function rawPresence(): Record<string, unknown> {
    const raw = getOcctKernel().getRawKernel() as unknown as Record<string, unknown>
    return {
      buildExtrusionLaw: typeof raw.buildExtrusionLaw,
      trimLaw: typeof raw.trimLaw,
      sweepWithLaw: typeof raw.sweepWithLaw,
    }
  }

  it('D. 当前值：npm latest（occt-wasm 5.6.0）的 raw 模块上三个 law 原生**全部未导出**', () => {
    // 【两值并钉】
    //   当前错误值 = 'undefined'：上游 `facade/include/occt_kernel.h:441-444` 声明了
    //     `buildExtrusionLaw` / `trimLaw` / `sweepWithLaw`，TS 包装层
    //     （`ts/src/index.ts:2121-2131`）也包了它们，但 `facade/generated/kernel.cpp`
    //     **没有对应实现** ⇒ 编译进 wasm 的导出表里没有这三个函数。
    //   应有正确值 = 'function'。上游补实现并发版后，本断言必须整体翻转为
    //     `{ buildExtrusionLaw: 'function', trimLaw: 'function', sweepWithLaw: 'function' }`。
    //   核过 npm registry：5.6.0 即 latest，无更新版本可升。
    expect(rawPresence()).toEqual({
      buildExtrusionLaw: 'undefined',
      trimLaw: 'undefined',
      sweepWithLaw: 'undefined',
    })
  })

  it('E. 当前值：TS 包装面无条件转发 ⇒ 调用即抛 "is not a function"（声明与实现脱节）', () => {
    const k = getOcctKernel()
    expect(() => k.buildExtrusionLaw('linear', 50, 0.5)).toThrow(/is not a function/)
    expect(() => k.trimLaw(0 as never, 0.2, 0.8)).toThrow(/is not a function/)
    expect(() => k.sweepWithLaw(0 as never, 0 as never, 0 as never)).toThrow(/is not a function/)
  })

  it('F. 对照：law 驱动扫掠的能力**并未丢失** —— `sweepFull` 内建 Law_Linear / Law_S', () => {
    const kernel = getBrepApi()
    const k = getOcctKernel()
    const { wire, face, spine } = profileAndSpine()
    // SweepLaw.Linear = 1；lawLength 必填（缺失时 sweepFull 自己抛）。
    const swept = k.sweepFull(wire, spine, {
      law: 1 as never,
      lawLength: 50,
      lawEndFactor: 0.5,
    }) as unknown as BrepHandle
    const volume = Math.abs(kernel.getVolume(swept))
    const bbox = kernel.getBoundingBox(swept)
    // 4×4 截面 = 16mm²；线性律由 1 缩到 0.5 ⇒ 体积严格落在 (16×50×0.5, 16×50)。
    expect(bbox.zmax).toBeCloseTo(50, 1)
    expect(volume).toBeGreaterThan(16 * 50 * 0.5)
    expect(volume).toBeLessThan(16 * 50)
    // law ≠ None 且缺 lawLength 必须抛，不能静默按 0 处理。
    expect(() => k.sweepFull(wire, spine, { law: 1 as never })).toThrow(/lawLength is required/)
    // GOTCHA 并钉：原生 sweepFull 拒收 face 截面（wire 才合法）。
    expect(() => k.sweepFull(face, spine, {})).toThrow(/bad shape type of section/)
  })
})
