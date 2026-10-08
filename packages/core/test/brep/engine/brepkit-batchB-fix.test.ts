/**
 * @vitest-environment node
 *
 * brepkit-batchB-fix — 回归测试：chamfer / convexHull 在 brepkit 引擎上可用（优雅降级）
 *
 * 背景（2026-09-26 B 批）：
 *   - chamfer 曾声明 `engines: ['occt']`（handwritten op，chamfer.ts），brepkit 执行前
 *     报 `requires engine occt`。brepkitKernel 有真实现 `kernel.chamfer` /
 *     `kernel.chamferDistAngle`（brepkitKernel.ts:524-535），但无 `chamferWithHistory`。
 *   - convexHull 曾在 arg-spec 声明 `engines: ['occt']`（生成到 operations.ts），
 *     brepkit 执行前被平台门拦截。brepkitKernel.hullFromPoints 是真实现
 *     （→ kernel.convexHull，brepkitKernel.ts:477）。
 *
 * 修复：
 *   - chamfer（intersect 模式）：移除 engines 门控，chamferBrep 内按
 *     `hasNativeHistory('chamferWithHistory')` 静态分派（引擎身份事实，见
 *     `brep/engine/native-history.ts`）——
 *       occt（原生有 chamferWithHistory）→ chamferWithRoleTable 历史路径（面演化 + roleTable）；
 *       brepkit（原生没有）→ 裸 kernel.chamfer/chamferDistAngle，几何正确但**无面演化**
 *       （如实降级，不伪造恒等映射）。
 *   - convexHull（clone 模式）：arg-spec `engines:['occt']` → 中立 op（brepkitKernel
 *     原生提供 hullFromPoints，实现只用 L1 核心面，无需声明）。
 *
 * 本测试钉住：
 *   1. occt 上 chamfer equal 仍走历史路径（结果 slot 带 faceEvolution），几何正确；
 *   2. brepkit（三版本）上 chamfer equal 返回有效几何（bbox≈10、体积略小于 1000），
 *      且结果 slot **不带** faceEvolution（降级路径，不伪造演化）；
 *   3. brepkit（三版本）上 convexHull 对点集返回有效实体（四面体体积≈166.7、bbox≈10）；
 *   4. occt 上 convexHull 不回退（同样产出有效实体）。
 *
 * Run: npx vitest run src/brep/engine/brepkit-batchB-fix.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import { __resetEngineRegistriesForTests, getBrepEngine } from '../../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../../src/brep/engine/adapters/occt'
import { analyzeCode } from '../../../src/lang/statement-summary'
import { CadRuntime } from '../../../src/cad-runtime/runtime'
import { createApiNamespaceWithEditorOps, registerEditorExtensions } from '../../support/editor-ops'
import { brepOf, getSlot } from '../../../src/shape'
import type { Shape } from '../../../src/mesh/types'
import {
  loadBrepkitVersion,
  resetToDefaultBrepkit,
  type BrepkitTestVersion,
} from '../../../src/brepkit-kernel/multi-version-test'
import { disposeBrepkit } from '../../../src/brepkit-kernel/brepkitKernel'

const require = createRequire(import.meta.url)
let brepkitAvailable = false
try {
  require.resolve('brepkit-wasm')
  brepkitAvailable = true
} catch {
  brepkitAvailable = false
}

// 10×10×10 盒，倒角第 1 条边（equal, width=1）。倒角切掉一条棱的楔形：
// 横截面积 1·1/2 = 0.5，棱长长 10 → 切去 ≈ 5 体积 ⇒ volume ≈ 995；整体 bbox 不变 ≈10。
const CHAMFER_CODE =
  'const box = cad.box(10, 10, 10)\n' +
  'const c = await cad.chamfer(box, { edges: [cad.edgeRef(box, 1)], type: \'equal\', width: 1 })\n'

// 四面体 4 顶点（沿坐标轴），凸包 = 四面体，体积 = 10³/6 ≈ 166.67，bbox = 10×10×10。
const HULL_CODE =
  'const h = await cad.convexHull([[0,0,0],[10,0,0],[0,10,0],[0,0,10]])\n'

interface Measured {
  volume: number
  bbox: [number, number, number]
  hasFaceEvolution: boolean
}

/** 跑一条 .fai.js 脚本，取最后赋值 Shape，返回 volume / bbox 尺寸 / 是否带面演化。 */
async function runMeasure(code: string): Promise<Measured> {
  const rt = new CadRuntime({ events: { emit() {} } }, 'brep', { cad: createApiNamespaceWithEditorOps() })
  const result = await rt.execute(code)
  if (result.failedAt) {
    throw new Error(`script failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const varName = (() => {
    const stmts = analyzeCode(code).filter((s) => s.hasAssignment)
    return stmts[stmts.length - 1]?.outputs?.[0]
  })()
  const shape = result.outputs.get(varName as never) as Shape | undefined
  if (!shape) throw new Error(`output "${String(varName)}" not found`)
  const handle = brepOf(shape)
  if (handle === undefined) throw new Error('result has no brep handle')
  const engine = (await getBrepEngine()).primitives
  const volume = engine.getVolume(handle as never)
  const bb = engine.getBoundingBox(handle as never)
  return {
    volume,
    bbox: [bb.xmax - bb.xmin, bb.ymax - bb.ymin, bb.zmax - bb.zmin],
    hasFaceEvolution: getSlot(shape)?.faceEvolution !== undefined,
  }
}

describe('brepkit B 批降级：chamfer（裸路径）+ convexHull（能力路由）', () => {
  beforeAll(() => {
    registerEditorExtensions()
  }, 30000)

  afterAll(async () => {
    disposeBrepkit()
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
  }, 30000)

  // ── occt 基线：chamfer equal 历史路径（带面演化），convexHull 正常 ──
  describe('occt 引擎（不回退）', () => {
    beforeAll(async () => {
      __resetEngineRegistriesForTests()
      await registerOcctBrepEngine()
    }, 120000)

    it('chamfer equal：bbox≈10、体积≈995（与 occt 逐位一致），且带面演化（历史路径生效）', async () => {
      const r = await runMeasure(CHAMFER_CODE)
      for (const dim of r.bbox) expect(Math.abs(dim - 10)).toBeLessThan(0.5)
      // 切去一条棱楔形 = 1·1/2·10 = 5 ⇒ 体积恰为 995（occt 实测 994.9999…）。
      expect(r.volume).toBeGreaterThan(994)
      expect(r.volume).toBeLessThan(996)
      // occt 走 chamferWithHistory → slot 必须带面演化（历史路径生效，未降级）
      expect(r.hasFaceEvolution).toBe(true)
    }, 60000)

    it('convexHull：四面体体积≈166.67、bbox≈10', async () => {
      const r = await runMeasure(HULL_CODE)
      for (const dim of r.bbox) expect(Math.abs(dim - 10)).toBeLessThan(0.5)
      // 四面体体积 = 10³/6 = 166.6667（两引擎实测逐位一致）。
      expect(r.volume).toBeGreaterThan(165)
      expect(r.volume).toBeLessThan(168)
    }, 60000)
  })

  // ── brepkit：三版本 chamfer 裸路径降级（几何正确、无面演化）+ convexHull 能力路由 ──
  const suite = brepkitAvailable ? describe : describe.skipIf(!brepkitAvailable)
  const VERSIONS: BrepkitTestVersion[] = ['2.129.15', '3.4.18', '4.0.32']

  for (const version of VERSIONS) {
    suite(`brepkit ${version}`, () => {
      beforeAll(async () => {
        __resetEngineRegistriesForTests()
        await loadBrepkitVersion(version)
      }, 120000)

      it('chamfer equal：返回有效几何 bbox≈10、体积≈995（与 occt parity），且不带面演化（降级）', async () => {
        const r = await runMeasure(CHAMFER_CODE)
        for (const dim of r.bbox) expect(Math.abs(dim - 10)).toBeLessThan(0.5)
        expect(r.volume).toBeGreaterThan(994)
        expect(r.volume).toBeLessThan(996)
        // brepkit 走裸 kernel.chamfer → slot 不带面演化（如实降级，不伪造演化数据）
        expect(r.hasFaceEvolution).toBe(false)
      }, 60000)

      it('convexHull：对点集返回有效四面体实体 bbox≈10、体积≈166.67', async () => {
        const r = await runMeasure(HULL_CODE)
        for (const dim of r.bbox) expect(Math.abs(dim - 10)).toBeLessThan(0.5)
        expect(r.volume).toBeGreaterThan(165)
        expect(r.volume).toBeLessThan(168)
      }, 60000)
    })
  }

  afterAll(async () => {
    await resetToDefaultBrepkit()
  }, 60000)
})
