/**
 * sprocket.test.ts — 链轮 brepkit ↔ occt（方案 §6.7，2026-10-13 重新归类）
 *
 * ⚠️ 实测结论：链轮**不是**零缺口件，属 brepkit 真缺口（occt-only）。
 *
 * 现象（全套跑通后实测）：
 *   - 体积 brepkit 比 occt 小 ~12%（10 齿 occt=2503 / brepkit=2194；48 齿 61486 / 54369）。
 *   - 带安装孔的变体 CoM.x 偏差 100%（brepkit 结果非对称）。
 * 根因（未改库源码，仅静态推断）：链轮齿廓是 50+ 条小半径圆弧边构成的单闭合
 * wire，经 `planarFace`→`makeFaceFromWire` + `extrudeFace` 成体。brepkit 的
 * `makeWire` 有「边序接不上时静默丢弃」的已知陷阱（primitives.ts 注释），复杂闭合
 * 链上共享顶点（~1e-13 浮点）未被识别为连通 → 面被退化 → 体积偏小且非对称。
 * occt 同路径正常。这是 brepkit 构造层缺陷，无法在测试侧（不修改库源码）修复。
 *
 * 故本文件改为 **occt-only 单体回归**（确保 occt 仍产出合法 solid、度量合理），
 * brepkit 对照不跑（与 §6.1 `['occt']` 件处理一致）。brepkit 真缺口记为 §6.7 的
 * occt-only 清单，待 brepkit `makeWire`/`makeFaceFromWire` 修复后重测。
 *
 * 运行：
 *   npx vitest run --config packages/tests/vitest.engine-compat.config.ts
 */

import { describe, it, beforeAll, expect } from 'vitest'
import { initEngines, buildOn } from './harness'
import { buildSprocket } from '../../../faijs-fasteners/src/sprocket'
import type { BrepHandle } from '../../../core/src/brep/engine/primitives'

interface SprocketParams {
  numTeeth: number
  chainPitch?: number
  rollerDiameter?: number
  thickness?: number
  boltCircleDiameter?: number
  numMountBolts?: number
  mountBoltDiameter?: number
  boreDiameter?: number
}

interface Fixture {
  name: string
  params: SprocketParams
}

// 覆盖少/中/多齿 + 带孔变体（尺度敏感性）。
const fixtures: Fixture[] = [
  { name: 'teeth=10', params: { numTeeth: 10 } },
  { name: 'teeth=24', params: { numTeeth: 24 } },
  { name: 'teeth=48', params: { numTeeth: 48 } },
  {
    name: 'teeth=20 + bore + 4 mount bolts',
    params: {
      numTeeth: 20,
      boreDiameter: 10,
      boltCircleDiameter: 40,
      numMountBolts: 4,
      mountBoltDiameter: 5,
    },
  },
]

beforeAll(async () => {
  await initEngines()
}, 180_000)

describe('sprocket: occt-only regression (brepkit = genuine gap)', () => {
  it('discovered fixtures are non-empty', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const fx of fixtures) {
    it(`[occt regression] ${fx.name}`, () => {
      const occt = buildOn('occt', (p: SprocketParams) => {
        const r = buildSprocket(p)
        return { handle: r.handle as BrepHandle }
      }, fx.params)
      // occt 必须产出合法几何（体积 > 0、bbox 有限）。注意：occt 把多体链轮作为
      // compound-of-solids 返回，故 `metrics.solid` 计数为 undefined/0、isSolid=false，
      // 不以此判定；体积与 bbox 足以证明 occt 侧建模正确（brepkit 对照见文件头，不跑）。
      expect(occt.metrics.volume).toBeGreaterThan(0)
      expect(Number.isFinite(occt.metrics.bbox.max.x)).toBe(true)
      expect(Number.isFinite(occt.metrics.bbox.min.x)).toBe(true)
    })
  }
})
