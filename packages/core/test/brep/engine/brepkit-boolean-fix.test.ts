/**
 * brepkit-boolean-fix — 回归测试：brepkit 引擎上 union/cut/subtract 不再崩
 *
 * 背景：mapEvolution 曾把 modified 返回为扁平 hash 列表，而下游 decodeEvolution /
 * decodeHashEvolution 期望 OCCT 分段格式 [inHash, count, outHash1, ...]。
 * 扁平列表被当成分段解析时，modified[1]（一个 ~1e9 的 face hash）被误读为 count，
 * 导致空转十几亿次 push 抛 "Invalid array length"（见 brepkitKernel.ts mapEvolution GOTCHA 注释）。
 *
 * 本测试钉住：
 *   1. brepkit 引擎上 union/cut/subtract 各执行一次，返回有效实体（volume>0、bbox 合理）；
 *   2. occt 引擎上同脚本不回退；
 *   3. fuseWithHistory 返回的 evolution.modified 是合法分段格式（解码不抛异常、段数>0）。
 *
 * Run: npx vitest run src/brep/engine/brepkit-boolean-fix.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import { __resetEngineRegistriesForTests, getBrepEngine } from '../../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../../src/brep/engine/adapters/occt'
import { registerBrepkitBrepEngine } from '../../../src/brep/engine/adapters/brepkit'
import { analyzeCode } from '../../../src/lang/statement-summary'
import { CadRuntime } from '../../../src/cad-runtime/runtime'
import { createApiNamespaceWithEditorOps, registerEditorExtensions } from '../../support/editor-ops'
import { brepOf } from '../../../src/shape'
import type { Shape } from '../../../src/mesh/types'
import type { BrepHandle } from '../../../src/brep/engine/types'
import { decodeHashEvolution, HASH_UPPER_BOUND } from '../../../src/brep/face-evolution'
import { disposeBrepkit } from '../../../src/brepkit-kernel/brepkitKernel'

const require = createRequire(import.meta.url)
let brepkitAvailable = false
try { require.resolve('brepkit-wasm'); brepkitAvailable = true } catch { brepkitAvailable = false }

/** 跑一条 .fai.js 脚本，返回最终实体的 volume 与 bbox 尺寸。 */
async function runMeasure(code: string, outputVar?: string): Promise<{ volume: number; bbox: [number, number, number] }> {
  const rt = new CadRuntime({ events: { emit() {} } }, 'brep', { cad: createApiNamespaceWithEditorOps() })
  const result = await rt.execute(code)
  if (result.failedAt) {
    throw new Error(`script failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const varName = outputVar ?? (() => {
    const stmts = analyzeCode(code).filter((s) => s.hasAssignment)
    return stmts[stmts.length - 1]?.outputs?.[0]
  })()
  const shape = result.outputs.get(varName as never) as Shape | undefined
  if (!shape) throw new Error(`output "${varName}" not found`)
  const handle = brepOf(shape)
  if (handle === undefined) throw new Error('result has no brep handle')
  const engine = (await getBrepEngine()).primitives
  const volume = engine.getVolume(handle as never)
  const bb = engine.getBoundingBox(handle as never)
  return { volume, bbox: [bb.xmax - bb.xmin, bb.ymax - bb.ymin, bb.zmax - bb.zmin] }
}

const UNION_CODE =
  'const a = cad.box(20, 20, 20, { centered: true })\n' +
  'const b = cad.box(20, 20, 20, { centered: true, at: [10, 0, 0] })\n' +
  'const p = await cad.union(a, b)'

const CUT_CODE =
  'const a = cad.box(20, 20, 20, { centered: true })\n' +
  'const b = cad.cylinder(5, 30, { centered: true })\n' +
  'const p = await cad.cut(a, b)'

const SUBTRACT_CODE =
  'const a = cad.box(20, 20, 20, { centered: true })\n' +
  'const b = cad.cylinder(5, 30, { centered: true })\n' +
  'const p = await cad.subtract(a, b)'

describe('brepkit boolean fix（union/cut/subtract 不崩 + occt 不回退）', () => {
  beforeAll(() => { registerEditorExtensions() }, 30000)

  afterAll(async () => {
    disposeBrepkit()
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
  }, 30000)

  const suite = brepkitAvailable ? describe : describe.skipIf(!brepkitAvailable)

  suite('brepkit 引擎', () => {
    beforeAll(async () => {
      __resetEngineRegistriesForTests()
      await registerBrepkitBrepEngine()
    }, 120000)

    it('union：两个错位盒合并，volume≈12000、bbox≈[30,20,20]', async () => {
      const r = await runMeasure(UNION_CODE)
      expect(r.volume).toBeGreaterThan(11000)
      expect(r.volume).toBeLessThan(13000)
      expect(Math.abs(r.bbox[0] - 30)).toBeLessThan(0.5)
      expect(Math.abs(r.bbox[1] - 20)).toBeLessThan(0.5)
      expect(Math.abs(r.bbox[2] - 20)).toBeLessThan(0.5)
    }, 60000)

    it('cut：盒减贯穿圆柱，volume≈8000-π·25·20≈6430、bbox≈[20,20,20]', async () => {
      const r = await runMeasure(CUT_CODE)
      // 20³ 盒 = 8000；贯穿圆柱（r=5 h=30）切掉 ≈ π·25·20 ≈ 1571
      expect(r.volume).toBeGreaterThan(6000)
      expect(r.volume).toBeLessThan(7000)
      expect(Math.abs(r.bbox[0] - 20)).toBeLessThan(0.5)
      expect(Math.abs(r.bbox[1] - 20)).toBeLessThan(0.5)
      expect(Math.abs(r.bbox[2] - 20)).toBeLessThan(0.5)
    }, 60000)

    it('subtract：与 cut 同语义（盒减圆柱），volume 合理', async () => {
      const r = await runMeasure(SUBTRACT_CODE)
      expect(r.volume).toBeGreaterThan(6000)
      expect(r.volume).toBeLessThan(7000)
    }, 60000)

    it('fuseWithHistory 返回的 evolution.modified 是合法分段格式（decodeHashEvolution 不抛）', async () => {
      const rt = new CadRuntime({ events: { emit() {} } }, 'brep', { cad: createApiNamespaceWithEditorOps() })
      const code =
        'const a = cad.box(20, 20, 20, { centered: true })\n' +
        'const b = cad.box(20, 20, 20, { centered: true, at: [10, 0, 0] })\n' +
        'const p = await cad.union(a, b)'
      const result = await rt.execute(code)
      expect(result.failedAt).toBeUndefined()
      // 直接再走一次适配器级 fuseWithHistory，断言 modified 分段解码正常
      const engine = (await getBrepEngine()).primitives
      const aHandle = brepOf(result.outputs.get('a' as never) as Shape) as unknown as BrepHandle
      const bHandle = brepOf(result.outputs.get('b' as never) as Shape) as unknown as BrepHandle
      const aHashes = Array.from(engine.subShapeHashes(aHandle, 'face', HASH_UPPER_BOUND))
      const bHashes = Array.from(engine.subShapeHashes(bHandle, 'face', HASH_UPPER_BOUND))
      const evo = engine.fuseWithHistory(aHandle, bHandle, [...new Set([...aHashes, ...bHashes])], HASH_UPPER_BOUND)
      // GOTCHA 钉死：modified 必须是分段格式，decodeHashEvolution 不能抛 "Invalid array length"
      const decoded = decodeHashEvolution(evo)
      expect(decoded.modified.size).toBeGreaterThan(0)
      for (const [, outs] of decoded.modified) {
        expect(outs.length).toBeGreaterThanOrEqual(1)
      }
    }, 60000)
  })

  describe('occt 引擎（不回退）', () => {
    beforeAll(async () => {
      __resetEngineRegistriesForTests()
      await registerOcctBrepEngine()
    }, 120000)

    it('union/cut/subtract 在 occt 上仍返回有效几何', async () => {
      const u = await runMeasure(UNION_CODE)
      expect(u.volume).toBeGreaterThan(11000)
      expect(Math.abs(u.bbox[0] - 30)).toBeLessThan(0.5)
      const c = await runMeasure(CUT_CODE)
      expect(c.volume).toBeGreaterThan(6000)
      const s = await runMeasure(SUBTRACT_CODE)
      expect(s.volume).toBeGreaterThan(6000)
    }, 60000)
  })
})
