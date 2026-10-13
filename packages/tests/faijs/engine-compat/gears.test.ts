/**
 * gears.test.ts — 齿轮引擎兼容性（方案 §6.7 / §6.3）
 *
 * 分类：brepkit 真缺口（`['occt']`）。齿面靠 B 样条曲面
 * （`bsplineSurface` / `approximatePoints` / `interpolatePoints`）、`makeHelixWire`、
 * `loft` 等构造——这些原语 brepkit 核心引擎未实现（归 core，不在本包范围）。
 *
 * faijs-gears 现已与 faijs-fasteners 对齐：`getGearKernel()` 消费宿主注入的
 * backend（`getBackends().kernel.brep`）。因此：
 *  - occt 注入时构建正常——单体回归校验几何有效；
 *  - brepkit 注入时构建必然失败（缺原语）——本文件用断言把这一**真实引擎缺口**
 *    暴露在引擎层。将来 core 补齐原语后，该缺口测试直接翻转为一致性测试，无需改源码。
 *
 * 运行：
 *   npx vitest run --config packages/tests/vitest.engine-compat.config.ts faijs/engine-compat/gears.test.ts
 */

import { describe, it, beforeAll, expect } from 'vitest'
import { initEngines, measureOcct, useBuildKernel } from './harness'
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
      useBuildKernel('occt') // 显式锁定 occt，避免测试顺序耦合
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
  it('[occt-only gap] injecting brepkit makes gear build fail on missing primitive', async () => {
    useBuildKernel('brepkit')
    // brepkit 核心缺 bsplineSurface / makeHelixWire / approximatePoints / loft 等原语；
    // getGearKernel() 拿到 brepkit 内核后构建必失败（builder 把错误转成 err 结果）。
    const r = await spurGear({ module: 2, teeth_number: 24, width: 8 })
    expect(r.ok).toBe(false)
    const msg = (r as { error?: string }).error ?? ''
    expect(msg).toMatch(/bsplineSurface|makeHelixWire|approximatePoints|loft|is not a function/i)
  })
})
