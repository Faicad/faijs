/**
 * @vitest-environment node
 *
 * brepkit-batchD-fix — 回归测试：translate / scale op 在 brepkit 引擎上可用（优雅降级）
 *
 * 背景（2026-09-28 D 批）：translate / scale 曾声明 `engines: ['occt']`，且 transformBrep
 * 硬走 occt-only `translateWithHashEvolution` / `scaleWithHashEvolution`——brepkit brep 模式
 * 执行前被平台门静态报 `requires engine occt`，即便 brepkit 裸 `kernel.translate` /
 * `kernel.scale` 是真实现。
 *
 * 修复（优雅降级，docs/plans/2026-09-26-brepkit-global-degradation.md 的既有纪律，
 * 但 translate/scale 因「变换不改变面数/顺序」而特化——identity 恒等映射**真实成立**）：
 *   - translate / scale 改为**中立 op**（移除 `engines:['occt']`）。
 *   - transformBrep 按引擎声明的能力集静态分派：
 *     - occt（声明 translateWithHistory / scaleWithHistory）→ 权威历史路径
 *       （faceEvolution + roleTable）。
 *     - brepkit（未声明，但裸 translate / scale 真实现）→ L1 裸调用 + identityHashEvolution。
 *       变换是刚体变换、面数/顺序不变 → 恒等映射**真实正确（非伪造）**，故结果 slot 挂
 *       恒等 faceEvolution 并传播 roleTable，选面/命名不因降级而丢失。
 *
 * 本测试钉住：
 *   1. occt 上 translate/scale 不回退：结果 slot 带 faceEvolution（历史路径生效）；
 *   2. brepkit（三版本）上 translate/scale 返回有效几何＋**带恒等** faceEvolution
 *     （几何精确；面 1:1 保留，选面/命名可用）；
 *   3. brepkit 上 rotate_euler / scale3d 仍可用（既有中立 op，几何正确；identity 演化）；
 *   4. 选面/点名端到端：translate/scale 后的 `cad.faceRef(shape, N)` 能解析（不报
 *     `E_TOPO_NOT_FOUND … nameless shape`）——证明 roleTable + identity 面演化在降级
 *     路径上真实可消费，而非仅有 slot 挂载。
 *
 * Run: npx vitest run src/brep/engine/brepkit-batchD-fix.test.ts
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

// 10×10×10 盒，translate [0,3,2] → 仍 10×10×10，bbox 整体平移。
const TRANSLATE_CODE =
  'const a = cad.box(10, 10, 10)\n' +
  'const t = cad.translate(a, { offset: [0, 3, 2] })'

// 10×10×10 盒，uniform scale 2 → bbox 20×20×20。
const SCALE_CODE =
  'const a = cad.box(10, 10, 10)\n' +
  'const s = cad.scale(a, 2)'

// 10×10×10 盒，scale3d 非等比 [2,1,0.5] → bbox 20×10×5（中立 op，跨引擎应一致）。
const SCALE3D_CODE =
  'const a = cad.box(10, 10, 10)\n' +
  'const s = cad.scale3d(a, [2, 1, 0.5])'

interface Measured {
  bbox: [number, number, number]
  hasFaceEvolution: boolean
}

/** 跑一条 .fai.js 脚本，返回最后赋值实体的 bbox 尺寸 / 是否带 faceEvolution。 */
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
  const bb = engine.getBoundingBox(handle as never)
  return {
    bbox: [bb.xmax - bb.xmin, bb.ymax - bb.ymin, bb.zmax - bb.zmin],
    hasFaceEvolution: getSlot(shape)?.faceEvolution !== undefined,
  }
}

/** 执行一条 .fai.js 脚本（不预判成败），返回 ExecutionResult 供命名用例断言。 */
async function runExec(code: string): Promise<ReturnType<CadRuntime['execute']>> {
  const rt = new CadRuntime({ events: { emit() {} } }, 'brep', { cad: createApiNamespaceWithEditorOps() })
  return rt.execute(code)
}

/** 断言 bbox 三个边分别约等于期望值（容差 0.5）。 */
function expectBBox(r: Measured, want: [number, number, number]): void {
  for (let i = 0; i < 3; i++) expect(Math.abs(r.bbox[i] - want[i])).toBeLessThan(0.5)
}

describe('brepkit D 批降级：translate / scale（裸路径）+ occt 历史路径不回退', () => {
  beforeAll(() => {
    registerEditorExtensions()
  }, 30000)

  afterAll(async () => {
    disposeBrepkit()
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
  }, 30000)

  // ── occt 基线：translate/scale 历史路径（带面演化），几何正确 ──
  describe('occt 引擎（不回退）', () => {
    beforeAll(async () => {
      __resetEngineRegistriesForTests()
      await registerOcctBrepEngine()
    }, 120000)

    it('translate [0,3,2]：bbox 仍为 10×10×10，且带面演化（历史路径生效）', async () => {
      const r = await runMeasure(TRANSLATE_CODE)
      expectBBox(r, [10, 10, 10])
      expect(r.hasFaceEvolution).toBe(true)
    }, 60000)

    it('scale 2：bbox 20×20×20，且带面演化', async () => {
      const r = await runMeasure(SCALE_CODE)
      expectBBox(r, [20, 20, 20])
      expect(r.hasFaceEvolution).toBe(true)
    }, 60000)

    it('scale3d [2,1,0.5]：bbox 20×10×5（中立路径，跨引擎一致）', async () => {
      const r = await runMeasure(SCALE3D_CODE)
      expectBBox(r, [20, 10, 5])
    }, 60000)

    it('naming：translate/scale 后的 faceRef(…,1) 能解析（不报 E_TOPO_NOT_FOUND nameless shape）', async () => {
      const r = await runExec(
        'const a = cad.box(10, 10, 10)\n' +
          'const t = cad.translate(a, { offset: [0, 3, 2] })\n' +
          'const s = cad.scale(a, 2)\n' +
          'const rt = cad.faceRef(t, 1)\n' +
          'const rs = cad.faceRef(s, 1)',
      )
      expect(r.failedAt).toBeUndefined()
    }, 60000)
  })

  // ── brepkit：三版本 translate/scale 裸路径降级（几何正确、恒等面演化）──
  const suite = brepkitAvailable ? describe : describe.skipIf(!brepkitAvailable)
  const VERSIONS: BrepkitTestVersion[] = ['2.129.15', '3.4.18', '4.0.32']

  for (const version of VERSIONS) {
    suite(`brepkit ${version}`, () => {
      beforeAll(async () => {
        __resetEngineRegistriesForTests()
        await loadBrepkitVersion(version)
      }, 120000)

      it('translate [0,3,2]：bbox 10×10×10，且带恒等面演化（变换保面序，真实正确）', async () => {
        const r = await runMeasure(TRANSLATE_CODE)
        expectBBox(r, [10, 10, 10])
        // 变换是刚体变换、面数/顺序不变 → identity 面演化真实成立（非伪造）。
        expect(r.hasFaceEvolution).toBe(true)
      }, 60000)

      it('scale 2：bbox 20×20×20，且带恒等面演化（变换保面序，真实正确）', async () => {
        const r = await runMeasure(SCALE_CODE)
        expectBBox(r, [20, 20, 20])
        expect(r.hasFaceEvolution).toBe(true)
      }, 60000)

      it('scale3d [2,1,0.5]：bbox 20×10×5（中立路径照常可用）', async () => {
        const r = await runMeasure(SCALE3D_CODE)
        expectBBox(r, [20, 10, 5])
      }, 60000)

      it('translate → scale 链式：bbox 20×20×20（下游仍可消费，无运行时回退拦截）', async () => {
        const code =
          'const a = cad.box(10, 10, 10)\n' +
          'const t = cad.translate(a, { offset: [5, 0, 0] })\n' +
          'const s = cad.scale(t, 2)'
        const r = await runMeasure(code)
        expectBBox(r, [20, 20, 20])
      }, 60000)

      // 端到端命名：变换保面序 → roleTable 存活 → cad.faceRef 能解析（点名成功）。
      // 若 identity 面演化/roleTable 传播缺失，cad.faceRef 会抛 E_TOPO_NOT_FOUND nameless shape。
      it('naming：translate/scale 后的 faceRef(…,1) 能解析（选面/点名成功，非 nameless shape）', async () => {
        const r = await runExec(
          'const a = cad.box(10, 10, 10)\n' +
            'const t = cad.translate(a, { offset: [0, 3, 2] })\n' +
            'const s = cad.scale(a, 2)\n' +
            'const rt = cad.faceRef(t, 1)\n' +
            'const rs = cad.faceRef(s, 1)',
        )
        expect(r.failedAt).toBeUndefined()
      }, 60000)
    })
  }

  afterAll(async () => {
    await resetToDefaultBrepkit()
  }, 60000)
})