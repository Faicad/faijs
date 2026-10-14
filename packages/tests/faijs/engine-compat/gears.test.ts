/**
 * gears.test.ts — 齿轮引擎兼容性（方案 §6.7 / §6.3 / §3.5 第 5 项）
 *
 * 分类：brepkit 真缺口，且是**库级** occt-only。faijs-gears 是平台库
 * （`package.json` 的 `faijs.lib.platform = ['occt']`）：其构建主路径依赖四件
 * L1 无法表达的能力（`loft-shell` / `healWire` / `split(工具实体)` /
 * `projectPointOnFace`，见 `src/kernel/gears.ts` 的 `GearOcct`），故整体 occt-only。
 *
 * faijs-gears 现已收敛为**双句柄** `gearKernel()`（`l1 = getBrepApi()` + `occt = getOcctKernel()`）。
 * 入口处按活动引擎 id（`config.brepEngineId`）做平台库门禁：非 `occt` 即在触碰内核前抛
 * `E_BREP_UNSUPPORTED`（与 core `api/internal/l3-bridge` 的 `assertEngineFor` 文案同构，含引擎名）。
 * 因此：
 *  - occt 活动（`useGearKernel('occt')`）时构建正常（几何与旧 occt 路径等价）——单体回归；
 *  - brepkit 活动（`useGearKernel('brepkit')`）时 `gearKernel()` 在执行前拒绝——本文件第二
 *    组 describe 把这道门禁钉住（断言 `E_BREP_UNSUPPORTED` + 引擎名），而非构建深处的随机失败。
 *
 * 运行：
 *   npx vitest run --config packages/tests/vitest.engine-compat.config.ts faijs/engine-compat/gears.test.ts
 */

import { describe, it, beforeAll, expect } from 'vitest'
import { initEngines, measureOcct, useGearKernel } from './harness'
import type { BrepHandle } from '../../../core/src/brep/engine/primitives'
import {
  spurGear,
  ringGear,
  crossedHelicalGear,
  bevelGear,
  rackGear,
  worm,
} from '../../../faijs-gears/src/index'

beforeAll(async () => {
  await initEngines()
}, 180_000)

interface GearResult {
  ok: boolean
  value?: BrepHandle
}

describe('gears: occt builds valid geometry (regression)', () => {
  const fixtures: Array<[string, () => Promise<GearResult>]> = [
    ['spurGear', () => spurGear({ module: 2, teeth_number: 24, width: 8 }) as Promise<GearResult>],
    ['ringGear', () => ringGear({ module: 2, teeth_number: 30, width: 8, rim_width: 6 }) as Promise<GearResult>],
    ['crossedHelicalGear', () => crossedHelicalGear({ module: 2, teeth_number: 20, width: 12, helix_angle: 30 }) as Promise<GearResult>],
    ['bevelGear', () => bevelGear({ module: 2, teeth_number: 20, cone_angle: 45, face_width: 10 }) as Promise<GearResult>],
    ['rackGear', () => rackGear({ module: 2, length: 60, width: 20, height: 15 }) as Promise<GearResult>],
    ['worm', () => worm({ module: 2, lead_angle: 15, n_threads: 1, length: 40 }) as Promise<GearResult>],
  ]

  for (const [name, build] of fixtures) {
    it(`[occt regression] ${name}`, async () => {
      // 注入 gears 的 occt 构建面（L1 优先 + raw occt 平台原语兜底）。10 个 L1 方法走
      // L1 适配器，其余 15 个 occt 平台扩展由 raw occt 兜底——几何与旧 raw occt 路径等价。
      useGearKernel('occt')
      const r = await build()
      expect(r.ok).toBe(true)
      const m = measureOcct(r.value!)
      expect(m.volume).toBeGreaterThan(0)
      expect(Number.isFinite(m.bbox.max.x)).toBe(true)
      expect(Number.isFinite(m.bbox.min.x)).toBe(true)
    })
  }
})

describe('gears: brepkit cannot build (genuine engine gap)', () => {
  /**
   * 门禁断言（方案 §3.5 第 5 项，2026-10-14 翻转）：
   *
   * faijs-gears 是 occt-only 平台库（`faijs.lib.platform = ['occt']`）。`gearKernel()`
   * 在取双句柄之前先校验活动引擎 id（读 `config.brepEngineId`）：非 `occt` 即**执行前**
   * 抛 `E_BREP_UNSUPPORTED`——文案与 core `api/internal/l3-bridge` 的 `assertEngineFor`
   * 同构（含引擎名、可定位），不补桩、不静默降级、更不进内核。
   *
   * 这是 declaratively 正确的失败：平台库在 brepkit 下构建必然失败，落在这道门禁而不是
   * 构建深处的随机失败点（旧口径是 `E_LOFT_BAD_ENDPOINT`，那是 L1 `loft` 的 endPoint
   * 守卫在 brepkit 侧最先暴露的下游症状，不是根因）。
   */
  it('[occt-only gap] injecting brepkit makes gear build fail (pre-execution E_BREP_UNSUPPORTED)', async () => {
    useGearKernel('brepkit')
    const r = await spurGear({ module: 2, teeth_number: 24, width: 8 })
    expect(r.ok).toBe(false)
    const msg = (r as { error?: string }).error ?? ''
    // 当前值（正确）：执行前引擎身份拒绝，含引擎名，可定位——这正是平台库门禁该有的形态。
    expect(msg).toMatch(/E_BREP_UNSUPPORTED/)
    expect(msg).toMatch(/requires engine occt/)
    expect(msg).toMatch(/current=brepkit/)
    // 不应再是旧口径的任何症状（缺原语 / L1 loft endPoint 守卫 / 已进内核的报错）。
    expect(msg).not.toMatch(/is not a function/)
    expect(msg).not.toMatch(/E_LOFT_BAD_ENDPOINT/)
    expect(msg).not.toMatch(/not initialized/)
  })
})
