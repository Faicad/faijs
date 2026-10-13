/**
 * washer.test.ts — 垫圈 brepkit ↔ occt 一致性种子测试（方案 §6.7）
 *
 * 零缺口零件（washer 仅 revolve 轮廓，全走 L1 核心面），故期望值 = T1+T2 双通过、无偏差 band。
 * 参数组合从 `WASHER_TABLES` 动态选取（首类 + 首尺寸 + 末尺寸），不写死字符串，
 * 避免卡在参数校验而非几何。
 *
 * 运行（显式指定本配置，不影响默认测试套件）：
 *   npx vitest run --config packages/tests/vitest.engine-compat.config.ts
 */

import { describe, it, beforeAll, expect } from 'vitest'
import { initEngines, buildOn, assertConsistent } from './harness'
import { plainWasher, chamferedWasher, cheeseHeadWasher } from '../../../faijs-fasteners/src/washer'
import { WASHER_TABLES, typesOf, sizesOf } from '../../../faijs-fasteners/src/params'
import type { WasherClassName } from '../../../faijs-fasteners/src/params'
import type { BrepHandle } from '../../../core/src/brep/engine/primitives'

interface WasherParams {
  size: string
  fastener_type: string
}
type WasherBuild = (p: WasherParams) => { handle: BrepHandle }

const builders: Record<WasherClassName, WasherBuild> = {
  PlainWasher: (p) => plainWasher(p),
  ChamferedWasher: (p) => chamferedWasher(p),
  CheeseHeadWasher: (p) => cheeseHeadWasher(p),
}

interface Fixture {
  name: string
  build: WasherBuild
  params: WasherParams
}

function buildFixtures(): Fixture[] {
  const out: Fixture[] = []
  for (const cls of Object.keys(builders) as WasherClassName[]) {
    const table = WASHER_TABLES[cls]
    const fts = typesOf(table)
    if (fts.length === 0) continue
    const ft = fts[0]!
    const sizes = sizesOf(ft, table)
    if (sizes.length === 0) continue
    const small = sizes[0]!
    const large = sizes[sizes.length - 1]!
    out.push({ name: `${cls} ${small} ${ft}`, build: builders[cls], params: { size: small, fastener_type: ft } })
    if (large !== small) {
      out.push({ name: `${cls} ${large} ${ft}`, build: builders[cls], params: { size: large, fastener_type: ft } })
    }
  }
  return out
}

const fixtures = buildFixtures()

beforeAll(async () => {
  await initEngines()
}, 180_000)

describe('washer: brepkit ↔ occt consistency', () => {
  it('discovered fixtures are non-empty', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const fx of fixtures) {
    it(`[T1+T2] ${fx.name}`, () => {
      const occt = buildOn('occt', fx.build, fx.params)
      const brep = buildOn('brepkit', fx.build, fx.params)
      assertConsistent(occt.metrics, brep.metrics)
    })
  }
})
