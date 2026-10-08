/**
 * measurement 数值钉住（core-decouple wrapup §3.1）：core 第一方同步
 * 测量面（api/generated/measurement）的数值——20×10×5 盒 → 体积 1000 /
 * 面积 700 / 边总长 140（唯一 edge 弧长之和；2026-10-02 归一化前为 280）。
 *
 * 运行：npx vitest run src/api/generated/measurement.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { registerOcctBrepEngine } from '../../../src/brep/engine/adapters/occt'
import { getBrepEngine } from '../../../src/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../../src/runtime-state'
import { box } from '../../../src/api/primitives'
import { measureArea, measureLength, measureVolume } from '../../../src/api/generated/measurement'

const BOX_VOLUME = 20 * 10 * 5 // 1000
const BOX_AREA = 2 * (20 * 10 + 20 * 5 + 10 * 5) // 700

beforeAll(async () => {
  await registerOcctBrepEngine()
  const brep = await getBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepEngineId: 'occt' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
}, 120000)

describe('measurement 数值钉住（第一方同步面）', () => {
  it('box({width:20,depth:10,height:5}) → volume 1000', async () => {
    const s = await box({ width: 20, depth: 10, height: 5 })
    expect(measureVolume(s)).toBeCloseTo(BOX_VOLUME, 6)
  })

  it('同盒 → area 700', async () => {
    const s = await box({ width: 20, depth: 10, height: 5 })
    expect(measureArea(s)).toBeCloseTo(BOX_AREA, 6)
  })

  it('同盒 → length 140（12 条唯一边弧长之和）', async () => {
    const s = await box({ width: 20, depth: 10, height: 5 })
    expect(measureLength(s)).toBeCloseTo(140, 6)
  })
})
