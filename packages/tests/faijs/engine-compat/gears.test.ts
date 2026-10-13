/**
 * gears.test.ts — 齿轮引擎兼容性（方案 §6.7 / §6.3）
 *
 * 分类：brepkit 真缺口。gears 已收敛到 L1（`GearKernel = BrepEngineApi & {15 个
 * occt 平台扩展}`，见 `packages/faijs-gears/src/kernel/gears.ts`）：10 个样条/螺旋
 * 原语走 L1，其余 15 个 occt 平台扩展（sew / split / loft-shell / healWire / isFace 族
 * / projectPointOnFace / revolve / buildSolidFromFaces / makeFaceOnSurface / outerWire /
 * getShapeType / interpolatePoints(periodic)）brepkit 核心未实现。
 *
 * faijs-gears 与 faijs-fasteners 对齐：`getGearKernel()` 消费宿主注入的 backend
 * （`getBackends().kernel.brep`）。因此：
 *  - occt 注入（L1 优先 + raw occt 平台原语兜底，见 `useGearKernel('occt')`）时
 *    构建正常（几何与旧 raw occt 路径等价）——单体回归；
 *  - brepkit 注入（纯 L1 brepkit，见 `useGearKernel('brepkit')`）构建必然失败——
 *    本文件用断言把这一**真实引擎缺口**暴露在引擎层。
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
   * 缺口断言（2026-10-13 重钉）：
   *
   * §7 决策点 1/2/3 把 `bsplineSurface` / `makeHelixWire` / `approximatePoints` /
   * `interpolatePoints` 接进 L1 后，brepkit 侧**不再缺这些原语**——缺口因此向下游
   * 移动，失败文案也随之改变：
   *   旧（缺原语）: /bsplineSurface|makeHelixWire|approximatePoints|loft|is not a function/
   *   新（缺口下游）: `E_LOFT_BAD_ENDPOINT: loft endPoint must be a BrepVec3 ({x,y,z}), got false`
   * 新文案是 L1 `loft` 的契约守卫在拦：gears 的齿面走包侧旧口径
   * `loft(wires, isSolid=false, ruled=false)`，布尔 `false` 落在 L1 的 `endPoint` 位。
   * 守卫把它挡在进内核之前（旧行为是 brepkit 抛 `cannot normalize zero vector`、
   * occt 直接 wasm 硬 abort），错误可指路，正合方案 §4-① 的要求。
   *
   * 目标值：gears 收敛到 L1 口径（齿面改 ruled-face 原语或改走 occt 平台面）后，
   * 本用例翻转为「brepkit 构建成功 + T1/T2 一致性」。
   */
  it('[occt-only gap] injecting brepkit makes gear build fail (genuine engine gap)', async () => {
    useGearKernel('brepkit')
    const r = await spurGear({ module: 2, teeth_number: 24, width: 8 })
    expect(r.ok).toBe(false)
    const msg = (r as { error?: string }).error ?? ''
    // 当前值（错）：纯 L1 brepkit 缺 gear 的 occt 平台扩展。默认策略 row-approx-loft
    // 先调用 `loft(wires, false, false)`，L1 `loft` 第三参是 endPoint，布尔触发守卫
    // `E_LOFT_BAD_ENDPOINT`（这是 brepkit 侧最先暴露的真缺口）。
    expect(msg).toMatch(/E_LOFT_BAD_ENDPOINT/)
    expect(msg).toMatch(/got false/)
    // 应无的正确值：既不再是「缺原语」，也不再是无指向的 wasm 报错。
    expect(msg).not.toMatch(/is not a function/)
    expect(msg).not.toMatch(/cannot normalize zero vector/)
  })
})
