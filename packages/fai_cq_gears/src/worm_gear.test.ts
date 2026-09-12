/**
 * worm_gear.test — Worm 蜗杆实体几何验证
 *
 * 用 manifest Worm 参考用例（cadquery 2.8.0 + cq_gears 源码 e73874c 生成）
 * 的体积锁定正确性：
 * - worm-basic   ：单头、lead_angle=20°（正导程角）
 * - worm-2threads：双头、lead_angle=15°（多头 tau 分度 + 圈间平移）
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { getRawKernel, type RawOcctKernel } from './kernel'
import { buildWormSolid } from './worm_gear'
import { loadManifest } from './fixtures'
import type { WormParams } from './profile'

let kernel: RawOcctKernel

beforeAll(async () => {
  kernel = await getRawKernel()
})

function rel(a: number, b: number): number {
  return Math.abs(a - b) / b
}

describe('worm_gear: volume lock vs cadquery reference', () => {
  // 容差按 case29/30 先例放宽（B 样条跨内核逼近漂移）：wasm 内核的
  // GeomAPI_PointsToBSplineSurface 用固定 Tol3D（不暴露 DegMin/DegMax/Tol3D
  // 参数），与 cq 显式 DegMin=3/DegMax=8/Tol3D=1e-2 的曲面存在系统性
  // 逼近差（实测 worm-basic≈1.39e-3、worm-2threads≈4.4e-4）。
  it('Worm single thread matches cq_gears worm-basic', () => {
    const c = loadManifest().cases.find((x) => x.id === 'worm-basic')!
    const solid = buildWormSolid(kernel, c.args as unknown as WormParams)
    const vol = kernel.getVolume(solid)
    expect(kernel.isSolid(solid)).toBe(true)
    expect(rel(vol, c.volume!)).toBeLessThan(2e-3)
  })

  it('Worm two threads matches cq_gears worm-2threads', () => {
    const c = loadManifest().cases.find((x) => x.id === 'worm-2threads')!
    const solid = buildWormSolid(kernel, c.args as unknown as WormParams)
    const vol = kernel.getVolume(solid)
    expect(kernel.isSolid(solid)).toBe(true)
    expect(rel(vol, c.volume!)).toBeLessThan(2e-3)
  })
})
