/**
 * thread.test.ts — 螺纹 occt-only 回归（方案 §6.7 / §6.3）
 *
 * 分类：brepkit 真缺口（`['occt']`）。螺纹体构造依赖 `makeHelixWire` + `bsplineSurface`
 * （`ruledFace` 经 `approximatePoints` + `loft`），brepkit L1 无对应原语 → 不可建。
 * 仅做 occt 单体回归：校验几何有效（体积 > 0、包围盒有限）。
 *
 * 运行：
 *   npx vitest run --config packages/tests/vitest.engine-compat.config.ts faijs/engine-compat/thread.test.ts
 */

import { describe, it, beforeAll, expect } from 'vitest'
import { initEngines, measureOcct } from './harness'
import { buildThread } from '../../../faijs-fasteners/src/thread'
import type { ThreadSpec } from '../../../faijs-fasteners/src/thread'

interface Fixture {
  name: string
  spec: ThreadSpec
}

const fixtures: Fixture[] = [
  {
    name: 'external M6x1 L10',
    spec: { apex_radius: 3, apex_width: 0.125, root_radius: 2.5, root_width: 0.75, pitch: 1, length: 10, simple: false },
  },
  {
    name: 'internal M6x1 L10',
    spec: { apex_radius: 2.5, apex_width: 0.75, root_radius: 3, root_width: 0.125, pitch: 1, length: 10, simple: false },
  },
]

beforeAll(async () => {
  await initEngines()
}, 180_000)

describe('thread: occt-only regression (brepkit has no helix/B-spline primitive)', () => {
  it('discovered fixtures are non-empty', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const fx of fixtures) {
    it(`[occt regression] ${fx.name}`, () => {
      const r = buildThread(fx.spec)
      expect(r.handle).not.toBeNull()
      const m = measureOcct(r.handle!)
      expect(m.volume).toBeGreaterThan(0)
      expect(Number.isFinite(m.bbox.max.x)).toBe(true)
      expect(Number.isFinite(m.bbox.min.x)).toBe(true)
    })
  }
})
