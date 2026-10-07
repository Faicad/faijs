/**
 * @vitest-environment node
 *
 * applyMatrix / scaleBrep 的**变换路径分派**回归测试（2026-10-07，openscad
 * example023 parity）。
 *
 * 背景：`gp_Trsf`（`kernel.transform`）只能承载**相似变换**（旋转/反射 × 等比
 * 缩放）；非等比缩放、错切必须走 `gp_GTrsf`（`kernel.generalTransform`）。
 * 判据与两条路径的坑在 `src/brep/brep-ops.ts` 的 `isSimilarityAffine` /
 * `applyAffineBrep` 里，本文件钉住两件事：
 *
 * 1. **判据本身**：7 位小数打印的刚体旋转（`0.8660254`）必须判为相似。
 *    这是 example023 的直接根因——旧的绝对容差 1e-9 把它推给了 GTrsf 路径。
 * 2. **不变量**：无论走哪条路径，三角化出的网格 Z 范围必须与精确 bbox 一致；
 *    两个引擎（occt / brepkit）都跑——分派本身是引擎中立的。
 *
 * 第三条（occt **原生** `gp_GTrsf` 会污染**已缓存三角化**，所以绕过必须留在 occt
 * 适配层、不能放进这个引擎中立分派器）由
 * `test/brep/occt-gtrsf-tessellation-gotcha.test.ts` 单独刻画：那是 occt 独有的
 * 缺陷，单独成文件才能在 occt-wasm 修好时整份翻转。
 *
 * 语料（矩阵 + 挤出错 + 量尺）在 `test/support/affine-fixtures.ts`，与上面那份
 * 缺陷测试共用同一份实现——判据一旦漂移，两边就不再可比。
 *
 * 运行：npx vitest run packages/core/test/brep/applymatrix-similarity-routing.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getBrepEngine } from '../../src/brep/engine/registry'
import { createBrepkitPrimitives } from '../../src/brepkit-kernel/brepkitKernel'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { applyAffineBrep, isSimilarityAffine } from '../../src/brep/brep-ops'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import {
  DEGENERATE,
  IDENTITY,
  MIRROR_X,
  ROT_Z60_FULL,
  ROT_Z60_SCALED3,
  ROT_Z60_TRUNCATED,
  SCALE_Z25,
  SHEAR_XY,
  exactZRange,
  extrudedPrismWithHole,
  meshZRange,
} from '../support/affine-fixtures'

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
