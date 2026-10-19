/**
 * brepkit-fuse-op — 回归：脚本面 `fuse` op 不再被 engines:['occt'] 门禁挡在 brepkit 外
 *
 * 背景：faijs sheetmetal 折弯建模（authorPart/fold）每法兰经
 * `import { fuse } from '@faicad/faijs/api'` 调 L1 裸 fuse；arg-spec 曾以
 * "依赖 kernel.isNull / kernel.dispose（occt 平台面）" 为由声明 engines:['occt']，
 * 2026-10-17 实证当前 fuseBrep（booleanFns.ts）仅经 getBrepApi().fuse，引擎无关，
 * 且 brepkit 内核 L1 有 fuse → 移除门禁（arg-spec.ts）。
 *
 * 本测试钉住：
 *   1. brepkit 引擎上 cad.fuse 实跑：两个错位 10³ 盒并集 volume≈1875、bbox≈[15,15,15]
 *      （几何真值，不是"没报错"）；
 *   2. occt 引擎上同一脚本不回退（同一体积判据）。
 *
 * Run: npx vitest run src/brep/engine/brepkit-fuse-op.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import { getActiveBrepEngine, __resetEngineRegistriesForTests } from '../../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../../src/brep/engine/adapters/occt'
import { registerBrepkitBrepEngine } from '../../../src/brep/engine/adapters/brepkit'
import { extractMetadata } from '../../../src/lang/metadata-extractor'

/** `analyzeCode` 已迁至宿主层；旧实现即 extractMetadata(code).lines。 */
const analyzeCode = (code: string) => extractMetadata(code).lines
import { CadRuntime } from '../../../src/cad-runtime/runtime'
import { createApiNamespaceWithEditorOps, registerEditorExtensions } from '../../support/editor-ops'
import { brepOf } from '../../../src/shape'
import type { Shape } from '../../../src/mesh/types'
import { disposeBrepkit } from '../../../src/brepkit-kernel/brepkitKernel'

const require = createRequire(import.meta.url)
let brepkitAvailable = false
try { require.resolve('brepkit-wasm'); brepkitAvailable = true } catch { brepkitAvailable = false }

/** 跑一条 .fai.js 脚本，返回最终实体的 volume 与 bbox 尺寸。 */
async function runMeasure(code: string): Promise<{ volume: number; bbox: [number, number, number] }> {
  const rt = new CadRuntime({ events: { emit() {} } }, 'brep', { cad: createApiNamespaceWithEditorOps() })
  const result = await rt.execute(code)
  if (result.failedAt) {
    throw new Error(`script failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const stmts = analyzeCode(code).filter((s) => s.hasAssignment)
  const varName = stmts[stmts.length - 1]?.outputs?.[0]
  const shape = result.outputs.get(varName as never) as Shape | undefined
  if (!shape) throw new Error(`output "${varName}" not found`)
  const handle = brepOf(shape)
  if (handle === undefined) throw new Error('result has no brep handle')
  const engine = (await getActiveBrepEngine()).primitives
  const volume = engine.getVolume(handle as never)
  const bb = engine.getBoundingBox(handle as never)
  return { volume, bbox: [bb.xmax - bb.xmin, bb.ymax - bb.ymin, bb.zmax - bb.zmin] }
}

// 两个 10³ 盒，第二个居中于 (5,5,5)：重叠 [0,5]³=125 → 并集 2000−125=1875，bbox [15,15,15]。
const FUSE_CODE =
  'const a = cad.box(10, 10, 10, { centered: true })\n' +
  'const b = cad.box(10, 10, 10, { centered: true, at: [5, 5, 5] })\n' +
  'const p = cad.fuse(a, b)'

describe('脚本面 fuse op：brepkit 门禁放开（几何真值判据）', () => {
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

    it('cad.fuse 实跑：并集体积≈1875、bbox≈[15,15,15]（不再 E_MESH_UNSUPPORTED）', async () => {
      const r = await runMeasure(FUSE_CODE)
      expect(r.volume).toBeGreaterThan(1750)
      expect(r.volume).toBeLessThan(2000)
      for (const axis of [0, 1, 2]) {
        expect(Math.abs(r.bbox[axis] - 15)).toBeLessThan(0.5)
      }
    }, 60000)
  })

  describe('occt 引擎（不回退）', () => {
    beforeAll(async () => {
      __resetEngineRegistriesForTests()
      await registerOcctBrepEngine()
    }, 120000)

    it('同一脚本：并集体积≈1875、bbox≈[15,15,15]', async () => {
      const r = await runMeasure(FUSE_CODE)
      expect(r.volume).toBeGreaterThan(1750)
      expect(r.volume).toBeLessThan(2000)
      for (const axis of [0, 1, 2]) {
        expect(Math.abs(r.bbox[axis] - 15)).toBeLessThan(0.5)
      }
    }, 60000)
  })
})
