/**
 * smlib-kernel/smlib-split-after-scale — 含缩放变换后 splitByPlane 半体损坏（SM 1001）回归
 *
 * 已修复（2026-10-27）：根因是 wasm 桥 `SmApiTransformMatrixEx` 走
 * `SetFrom4x4 + SmApiTransform`（cpOptScale=NULL，内核按 rigid 处理）——含缩放的矩阵
 * 不触发 `TurnToNURBS`，解析面（球/柱/锥…）几何未正确重建，随后 `SmApiCutEx` 产出
 * 损坏半体（`SmApiTessellateEx` / `GetFacesEx` 返回 `SM_ERR=1001`）。修复后桥改走内核
 * `SmBrep::Transform(const double[4][4], bScaleTol)`（SVD 分解 + 非均匀缩放 TurnToNURBS
 * + 反射走 SmApiMirror）。
 *
 * 来源：`docs/examples/pikachu-1.fai.js` 第 20 行 —— 小程序端（smlib 引擎）执行
 * `cad.sphere → cad.scale3d([7,6,20]) → cad.splitByPlane` 时报
 *   `[faijs/op] <anon>: E_OP_FAILED: [smlib-kernel] meshShape failed: SM status 1001`
 *
 * 本文件是这次缺陷的回归钉：含缩放的变换后切割两半必须均可三角化。对照用例钉住
 * "原始 / 平移形状切割正常"，使差异唯一地归因到"含缩放的变换"。
 *
 * Run: npx vitest run test/smlib-kernel/smlib-split-after-scale.test.ts
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerSmlibBrepEngine } from '../../src/brep/engine/adapters/smlib'
import { createSmlibPrimitives, type SmlibPrimitives } from '../../src/smlib-kernel/smlibKernel'
import { createEditorRuntime } from '../support/editor-ops'

/** pikachu 左耳链路的最小切片（sphere → 非均匀 scale3d → splitByPlane）。 */
const SCRIPT = `const s = cad.sphere({ radius: 1 * MM, segments: 64 })
const sc = cad.scale3d(s, { factor: [7, 6, 20] })
const sp = cad.splitByPlane(sc, { point: [0 * MM, 0 * MM, 8 * MM], normal: [0 * MM, 0 * MM, 1 * MM] })

`

/** 3×4 行主序矩阵：非均匀缩放 [7,6,20]。 */
const NON_UNIFORM = [7, 0, 0, 0, 0, 6, 0, 0, 0, 0, 20, 0]
/** 3×4 行主序矩阵：纯平移 (0,0,0.3)。 */
const TRANSLATION = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0.3]

describe('smlib splitByPlane：含缩放的变换后切割半体（SM 1001）回归', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('execute：sphere→scale3d(非均匀)→splitByPlane 无 failedAt', async () => {
    await registerSmlibBrepEngine()
    const runtime = createEditorRuntime({ events: { emit: () => undefined } }, 'brep')
    const result: ExecutionResult = await runtime.execute(SCRIPT)
    expect(result.failedAt).toBeUndefined()
  })

  describe('内核级定位与对照', () => {
    let p: SmlibPrimitives
    beforeAll(async () => {
      p = await createSmlibPrimitives()
    })

    /** 切割后两半都必须能三角化（原缺陷：其中一半 SM 1001）。 */
    function expectBothHalvesMeshable(solid: number, z: number): void {
      const { positive, negative } = p.splitByPlane(solid as never, { x: 0, y: 0, z }, { x: 0, y: 0, z: 1 })
      expect(() => p.meshShape(positive as never)).not.toThrow()
      expect(() => p.meshShape(negative as never)).not.toThrow()
    }

    it('对照：未经变换的原始球切割两半均可三角化', () => {
      expectBothHalvesMeshable(p.makeSphere(1) as never, 0.5)
    })

    it('对照：纯平移后的球切割两半均可三角化', () => {
      expectBothHalvesMeshable(p.transform(p.makeSphere(1), TRANSLATION) as never, 0.5)
    })

    it('非均匀缩放球切割两半均可三角化', () => {
      expectBothHalvesMeshable(p.transform(p.makeSphere(1), NON_UNIFORM) as never, 8)
    })

    it('均匀缩放球切割两半均可三角化', () => {
      const uniform = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0]
      expectBothHalvesMeshable(p.transform(p.makeSphere(1), uniform) as never, 1)
    })

    it('缩放过的 box 切割两半均可三角化', () => {
      expectBothHalvesMeshable(p.transform(p.makeBox(1, 1, 1), NON_UNIFORM) as never, 8)
    })
  })
})