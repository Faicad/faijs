/**
 * @vitest-environment node
 *
 * brepkit-clone-fix — clone op 从 engines:[occt] 白名单降级为中立 op 后的回归。
 *
 * 背景：clone 原声明 `engines: ['occt']`，brepkit brep 模式执行前静态报
 * `requires engine occt`。cloneBrep 纯调 `kernel.copyShape`（brepkit 实现面 A 批已接线
 * copyShape，调 kernel.copySolid），无 occt 特有 API，故移除引擎白名单；2026-10-08
 * 能力声明轴删除后它是纯中立 op（无任何收窄声明）。
 *
 * 命名契约探针结论（2026-09-26）：
 *   - identity provenance = 按 **ordinal（面枚举序号）1:1** 映射（第 i 面→第 i 面），
 *     不是按 hash。跨节点回走用序号键演化（identityEvolution：o→[o]）。
 *   - 但 cloneBrep 返回裸 handle，经 defineOp.wrapBrepOne → fromHandle 时**不传播
 *     roleTable / faceEvolution**（手写 placeBrep 才显式 propagateAllOrigins）。
 *     ⇒ clone 产物在**两个引擎上都是无名的**，edgeRef(clone, n) 干净抛
 *     E_TOPO_NOT_FOUND(nameless shape)。这是引擎中立的既有降级行为，不是 brepkit 缺口。
 *
 * 本测试钉住三条不变量：
 *   (a) brepkit 三版本上 clone 返回有效几何，bbox/volume 与原 box 一致；
 *   (b) occt 上 clone 不回退（bbox/volume 仍正确）；
 *   (c) 降级语义：edgeRef(clone, n) 在所有引擎上都干净报 nameless shape（不崩溃、不
 *       静默选错面）——identity 命名不在裸 handle 投影上传播，与 place 的全传播区分。
 *
 * Run: npx vitest run src/brep/engine/brepkit-clone-fix.test.ts
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

interface BBox { dx: number; dy: number; dz: number; volume: number }

/** 取某输出 Shape 的 bbox 尺寸 + volume（BREP 句柄直取，不依赖三角化）。 */
async function measureBBox(result: ExecutionResult, varName: string): Promise<BBox> {
  const shape = result.outputs.get(varName as never) as Shape | undefined
  if (!shape) throw new Error(`output "${varName}" not found`)
  const handle = brepOf(shape)
  if (handle === undefined) throw new Error(`"${varName}" has no brep handle`)
  const engine = await getBrepEngine()
  const bb = engine.primitives.getBoundingBox(handle as never)
  const vol = engine.primitives.getVolume(handle as never)
  return { dx: bb.xmax - bb.xmin, dy: bb.ymax - bb.ymin, dz: bb.zmax - bb.zmin, volume: vol }
}

function close(a: number, b: number): boolean {
  const mag = Math.max(Math.abs(a), Math.abs(b))
  if (mag < 1e-6) return true
  if (mag < 0.01) return Math.abs(a - b) < 1e-3
  return Math.abs(a - b) <= 0.01 * mag
}

describe('brepkit-clone-fix（clone 能力路由回归）', () => {
  beforeAll(() => {
    ensureTestFontLoader()
    registerEditorExtensions()
  }, 60000)

  it(
    '(a)(b) clone 几何在 occt × brepkit 三版本一致：bbox/volume 与原 box 相等',
    async () => {
      // 20×10×5 box → clone；期望 clone 与源同尺寸同体积。
      const code = [
        'const b = cad.box(20, 10, 5, { centered: true })',
        'const c = await cad.clone(b)',
      ].join('\n')

      for (const engine of ENGINES) {
        await engine.setup()
        const { result, error } = await runCode(code)
        expect(error, `clone on ${engine.label} should succeed`).toBeUndefined()

        const src = await measureBBox(result, 'b')
        const clone = await measureBBox(result, 'c')

        // (b) occt 基准：box 20×10×5，体积 1000。
        expect(close(src.dx, 20), `[${engine.label}] src dx`).toBe(true)
        expect(close(src.dy, 10), `[${engine.label}] src dy`).toBe(true)
        expect(close(src.dz, 5), `[${engine.label}] src dz`).toBe(true)

        // (a) clone 与源几何一致（bbox + volume）。
        expect(close(clone.dx, src.dx), `[${engine.label}] clone dx vs src`).toBe(true)
        expect(close(clone.dy, src.dy), `[${engine.label}] clone dy vs src`).toBe(true)
        expect(close(clone.dz, src.dz), `[${engine.label}] clone dz vs src`).toBe(true)
        expect(close(clone.volume, src.volume), `[${engine.label}] clone volume vs src`).toBe(true)
        expect(clone.volume, `[${engine.label}] clone volume ≈ 1000`).toBeGreaterThan(900)
        expect(clone.volume, `[${engine.label}] clone volume ≈ 1000`).toBeLessThan(1100)
      }
    },
    180000,
  )

  it(
    '(c) 降级语义：edgeRef(clone, n) 在所有引擎上干净报 nameless shape（不崩溃）',
    async () => {
      // identity 命名不在裸 handle 投影上传播（与手写 place 全传播区分）——
      // clone 产物无名，edgeRef 必须结构化报错 E_TOPO_NOT_FOUND，绝不静默选错面。
      const code = [
        'const b = cad.box(20, 20, 20, { centered: true })',
        'const c = await cad.clone(b)',
        'const e = cad.edgeRef(c, 1)',
      ].join('\n')

      for (const engine of ENGINES) {
        await engine.setup()
        const { error } = await runCode(code)
        expect(error, `edgeRef(clone) on ${engine.label} must fail gracefully`).toBeDefined()
        expect(
          error,
          `[${engine.label}] should be a structured nameless-shape TopoRefError, got: ${error}`,
        ).toMatch(/E_TOPO_NOT_FOUND|nameless shape|no role table/)
      }
    },
    180000,
  )

  afterAll(async () => {
    await resetToDefaultBrepkit()
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
  }, 60000)
})
