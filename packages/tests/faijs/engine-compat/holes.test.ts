/**
 * holes.test.ts — 紧固孔切割器 brepkit ↔ occt 一致性（方案 §6.7 / §6.3）
 *
 * 分类：零缺口（`['occt','brepkit']`）。`fastenerHoleCutter` 仅用 L1 兼容原语
 * （revolveProfile / cylinder / cone / fuse / translate / makeSolid）——圆柱与圆锥是
 * 精确体，圆弧离散影响极小，几何应高度一致。
 *
 * 注：`clearanceHole` / `tapHole` 需传入宿主 `part` 实体，`internalThreadSolid` 走
 * 螺纹（helix + B 样条，brepkit 无对应原语 → 见 thread/occt-only）。本文件只测
 * 独立的零缺口切割器实体。
 *
 * 运行：
 *   npx vitest run --config packages/tests/vitest.engine-compat.config.ts faijs/engine-compat/holes.test.ts
 */

import { describe, it, beforeAll, expect } from 'vitest'
import { initEngines, buildOn, assertConsistent } from './harness'
import { fastenerHoleCutter } from '../../../faijs-fasteners/src/holes'
import type { BrepHandle } from '../../../core/src/brep/engine/primitives'

interface Fixture {
  name: string
  build: () => BrepHandle
}

const fixtures: Fixture[] = [
  {
    name: 'plain cutter holeR=3 depth=10',
    build: () => fastenerHoleCutter({ countersinkProfile: null, holeRadius: 3, depth: 10 }),
  },
  {
    name: 'countersink cutter holeR=3 depth=10 csk',
    build: () =>
      fastenerHoleCutter({
        countersinkProfile: [
          { r: 0, z: 0 },
          { r: 3, z: 0 },
          { r: 4, z: 2 },
          { r: 0, z: 2 },
        ],
        holeRadius: 3,
        depth: 10,
      }),
  },
]

beforeAll(async () => {
  await initEngines()
}, 180_000)

describe('holes: brepkit ↔ occt consistency', () => {
  it('discovered fixtures are non-empty', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const fx of fixtures) {
    it(`[T1+T2] ${fx.name}`, () => {
      const occt = buildOn('occt', () => ({ handle: fx.build() }), undefined)
      const brep = buildOn('brepkit', () => ({ handle: fx.build() }), undefined)
      assertConsistent(occt.metrics, brep.metrics)
    })
  }
})
