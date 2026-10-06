/**
 * @vitest-environment node
 *
 * brepkit-batchC-fix — section / split / drill / pocket / boss / mirrorJoin
 * 在 brepkit 引擎上的降级回归（Batch C）。
 *
 * 背景（2026-09-26）：
 *   上一轮已把 clone / intersect 降级到 brepkit。本批处理语义受限与复合类 op。
 *
 * 审计结论与降级动作：
 *   - section     : engines:[occt] → capabilities:["sectionByPlane","makeCompound"]。
 *                   sectionBrep 移除 getOcctKernel().IsNull 平台耦合。
 *                   语义差异：occt sectionByPlane 返回 edge/wire 组（1D 剖面线）；
 *                   brepkit 返回 face 组（2D 剖面面）。两侧都包 compound，bbox 一致。
 *   - drill       : engines:[occt] → capabilities:["makeCylinder","located","getBoundingBox","cut"]。
 *                   drill = makeCylinder + located + cut，brepkit 全链路已实现。
 *   - pocket      : engines:[occt] → capabilities:["getSubShapes","surfaceCenterOfMass","uvBounds",
 *                   "surfaceNormal","makeFace","translate","extrude","cut"]。
 *                   pocket = 选面 + profile→face + translate + extrude(-normal) + cut。
 *   - boss        : 同 pocket，但 extrude(+normal) + fuse。
 *   - mirrorJoin  : engines:[occt] → capabilities:["mirror","fuse"]。
 *                   mirrorJoin = mirror + fuse。
 *   - split       : 不可降级，保持 engines:["occt"]。splitBrep 直调 getOcctKernel().split
 *                   原生切件（任意 tool 形状分件），brepkit L1 只有 splitByPlane
 *                   （单平面→2 实体），无法处理任意 tool。brepkit 上静态报 requires engine occt。
 *
 * 本测试钉住：
 *   (a) 可降级 5 个 op 在 brepkit 三版本上几何有效（不报错，bbox/volume 合理）；
 *   (b) occt 上这些 op 不回退（几何正确）；
 *   (c) split 在 brepkit 上诚实报 requires engine occt（不崩溃、不伪造结果）。
 *
 * Run: npx vitest run src/brep/engine/brepkit-batchC-fix.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { __resetEngineRegistriesForTests, getBrepEngine } from '../../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../../src/brep/engine/adapters/occt'
import { CadRuntime } from '../../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../../src/cad-runtime/runtime'
import { createApiNamespaceWithEditorOps, registerEditorExtensions } from '../../support/editor-ops'
import { brepOf } from '../../../src/shape'
import type { Shape } from '../../../src/mesh/types'
import {
  loadBrepkitVersion,
  resetToDefaultBrepkit,
  type BrepkitTestVersion,
} from '../../../src/brepkit-kernel/multi-version-test'
import { ensureTestFontLoader } from '@faicad/faijs/brep/text/fontTestHelper'

function makeRuntime(): CadRuntime {
  return new CadRuntime({ events: { emit() {} } }, 'brep', {
    cad: createApiNamespaceWithEditorOps(),
  })
}

interface EngineSlot {
  label: string
  brepkitVersion: BrepkitTestVersion | null
  setup: () => Promise<void>
}

const ENGINES: EngineSlot[] = [
  { label: 'occt', brepkitVersion: null, setup: async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
  } },
  { label: 'brepkit-2.129.15', brepkitVersion: '2.129.15', setup: () => loadBrepkitVersion('2.129.15') },
  { label: 'brepkit-3.4.18', brepkitVersion: '3.4.18', setup: () => loadBrepkitVersion('3.4.18') },
  { label: 'brepkit-4.0.32', brepkitVersion: '4.0.32', setup: () => loadBrepkitVersion('4.0.32') },
]

/** 跑一段脚本，返回失败信息（成功为 undefined）。 */
async function runCode(code: string): Promise<{ result: ExecutionResult; error?: string }> {
  const rt = makeRuntime()
  let result: ExecutionResult
  try {
    result = await rt.execute(code)
  } catch (e) {
    return { result: undefined as never, error: `thrown: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (result.failedAt) {
    return { result, error: `${result.failedAt.callee}: ${result.failedAt.message} [${result.failedAt.code ?? ''}]` }
  }
  return { result }
}

interface Measured { dx: number; dy: number; dz: number; volume: number }

/** 取某输出 Shape 的 bbox 尺寸 + volume（BREP 句柄直取）。 */
async function measure(result: ExecutionResult, varName: string): Promise<Measured> {
  const shape = result.outputs.get(varName as never) as Shape | undefined
  if (!shape) throw new Error(`output "${varName}" not found`)
  const handle = brepOf(shape) as number | undefined
  if (handle === undefined) throw new Error(`"${varName}" has no brep handle`)
  const engine = await getBrepEngine()
  const bb = engine.primitives.getBoundingBox(handle as never)
  let volume = 0
  try { volume = engine.primitives.getVolume(handle as never) } catch { /* face/compound 无体积 */ }
  return { dx: bb.xmax - bb.xmin, dy: bb.ymax - bb.ymin, dz: bb.zmax - bb.zmin, volume }
}

function close(a: number, b: number): boolean {
  const mag = Math.max(Math.abs(a), Math.abs(b))
  if (mag < 1e-6) return true
  if (mag < 0.01) return Math.abs(a - b) < 1e-3
  return Math.abs(a - b) <= 0.02 * mag
}

describe('brepkit-batchC-fix（section/drill/pocket/boss/mirrorJoin 降级 + split 诚实报错）', () => {
  beforeAll(() => {
    ensureTestFontLoader()
    registerEditorExtensions()
  }, 60000)

  afterAll(async () => {
    await resetToDefaultBrepkit()
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
  }, 60000)

  // ── section：居中 box 被 XY 平面切 → 20×10 剖面（brepkit=face 组，occt=edge/wire 组）──
  it(
    'section：所有引擎上成功，bbox≈[20,10,0]（语义差异：face vs edge/wire）',
    async () => {
      // NOTE: 生成 compat `section`(topology.ts#sectionBrep) 未挂进 cad 命名空间——用户面是
      // 手写中立 op `cad.sectionByPlane`（同一 L1 sectionByPlane+makeCompound 路径，本批已把
      // sectionBrep 的 engines:[occt] 改为 capabilities 并移除 getOcctKernel().IsNull 耦合）。
      // 这里通过 cad.sectionByPlane 验证 brepkit 的 L1 sectionByPlane+makeCompound 链路几何有效。
      const code = [
        'const b = cad.box(20, 10, 5, { centered: true })',
        'const s = await cad.sectionByPlane(b, { point: [0, 0, 0], normal: [0, 0, 1] })',
      ].join('\n')
      for (const engine of ENGINES) {
        await engine.setup()
        const { result, error } = await runCode(code)
        expect(error, `section on ${engine.label} should succeed, got: ${error}`).toBeUndefined()
        const sec = await measure(result, 's')
        // XY 剖面：x 跨 20，y 跨 10，z≈0（剖面面/线都在 z=0 平面上）。
        expect(close(sec.dx, 20), `[${engine.label}] section dx`).toBe(true)
        expect(close(sec.dy, 10), `[${engine.label}] section dy`).toBe(true)
        expect(Math.abs(sec.dz), `[${engine.label}] section dz≈0, got ${sec.dz}`).toBeLessThan(0.5)
      }
    },
    180000,
  )

  // ── drill：居中 30³ box 沿 Z 钻半径 3 通孔 → bbox 不变，体积略减 ──
  it(
    'drill：所有引擎上成功，bbox 仍 [30,30,30]，体积 < 27000（孔去掉一部分）',
    async () => {
      const code = [
        'const b = cad.box(30, 30, 30, { centered: true })',
        'const d = await cad.drill(b, { at: [0, 0], radius: 3 })',
      ].join('\n')
      for (const engine of ENGINES) {
        await engine.setup()
        const { result, error } = await runCode(code)
        expect(error, `drill on ${engine.label} should succeed, got: ${error}`).toBeUndefined()
        const drilled = await measure(result, 'd')
        expect(close(drilled.dx, 30), `[${engine.label}] drill dx`).toBe(true)
        expect(close(drilled.dy, 30), `[${engine.label}] drill dy`).toBe(true)
        expect(close(drilled.dz, 30), `[${engine.label}] drill dz`).toBe(true)
        // 原体积 27000；孔体积 π·r²·h ≈ 3.14·9·30 ≈ 848 → 剩余 ≈ 26150。
        expect(drilled.volume, `[${engine.label}] drilled volume < 27000`).toBeLessThan(27000)
        expect(drilled.volume, `[${engine.label}] drilled volume reasonable`).toBeGreaterThan(24000)
      }
    },
    180000,
  )

  // ── mirrorJoin：偏置 box 镜像 x=0 并合并 → 20×20×20，体积 8000 ──
  it(
    'mirrorJoin：所有引擎上成功，bbox≈[20,20,20]，volume≈8000',
    async () => {
      const code = [
        'const b = cad.box(10, 20, 20)',
        'const m = await cad.mirrorJoin(b, { normal: [1, 0, 0] })',
      ].join('\n')
      for (const engine of ENGINES) {
        await engine.setup()
        const { result, error } = await runCode(code)
        expect(error, `mirrorJoin on ${engine.label} should succeed, got: ${error}`).toBeUndefined()
        const mj = await measure(result, 'm')
        expect(close(mj.dx, 20), `[${engine.label}] mirrorJoin dx`).toBe(true)
        expect(close(mj.dy, 20), `[${engine.label}] mirrorJoin dy`).toBe(true)
        expect(close(mj.dz, 20), `[${engine.label}] mirrorJoin dz`).toBe(true)
        expect(mj.volume, `[${engine.label}] mirrorJoin volume≈8000`).toBeGreaterThan(7500)
        expect(mj.volume, `[${engine.label}] mirrorJoin volume≈8000`).toBeLessThan(8500)
      }
    },
    180000,
  )

  // ── pocket：20×20×10 box 顶面向内切 4×4×3 凹槽 → 体积略减 ──
  it(
    'pocket：所有引擎上成功，体积 < 原体积（凹槽切去一块）',
    async () => {
      const code = [
        'const b = cad.box(20, 20, 10, { centered: true })',
        'const w = cad.wire([[-2,-2,0],[2,-2,0],[2,2,0],[-2,2,0]], { closed: true })',
        'const p = await cad.pocket(b, { profile: w, depth: 3 })',
      ].join('\n')
      for (const engine of ENGINES) {
        await engine.setup()
        const { result, error } = await runCode(code)
        expect(error, `pocket on ${engine.label} should succeed, got: ${error}`).toBeUndefined()
        const pkg = await measure(result, 'p')
        // 原体积 20·20·10 = 4000；凹槽 ≈ 4·4·3 = 48 → 剩余 ≈ 3952。
        expect(pkg.volume, `[${engine.label}] pocket volume < 4000`).toBeLessThan(4000)
        expect(pkg.volume, `[${engine.label}] pocket volume reasonable`).toBeGreaterThan(3800)
      }
    },
    180000,
  )

  // ── boss：20×20×10 box 顶面外焊 4×4×3 凸台 → 体积略增 ──
  it(
    'boss：所有引擎上成功，体积 > 原体积（凸台加一块）',
    async () => {
      const code = [
        'const b = cad.box(20, 20, 10, { centered: true })',
        'const w = cad.wire([[-2,-2,0],[2,-2,0],[2,2,0],[-2,2,0]], { closed: true })',
        'const bos = await cad.boss(b, { profile: w, height: 3 })',
      ].join('\n')
      for (const engine of ENGINES) {
        await engine.setup()
        const { result, error } = await runCode(code)
        expect(error, `boss on ${engine.label} should succeed, got: ${error}`).toBeUndefined()
        const bos = await measure(result, 'bos')
        // 原体积 4000；凸台 ≈ 4·4·3 = 48 → 合并后 ≈ 4048。
        expect(bos.volume, `[${engine.label}] boss volume > 4000`).toBeGreaterThan(4000)
        expect(bos.volume, `[${engine.label}] boss volume reasonable`).toBeLessThan(4200)
      }
    },
    180000,
  )

  // ── split：不可降级——brepkit 上静态报 requires engine occt（诚实报错）──
  it(
    'split：brepkit 三版本上静态报 requires engine occt（不崩溃、不伪造）；occt 正常',
    async () => {
      const code = [
        'const b = cad.box(20, 20, 20, { centered: true })',
        'const t = cad.box(10, 10, 10, { centered: true })',
        'const s = await cad.split(b, [t])',
      ].join('\n')
      for (const engine of ENGINES) {
        await engine.setup()
        const { error } = await runCode(code)
        if (engine.label === 'occt') {
          expect(error, `split on occt should succeed, got: ${error}`).toBeUndefined()
        } else {
          expect(error, `split on ${engine.label} must fail honestly`).toBeDefined()
          expect(
            error,
            `[${engine.label}] should be E_BREP_UNSUPPORTED requires engine occt, got: ${error}`,
          ).toMatch(/requires engine occt|E_BREP_UNSUPPORTED/)
        }
      }
    },
    180000,
  )
})
