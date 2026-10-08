/**
 * @vitest-environment node
 *
 * brepkit-intersect-fix — 回归测试：intersect op 在 brepkit 引擎上可用（优雅降级）
 *
 * 背景：intersect 曾声明 `capabilities: ['intersectWithHistory']`，而 brepkit 适配器
 * 未把 intersectWithHistory 列入原生面，导致 brepkit brep 模式执行前静态报
 * `lacks capability 'intersectWithHistory'`。
 *
 * 修复（方向 A）：intersect 改为中立 op（不声明任何收窄轴）；booleanBrep 按
 * `hasNativeHistory('intersectWithHistory')`（引擎身份事实，见
 * `brep/engine/native-history.ts`）静态分派——
 *   - occt（原生有）→ booleanWithRoleTable 历史路径，产出面演化 + roleTable；
 *   - brepkit（原生没有）→ L1 裸 kernel.intersect，几何正确但无面演化（如实降级，
 *     不伪造恒等映射）。
 *
 * 本测试钉住：
 *   1. brepkit（三版本）上 intersect 返回有效几何：两个重叠盒交集 bbox≈[10,20,20]、volume≈4000；
 *   2. occt 上 intersect 不回退：结果 slot 带 faceEvolution（历史路径生效）；
 *   3. brepkit 上 intersect 结果 slot **不带** faceEvolution（降级路径，不伪造演化数据）。
 *
 * Run: npx vitest run src/brep/engine/brepkit-intersect-fix.test.ts
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

// 两个 20×20×20 盒：a 居中于原点，b 沿 x 平移 10。交集 = x 宽 10、y/z 宽 20 →
// bbox [10,20,20]，volume = 10·20·20 = 4000。
const INTERSECT_CODE =
  'const a = cad.box(20, 20, 20, { centered: true })\n' +
  'const b = cad.box(20, 20, 20, { centered: true, at: [10, 0, 0] })\n' +
  'const p = await cad.intersect(a, b)'

interface Measured {
  volume: number
  bbox: [number, number, number]
  hasFaceEvolution: boolean
}

/** 跑一条 .fai.js 脚本，返回最终实体的 volume / bbox 尺寸 / 是否带面演化。 */
async function runMeasure(): Promise<Measured> {
  const rt = new CadRuntime({ events: { emit() {} } }, 'brep', { cad: createApiNamespaceWithEditorOps() })
  const result = await rt.execute(INTERSECT_CODE)
  if (result.failedAt) {
    throw new Error(`script failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const varName = (() => {
    const stmts = analyzeCode(INTERSECT_CODE).filter((s) => s.hasAssignment)
    return stmts[stmts.length - 1]?.outputs?.[0]
  })()
  const shape = result.outputs.get(varName as never) as Shape | undefined
  if (!shape) throw new Error(`output "${varName}" not found`)
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

describe('brepkit intersect fix（裸 intersect 降级 + occt 历史路径不回退）', () => {
  beforeAll(() => {
    registerEditorExtensions()
  }, 30000)

  afterAll(async () => {
    disposeBrepkit()
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
  }, 30000)

  // ── occt 基线：历史路径（带面演化），几何正确 ──
  describe('occt 引擎（不回退）', () => {
    beforeAll(async () => {
      __resetEngineRegistriesForTests()
      await registerOcctBrepEngine()
    }, 120000)

    it('intersect：两个重叠盒交集 bbox≈[10,20,20]、volume≈4000，且带面演化', async () => {
      const r = await runMeasure()
      expect(Math.abs(r.bbox[0] - 10)).toBeLessThan(0.5)
      expect(Math.abs(r.bbox[1] - 20)).toBeLessThan(0.5)
      expect(Math.abs(r.bbox[2] - 20)).toBeLessThan(0.5)
      expect(r.volume).toBeGreaterThan(3800)
      expect(r.volume).toBeLessThan(4200)
      // occt 走 intersectWithHistory → slot 必须带面演化（历史路径生效，未降级）
      expect(r.hasFaceEvolution).toBe(true)
    }, 60000)
  })

  // ── brepkit：三版本裸 intersect 降级，几何正确、无面演化 ──
  const suite = brepkitAvailable ? describe : describe.skipIf(!brepkitAvailable)
  const VERSIONS: BrepkitTestVersion[] = ['2.129.15', '3.4.18', '4.0.32']

  for (const version of VERSIONS) {
    suite(`brepkit ${version}`, () => {
      beforeAll(async () => {
        __resetEngineRegistriesForTests()
        await loadBrepkitVersion(version)
      }, 120000)

      it('intersect：返回有效交集几何 bbox≈[10,20,20]、volume≈4000，且不带面演化（降级）', async () => {
        const r = await runMeasure()
        expect(Math.abs(r.bbox[0] - 10)).toBeLessThan(0.5)
        expect(Math.abs(r.bbox[1] - 20)).toBeLessThan(0.5)
        expect(Math.abs(r.bbox[2] - 20)).toBeLessThan(0.5)
        expect(r.volume).toBeGreaterThan(3800)
        expect(r.volume).toBeLessThan(4200)
        // brepkit 走裸 kernel.intersect → slot 不带面演化（如实降级，不伪造演化数据）
        expect(r.hasFaceEvolution).toBe(false)
      }, 60000)
    })
  }

  afterAll(async () => {
    await resetToDefaultBrepkit()
  }, 60000)
})
