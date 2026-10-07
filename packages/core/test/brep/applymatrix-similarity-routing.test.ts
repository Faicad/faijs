/**
 * @vitest-environment node
 *
 * applyMatrix / scaleBrep 的**变换路径分派**回归测试（2026-10-07，openscad
 * example023 parity）。
 *
 * 背景：`gp_Trsf`（`kernel.transform`）只能承载**相似变换**（旋转/反射 × 等比
 * 缩放）；非等比缩放、错切必须走 `gp_GTrsf`（`kernel.generalTransform`）。
 * 分派判据与两条路径的坑都在 `src/brep/brep-ops.ts` 的 `isSimilarityAffine` /
 * `applyAffineBrep` 里，本文件钉住三件事：
 *
 * 1. **判据本身**：7 位小数打印的刚体旋转（`0.8660254`）必须判为相似。
 *    这是 example023 的直接根因——旧的绝对容差 1e-9 把它推给 GTrsf 路径。
 * 2. **不变量**：无论走哪条路径，三角化出的网格 Z 范围必须与精确 bbox 一致；
 *    两个引擎（occt / brepkit）都跑——分派本身是引擎中立的。
 * 3. **GOTCHA 金丝雀**：occt **原生** `generalTransform`（`gp_GTrsf`）作用于
 *    **已三角化**的形状会产出与自身精确 bbox 不一致的网格（顶盖 TopLoc 被重复
 *    计入），而 L1 面同一调用是干净的。这条就是「绕过必须留在 **occt 适配层**
 *    （`occt-kernel/occt-primitives.ts` 的 `generalTransform`）而不是引擎中立
 *    分派器」的证据：brepkit 的 GTrsf 路径无此毛病，不该陪跑。
 *    若哪天 occt-wasm 修好它，本文件会失败——那正是"该重新评估绕过是否还需要"
 *    的信号，不是回归。
 *
 * 运行：npx vitest run packages/core/test/brep/applymatrix-similarity-routing.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getBrepEngine } from '../../src/brep/engine/registry'
import { createBrepkitPrimitives } from '../../src/brepkit-kernel/brepkitKernel'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { applyAffineBrep, isSimilarityAffine } from '../../src/brep/brep-ops'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import type { BrepHandle } from '../../src/brep/engine/types'

// ── 矩阵样本 ──

/** 7 位小数打印的 60° Z 旋转 —— openscad 语料里 multmatrix 的实际形态。 */
const ROT_Z60_TRUNCATED = [0.5, -0.8660254, 0, 0, 0.8660254, 0.5, 0, 0, 0, 0, 1, 0]
/** 同一旋转的全精度形态。 */
const ROT_Z60_FULL = [0.5, -Math.sin(Math.PI / 3), 0, 0, Math.sin(Math.PI / 3), 0.5, 0, 0, 0, 0, 1, 0]
/** 旋转 × 等比 3。 */
const ROT_Z60_SCALED3 = [1.5, -0.8660254 * 3, 0, 0, 0.8660254 * 3, 1.5, 0, 0, 0, 0, 3, 0]
/** 非等比：Z 方向 ×2.5。 */
const SCALE_Z25 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2.5, 0]
/** 错切。 */
const SHEAR_XY = [1, 0.3, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]
/** 镜像（det<0，仍是相似变换——行为与修复前一致）。 */
const MIRROR_X = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]
const DEGENERATE = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]

describe('isSimilarityAffine — 判据表', () => {
  it('7 位小数打印的刚体旋转判为相似（example023 根因）', () => {
    expect(isSimilarityAffine(ROT_Z60_TRUNCATED)).toBe(true)
  })
  it('全精度旋转判为相似', () => {
    expect(isSimilarityAffine(ROT_Z60_FULL)).toBe(true)
  })
  it('旋转 × 等比缩放判为相似（判据是相对量，与绝对尺度无关）', () => {
    expect(isSimilarityAffine(ROT_Z60_SCALED3)).toBe(true)
  })
  it('单位矩阵判为相似', () => {
    expect(isSimilarityAffine(IDENTITY)).toBe(true)
  })
  it('镜像判为相似（维持修复前行为）', () => {
    expect(isSimilarityAffine(MIRROR_X)).toBe(true)
  })
  it('非等比缩放判为**非**相似', () => {
    expect(isSimilarityAffine(SCALE_Z25)).toBe(false)
  })
  it('错切判为**非**相似', () => {
    expect(isSimilarityAffine(SHEAR_XY)).toBe(false)
  })
  it('退化矩阵（零行）判为**非**相似', () => {
    expect(isSimilarityAffine(DEGENERATE)).toBe(false)
  })
})

// ── 端到端不变量：网格 Z 范围 == 精确 bbox Z 范围 ──

const P3 = (x: number, y: number): { x: number; y: number; z: number } => ({ x, y, z: 0 })

function rectWire(k: BrepEngineApi, pts: [number, number][]): BrepHandle {
  const edges: BrepHandle[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    edges.push(k.makeLineEdge(P3(a[0], a[1]), P3(b[0], b[1])))
  }
  const w = k.makeWire(edges)
  for (const e of edges) k.release(e)
  return w
}

/**
 * 复刻 `cad.profile` + `cad.extrude` 的产物：外环 + 孔 → planar face → 挤出 5。
 * 孔必须存在——顶盖（被平移的面）的 TopLoc 正是 bug 的载体。
 */
function extrudedPrismWithHole(k: BrepEngineApi): BrepHandle {
  const outer = rectWire(k, [[1, 1], [6, 1], [6, 6], [1, 6]])
  const hole = rectWire(k, [[3, 3], [5, 3], [5, 5], [3, 5]])
  const face = k.addHolesInFace(k.makeFace(outer), [hole])
  return k.extrude(face, 0, 0, 5)
}

/**
 * 量尺只需要两个能力：三角化 + 精确 bbox。L1 面（`BrepEngineApi`）与 occt
 * **原生**面（方言名不同，这两个方法名恰好相同）都具备，所以同一组工具能同时
 * 量两层、直接对照——这是金丝雀能把"原生有缺陷 / L1 已绕过"并排钉住的前提。
 */
interface MeasureFace {
  meshShape(
    shape: unknown,
    options: { linearDeflection: number; angularDeflection: number },
  ): { positions: ArrayLike<number>; indices: ArrayLike<number> }
  getBoundingBox(shape: unknown): { zmin: number; zmax: number }
}

/** occt 原生面中金丝雀要用到的部分（`gp_GTrsf` 直通，无适配层绕过）。 */
interface NativeOcctFace extends MeasureFace {
  generalTransform(shape: unknown, matrix: number[]): unknown
}

/** 三角化后用到的顶点 Z 范围。 */
function meshZRange(k: MeasureFace, shape: unknown): [number, number] {
  const m = k.meshShape(shape, {
    linearDeflection: 0.1,
    angularDeflection: (2 * Math.PI) / 32,
  })
  let min = Infinity
  let max = -Infinity
  for (const v of Array.from(m.indices)) {
    const z = m.positions[v * 3 + 2]!
    if (z < min) min = z
    if (z > max) max = z
  }
  return [min, max]
}

/** 内核精确 bbox 的 Z 范围（与三角化无关，是"真值"）。 */
function exactZRange(k: MeasureFace, shape: unknown): [number, number] {
  const bb = k.getBoundingBox(shape)
  return [bb.zmin, bb.zmax]
}

/**
 * 对给定引擎跑不变量：相似与非相似两条路径产出的网格都必须自洽。
 * @param label - 引擎名（用例标题用）。
 * @param getK - 返回该引擎 L1 面的异步取用函数。
 */
function invariantSuite(label: string, getK: () => Promise<BrepEngineApi>): void {
  describe(`${label} — applyAffineBrep 网格与精确几何必须一致`, () => {
    let k: BrepEngineApi
    beforeAll(async () => {
      k = await getK()
    }, 120_000)

    it('相似（7 位小数旋转）：网格 z 与精确 bbox 一致，且保持 [0, 5]', () => {
      const prism = extrudedPrismWithHole(k)
      meshZRange(k, prism) // 先三角化：这正是暴露 bug 的前置条件
      const out = applyAffineBrep(k, prism, ROT_Z60_TRUNCATED)
      const [meshMin, meshMax] = meshZRange(k, out)
      const [exactMin, exactMax] = exactZRange(k, out)
      expect(meshMin).toBeCloseTo(exactMin, 6)
      expect(meshMax).toBeCloseTo(exactMax, 6)
      expect(meshMin).toBeCloseTo(0, 4)
      expect(meshMax).toBeCloseTo(5, 4)
    })

    it('非相似 Z×2.5：网格 z 与精确 bbox 一致，且保持 [0, 12.5]', () => {
      const prism = extrudedPrismWithHole(k)
      meshZRange(k, prism)
      const out = applyAffineBrep(k, prism, SCALE_Z25)
      const [meshMin, meshMax] = meshZRange(k, out)
      const [exactMin, exactMax] = exactZRange(k, out)
      expect(meshMin).toBeCloseTo(exactMin, 6)
      expect(meshMax).toBeCloseTo(exactMax, 6)
      expect(meshMin).toBeCloseTo(0, 4)
      expect(meshMax).toBeCloseTo(12.5, 4)
    })
  })
}

invariantSuite('occt', async () => {
  await registerOcctBrepEngine()
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
  // 必须走 L1 契约面（`copyShape` 等中立名只在这里），不能用 `getKernel()` 的
  // 原生 occt 句柄——那是 occt 方言面，名字不同（`copy`）。
  return getBrepApi()
})

invariantSuite('brepkit', () => createBrepkitPrimitives())

describe('GOTCHA 金丝雀：occt 原生 GTrsf 在已三角化形状上污染网格', () => {
  let k: BrepEngineApi
  let native: NativeOcctFace
  beforeAll(async () => {
    await registerOcctBrepEngine()
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
    k = getBrepApi()
    // 原生面 = 未经 L1 适配的对象字面量。句柄在两层之间是同一个数字 id
    // （`asHandle`/`asShape` 都是零开销 cast），故可直接拿 L1 造的句柄喂它。
    native = (await initOcctWasm()) as unknown as NativeOcctFace
  }, 120_000)

  it('原生面网格顶盖 10（精确 5）；同一调用走 L1 面则两层一致', () => {
    const prism = extrudedPrismWithHole(k)
    meshZRange(k, prism) // 先三角化：暴露缺陷的前置条件（挤出产物本就已被三角化）

    // ① 原生 GTrsf 直通 —— 复现缺陷。
    const nativeOut = native.generalTransform(prism, ROT_Z60_TRUNCATED)
    const [, nativeExactMax] = exactZRange(native, nativeOut)
    const [, nativeMeshMax] = meshZRange(native, nativeOut)
    // occt-wasm 实测：精确顶盖 5，网格顶盖 10（被平移面的 TopLoc 被计入两次）。
    expect(nativeExactMax).toBeCloseTo(5, 4)
    expect(nativeMeshMax).toBeCloseTo(10, 4)
    expect(Math.abs(nativeMeshMax - nativeExactMax)).toBeGreaterThan(1)

    // ② L1 面同一调用 —— 适配层的 copy 绕过生效，网格与精确一致。
    const l1Out = k.generalTransform(prism, ROT_Z60_TRUNCATED)
    const [, l1ExactMax] = exactZRange(k, l1Out)
    const [, l1MeshMax] = meshZRange(k, l1Out)
    expect(l1MeshMax).toBeCloseTo(l1ExactMax, 6)
    expect(l1MeshMax).toBeCloseTo(5, 4)
  })
})
