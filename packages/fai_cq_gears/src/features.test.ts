/**
 * features.test — 倒角 / 轴孔 / 凹槽 / 轮毂 / 轮辐（cq_gears `_make_chamfer` /
 * `_make_bore` / `_make_recess` / `_make_hub` / `_make_spokes`）几何验证
 *
 * 用 manifest 真实回归用例的体积锁定正确性（A1 尖峰的自动化版）：
 * - SpurGear  + chamfer + bore（case00）
 * - RingGear   + chamfer      （case14，内齿版 cutter）
 * - CrossedHelical + chamfer + bore（case29）
 * - SpurGear  + hub + recess（case01 / case07）
 * - SpurGear  + hub + recess + spokes + fillet（case02 / case04）
 * - HerringboneGear + 全套特征（case05 / case06）
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { getRawKernel, type RawOcctKernel } from './kernel'
import { buildSpurGearSolid, buildHerringboneGearSolid, type BuildSpurGearOptions } from './spur_gear'
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
  if (typeof a.hub_d === 'number') build.hubD = a.hub_d
  if (typeof a.hub_length === 'number') build.hubLength = a.hub_length
  if (typeof a.recess === 'number') build.recess = a.recess
  if (typeof a.recess_d === 'number') build.recessD = a.recess_d
  if (typeof a.bottom_recess === 'number') build.bottomRecess = a.bottom_recess
  if (typeof a.bottom_recess_d === 'number') build.bottomRecessD = a.bottom_recess_d
  if (typeof a.bottom_hub_d === 'number') build.bottomHubD = a.bottom_hub_d
  if (typeof a.n_spokes === 'number') build.nSpokes = a.n_spokes
  if (typeof a.spoke_width === 'number') build.spokeWidth = a.spoke_width
  if (typeof a.spokes_id === 'number') build.spokesId = a.spokes_id
  if (typeof a.spokes_od === 'number') build.spokesOd = a.spokes_od
  if (typeof a.spoke_fillet === 'number') build.spokeFillet = a.spoke_fillet
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

describe('features: hub + recess + spokes', () => {
  it('SpurGear hub+recess matches cq_gears case01', () => {
    const c = loadManifest().cases.find((x) => x.id === 'case01-SpurGear')!
    const solid = buildSpurGearSolid(kernel, c.args as unknown as SpurGearParams, featureBuild(c.args))
    const vol = kernel.getVolume(solid)
    expect(kernel.isSolid(solid)).toBe(true)
    expect(rel(vol, c.volume!)).toBeLessThan(1e-5)
  })

  it('SpurGear hub+recess (no bore) matches cq_gears case07', () => {
    const c = loadManifest().cases.find((x) => x.id === 'case07-SpurGear')!
    const solid = buildSpurGearSolid(kernel, c.args as unknown as SpurGearParams, featureBuild(c.args))
    const vol = kernel.getVolume(solid)
    expect(kernel.isSolid(solid)).toBe(true)
    expect(rel(vol, c.volume!)).toBeLessThan(1e-5)
  })

  it('SpurGear spokes+fillet matches cq_gears case02 (n=5)', () => {
    const c = loadManifest().cases.find((x) => x.id === 'case02-SpurGear')!
    const solid = buildSpurGearSolid(kernel, c.args as unknown as SpurGearParams, featureBuild(c.args))
    const vol = kernel.getVolume(solid)
    expect(kernel.isSolid(solid)).toBe(true)
    expect(rel(vol, c.volume!)).toBeLessThan(1e-5)
  })

  it('SpurGear spokes+fillet matches cq_gears case04 (n=3)', () => {
    // ⚠️ case04 的 manifest volume 含 missing_teeth 特征（[[0,10],[20,30]]，属后续
    // 移植项）；本机 cq（cadquery-env）验证「无 missing_teeth」体积 = 6020.6931，
    // 以它为基准锁定 spokes+fillet 几何。
    const c = loadManifest().cases.find((x) => x.id === 'case04-SpurGear')!
    const solid = buildSpurGearSolid(kernel, c.args as unknown as SpurGearParams, featureBuild(c.args))
    const vol = kernel.getVolume(solid)
    expect(kernel.isSolid(solid)).toBe(true)
    expect(rel(vol, 6020.6931)).toBeLessThan(1e-5)
  })

  it('HerringboneGear full features matches cq_gears case05 (n=5, fillet=5)', () => {
    const c = loadManifest().cases.find((x) => x.id === 'case05-HerringboneGear')!
    const solid = buildHerringboneGearSolid(kernel, c.args as unknown as SpurGearParams, featureBuild(c.args))
    const vol = kernel.getVolume(solid)
    expect(kernel.isSolid(solid)).toBe(true)
    expect(rel(vol, c.volume!)).toBeLessThan(1e-5)
  })

  it('HerringboneGear full features matches cq_gears case06 (n=3, fillet=10)', () => {
    // ⚠️ case06 的 manifest volume 含 missing_teeth 特征（[[0,2],[20,50]]，属后续
    // 移植项）；本机 cq 验证「无 missing_teeth」体积 = 101399.4648，以此锁定。
    const c = loadManifest().cases.find((x) => x.id === 'case06-HerringboneGear')!
    const solid = buildHerringboneGearSolid(kernel, c.args as unknown as SpurGearParams, featureBuild(c.args))
    const vol = kernel.getVolume(solid)
    expect(kernel.isSolid(solid)).toBe(true)
    expect(rel(vol, 101399.4648)).toBeLessThan(1e-5)
  })

  it('CrossedHelicalGear hub+recess matches cq_gears case29 / case30 full volumes', () => {
    // case29/30 的 manifest 体积含 hub+recess（cq CrossedHelicalGear 继承 SpurGear
    // 的 `_build`，特征齐全）——现在特征已补齐，直接锁定完整体体积。
    // 容差 1e-3（与本包裸体几何体积锁定同档）：B-spline 齿面近似的跨版本累积
    // 体积差实测 case29≈1.9e-5、case30≈3.0e-4（case30 宽 40/螺旋 45°，扭转大、
    // 近似误差累积更多；本机 cq 2.8.0 对照确认逻辑一致）。
    for (const id of ['case29-CrossedHelicalGear', 'case30-CrossedHelicalGear']) {
      const c = loadManifest().cases.find((x) => x.id === id)!
      const solid = buildCrossedHelicalSolid(
        kernel, c.args as unknown as CrossedHelicalGearParams, featureBuild(c.args),
      )
      const vol = kernel.getVolume(solid)
      expect(kernel.isSolid(solid)).toBe(true)
      expect(rel(vol, c.volume!)).toBeLessThan(1e-3)
    }
  })
})
