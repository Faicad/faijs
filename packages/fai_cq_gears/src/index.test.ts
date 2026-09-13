/**
 * index — 公共 API 装载自检（计划 §6.6 完成判据）
 *
 * 只验证「库可被装载」这一最小契约：
 *   1. 15 个齿轮类导出函数全部存在且为函数；
 *   2. `contractVersion` 已导出且为数字；
 *   3. 经 `runtime.registerLib('fai_cq_gears', lib, { packageName })` 装载不抛——
 *      registerLib 内部会 `assertContractVersion`，与引擎版本对齐才算通过。
 *
 * 不在这里跑几何构建（那由 *-build.test.ts / 参考一致性比对覆盖）。
 */

import { describe, it, expect } from 'vitest'
import { createRuntime } from '@faicad/faijs-core'
import * as faiCqGears from './index'

/** 15 个导出函数名（与 `docs/plans/2026-09-11-fai-cq-gears-port.md` §6 逐字对齐）。 */
const EXPECTED_FUNCTIONS = [
  'spurGear',
  'herringboneGear',
  'ringGear',
  'herringboneRingGear',
  'crossedHelicalGear',
  'hyperbolicGear',
  'bevelGear',
  'bevelGearPair',
  'rackGear',
  'herringboneRackGear',
  'worm',
  'crossedGearPair',
  'hyperbolicGearPair',
  'planetaryGearset',
  'herringbonePlanetaryGearset',
] as const

describe('fai_cq_gears public API surface', () => {
  it('exports all 15 gear-class functions', () => {
    const ns = faiCqGears as unknown as Record<string, unknown>
    for (const name of EXPECTED_FUNCTIONS) {
      expect(typeof ns[name], `missing export: ${name}`).toBe('function')
    }
  })

  it('exports contractVersion (number)', () => {
    const ns = faiCqGears as unknown as Record<string, unknown>
    expect(typeof ns.contractVersion).toBe('number')
  })
})

describe('fai_cq_gears runtime integration', () => {
  it('registers into a CadRuntime via registerLib without throwing', () => {
    // 最小 host ports 桩：仅 `events` 为必填；registerLib 只校验命名空间的
    // contractVersion，不触碰内核，故桩即可满足装载自检。
    const ports = { events: { emit() {} } } as unknown as Parameters<typeof createRuntime>[0]
    const runtime = createRuntime(ports)
    expect(() =>
      runtime.registerLib('fai_cq_gears', faiCqGears as never, {
        packageName: '@faicad/fai-cq-gears',
      }),
    ).not.toThrow()
  })
})
