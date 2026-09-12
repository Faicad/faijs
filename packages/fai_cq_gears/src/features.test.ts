/**
 * features.test — 倒角 / 轴孔（cq_gears `_make_chamfer` / `_make_bore`）几何验证
 *
 * 用 manifest 真实回归用例的体积锁定正确性（A1 尖峰的自动化版）：
 * - SpurGear  + chamfer + bore（case00）
 * - RingGear   + chamfer      （case14，内齿版 cutter）
 * - CrossedHelical + chamfer + bore（case29）
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { getRawKernel, type RawOcctKernel } from './kernel'
import { buildSpurGearSolid, type BuildSpurGearOptions } from './spur_gear'
import { buildRingGearSolid, type BuildRingGearOptions } from './ring_gear'
import { buildCrossedHelicalSolid } from './crossed_helical_gear'
import { loadManifest } from './fixtures'
import type { SpurGearParams, RingGearParams, CrossedHelicalGearParams } from './profile'

let kernel: RawOcctKernel

beforeAll(async () => {
  kernel = await getRawKernel()
})

function rel(a: number, b: number): number {
  return Math.abs(a - b) / b
}

/** 从 manifest args 抽镀铬特征参数，构造对应 build options。 */
function featureBuild(a: Record<string, unknown>): BuildSpurGearOptions {
  const build: BuildSpurGearOptions = {}
  if (typeof a.chamfer === 'number') build.chamfer = a.chamfer
  if (typeof a.bore_d === 'number') build.boreD = a.bore_d
  return build
}

describe('features: chamfer + bore', () => {
  it('SpurGear chamfer+bore matches cq_gears case00 (167.8456187)', () => {
    const c = loadManifest().cases.find((x) => x.id === 'case00-SpurGear')!
    const params = c.args as unknown as SpurGearParams
    const solid = buildSpurGearSolid(kernel, params, featureBuild(c.args))
    const vol = kernel.getVolume(solid)
    expect(kernel.isSolid(solid)).toBe(true)
    expect(rel(vol, c.volume!)).toBeLessThan(1e-5)
  })

  it('RingGear chamfer matches cq_gears case14 (1853.61635, internal-tooth cutter)', () => {
    const c = loadManifest().cases.find((x) => x.id === 'case14-RingGear')!
    const params = c.args as unknown as RingGearParams
    const solid = buildRingGearSolid(kernel, params, featureBuild(c.args) as BuildRingGearOptions)
    const vol = kernel.getVolume(solid)
    expect(kernel.isSolid(solid)).toBe(true)
    expect(rel(vol, c.volume!)).toBeLessThan(1e-5)
  })

  it('CrossedHelicalGear base geometry matches cq bare (no hub/recess; case29 bare=6704.1966)', () => {
    // case29/30 的 manifest 体积是「chamfer+bore+hub+recess」完整体，不能直接比；
    // 这里只验证裸体基础几何（与 `scripts/gen-crossed-bare.py` 的 cq 裸体基准对齐）。
    const c = loadManifest().cases.find((x) => x.id === 'case29-CrossedHelicalGear')!
    const params = c.args as unknown as CrossedHelicalGearParams
    const bare = buildCrossedHelicalSolid(kernel, params, {})
    const vol = kernel.getVolume(bare)
    expect(kernel.isSolid(bare)).toBe(true)
    // cq 裸体体积（gen-crossed-bare.py）：6704.196564
    expect(rel(vol, 6704.196564)).toBeLessThan(1e-3)

    // 倒角 + 轴孔路径（与 SpurGear 同一份 buildGearSolid + applyChamfer(isRing=false)）：
    // 必须产出合法 solid，且体积小于裸体（被去除材料）。
    const a = c.args as Record<string, unknown>
    const fe = buildCrossedHelicalSolid(kernel, params, {
      chamfer: typeof a.chamfer === 'number' ? a.chamfer : undefined,
      boreD: typeof a.bore_d === 'number' ? a.bore_d : undefined,
    })
    expect(kernel.isSolid(fe)).toBe(true)
    expect(kernel.getVolume(fe)).toBeLessThan(vol)
  })
})
