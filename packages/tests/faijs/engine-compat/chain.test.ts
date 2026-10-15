/**
 * chain.test.ts — 滚子链节 brepkit ↔ occt 一致性（方案 §6.7 / §6.3）
 *
 * 分类：零缺口（`['occt','brepkit']`）。链节构造仅用 L1 兼容原语
 * （extrudeFace / planarFace / fuse / translate / cylinder / makeArcEdge / rotate），
 * 且链板轮廓在源码里已是密集采样折线（圆弧已被离散为 24 段多边形），故两引擎几何
 * 高度一致，无需体积 band。
 *
 * 取 `parts[0].solid`（单个链节）做几何一致性，避免装配体 fuse 枚举差异。
 *
 * 运行：
 *   npx vitest run --config packages/tests/vitest.engine-compat.config.ts faijs/engine-compat/chain.test.ts
 */

import { describe, it, beforeAll, expect } from 'vitest'
import { initEngines, buildOn, assertConsistent } from './harness'
import { buildChain, type ChainParams } from '../../../faijs-fasteners/src/chain'
import type { BrepHandle } from '../../../core/src/brep/engine/primitives'

interface Fixture {
  name: string
  params: ChainParams
}

const fixtures: Fixture[] = [
  { name: '2-sprocket chain 32/32', params: { spkt_teeth: [32, 32], spkt_locations: [[0, 0], [300, 0]], positive_chain_wrap: [true, true] } },
  { name: '2-sprocket chain 10/16', params: { spkt_teeth: [10, 16], spkt_locations: [[0, 0], [200, 0]], positive_chain_wrap: [true, true] } },
]

function runChain(p: ChainParams): { handle: BrepHandle } {
  const c = buildChain(p)
  if (!c.parts[0]) throw new Error('[chain] no link part produced')
  return { handle: c.parts[0]!.solid }
}

beforeAll(async () => {
  await initEngines()
}, 180_000)

describe('chain: brepkit ↔ occt consistency', () => {
  it('discovered fixtures are non-empty', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const fx of fixtures) {
    it(`[T1+T2] ${fx.name}`, () => {
      const occt = buildOn('occt', () => runChain(fx.params), undefined)
      const brep = buildOn('brepkit', () => runChain(fx.params), undefined)
      assertConsistent(occt.metrics, brep.metrics)
    })
  }
})
