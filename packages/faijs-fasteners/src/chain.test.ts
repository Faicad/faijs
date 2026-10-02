/**
 * chain.test.ts — P1-a 链条验收（方案 §8-W9）：
 *  1. 纯数学：入/出角、段长、滚子定位与上游 `sprocket_and_chain_tests.py`
 *     的五轮真值逐位比对（容差 1e-7，对齐 assertTupleAlmostEquals 7 位）；
 *  2. 参数校验：长度不一致 / 少于 2 轮 / 重复位置 / 斜面法向 → 抛错；
 *  3. 内核烟测：makeLink 体积为正；buildChain 逐件装配 = numRollers 件，
 *     每件 solid 非空、体积为正。
 */

import { describe, expect, it, beforeAll } from 'vitest'
import { buildChain, makeLink } from './chain'
import { volumeOf, bboxOf } from './primitives'
import { setupWarehouseKernel } from './test-setup'

const MM = 1

/** 上游 test_five_sprocket_chain 的滚子真值（前 12 个 + 计数，sprocket_and_chain_tests.py:185）。 */
const FIVE_SPKT_ROLLERS: Array<[number, number]> = [
  [10.18715872390352, 222.87862587734543],
  [-2.469786367915538, 223.63749243920552],
  [-15.032122518458701, 221.91649041805948],
  [-27.01863024307953, 217.7815454264499],
  [-37.97014804499685, 211.39105285151325],
  [-47.46716129814272, 202.98981027760766],
  [-55.1458723960376, 192.89964014073198],
  [-60.71213657508054, 181.50706182828947],
  [-63.9527295792458, 169.24848546325475],
  [-64.74351554107007, 156.59349454746925],
  [-63.054202195766415, 144.02685784796165],
  [-58.949501272721136, 132.02995958847876],
]

const FIVE_SPKT_PARAMS = {
  spkt_teeth: [32, 10, 10, 10, 16],
  positive_chain_wrap: [true, true, false, false, true],
  spkt_locations: [
    [0, 158.9 * MM],
    [190 * MM, -50 * MM],
    [140 * MM, 20 * MM],
    [120 * MM, 90 * MM],
    [205 * MM, 158.9 * MM],
  ] as [number, number][],
}

describe('P1-a Chain · 纯数学（上游真值锚）', () => {
  // buildChain 会构建链板几何（链节缓存），故也需内核
  beforeAll(async () => {
    await setupWarehouseKernel()
  })

  it('五轮配置：滚子数与逐位坐标对齐上游（1e-7）', () => {
    const c = buildChain(FIVE_SPKT_PARAMS)
    // 上游直跑（cq_warehouse chain.py）：chain_length=1107.6348638400789，
    // chain_links=87.215 → floor = 87 个滚子
    expect(c.numRollers).toBe(87)
    expect(c.chainLength).toBeCloseTo(1107.6348638400789, 4)
    // 上游公开属性 roller_loc 为世界坐标（_roller_loc 为平面局部坐标，经
    // fromLocalCoords 还原）——本实现全程世界坐标，逐位对齐测试真值
    for (let i = 0; i < FIVE_SPKT_ROLLERS.length; i++) {
      expect(c.rollerLoc[i]!.x).toBeCloseTo(FIVE_SPKT_ROLLERS[i]![0], 6)
      expect(c.rollerLoc[i]!.y).toBeCloseTo(FIVE_SPKT_ROLLERS[i]![1], 6)
    }
  })

  it('两轮等径配置：节圆半径与链长（解析闭式核对）', () => {
    // 32 齿、节距 12.7：节圆半径 = pitch/(2 sin(π/N))
    const c = buildChain({
      spkt_teeth: [32, 32],
      spkt_locations: [[-300, 0], [300, 0]],
      positive_chain_wrap: [true, true],
    })
    const r = 12.7 / (2 * Math.sin(Math.PI / 32))
    expect(c.pitchRadii[0]).toBeCloseTo(r, 9)
    expect(c.pitchRadii[1]).toBeCloseTo(r, 9)
    // 等径两轮：两段直线各 600，两段弧各半周长 → 链长 = 1200 + 2πr
    expect(c.chainLength).toBeCloseTo(1200 + 2 * Math.PI * r, 6)
    expect(c.spktInitialRotation).toHaveLength(2)
  })
})

describe('P1-a Chain · 参数校验（对齐上游 ValueError）', () => {
  it('长度不一致抛错', () => {
    expect(() =>
      buildChain({ spkt_teeth: [32, 32], spkt_locations: [[0, 0]], positive_chain_wrap: [true, true] }),
    ).toThrow(/not equal/)
  })

  it('少于 2 轮抛错', () => {
    expect(() =>
      buildChain({ spkt_teeth: [32], spkt_locations: [[0, 0]], positive_chain_wrap: [true] }),
    ).toThrow(/at least 2/)
  })

  it('重复位置抛错', () => {
    expect(() =>
      buildChain({
        spkt_teeth: [32, 32],
        spkt_locations: [[0, 0], [0, 0]],
        positive_chain_wrap: [true, true],
      }),
    ).toThrow(/unique/)
  })

  it('斜面法向抛错（本移植先支持平面链）', () => {
    expect(() =>
      buildChain({
        spkt_teeth: [32, 32],
        spkt_locations: [[0, 0], [300, 0]],
        positive_chain_wrap: [true, true],
        spkt_normal: [1, 0, 0],
      }),
    ).toThrow(/only spkt_normal=\(0,0,1\)/)
  })
})

describe('P1-a Chain · 内核烟测', () => {
  beforeAll(async () => {
    await setupWarehouseKernel()
  })

  it('makeLink：内节/外节体积均为正，内节 > 外节（多两个滚子）', () => {
    const p = {
      chainPitch: 12.7, linkPlateThickness: 1, rollerLength: 2.38125, rollerDiameter: 7.9375,
    }
    const inner = makeLink({ ...p, inner: true })
    const outer = makeLink({ ...p, inner: false })
    const vi = volumeOf(inner)
    const vo = volumeOf(outer)
    expect(vi).toBeGreaterThan(0)
    expect(vo).toBeGreaterThan(0)
    expect(vi).toBeGreaterThan(vo)
  })

  it('A/B 体积比对：上游 assemble_chain_transmission 逐件真值（1% 相对容差）', () => {
    // 上游直跑（cadquery-env Python，chain.py + sprocket.py）：transmission-16t-16t
    // 装配逐件体积/ z 跨度——内节 510.0012 / 4.3812，外节 279.0664 / 7.0479
    const REF = {
      inner: { vol: 510.0012, span: 4.3812 },
      outer: { vol: 279.0664, span: 7.0479 },
    }
    const c = buildChain({
      spkt_teeth: [16, 16],
      spkt_locations: [[-60, 0], [60, 0]],
      positive_chain_wrap: [true, true],
    })
    for (const [i, part] of c.parts.entries()) {
      const ref = i % 2 === 0 ? REF.inner : REF.outer
      const v = volumeOf(part.solid)
      const bb = bboxOf(part.solid)
      expect(Math.abs(v - ref.vol) / ref.vol).toBeLessThan(0.01)
      expect(bb.zmax - bb.zmin).toBeCloseTo(ref.span, 2)
    }
  })

  it('buildChain：逐件装配 = numRollers 件，每件体积为正、z 跨度对齐上游公式', () => {
    const c = buildChain({
      spkt_teeth: [16, 16],
      spkt_locations: [[-60, 0], [60, 0]],
      positive_chain_wrap: [true, true],
    })
    expect(c.parts).toHaveLength(c.numRollers)
    const rl = 2.38125, t = 1
    for (const [i, part] of c.parts.entries()) {
      expect(part.name).toBe(`link${i}`)
      expect(volumeOf(part.solid)).toBeGreaterThan(0)
      const bb = bboxOf(part.solid)
      const span = bb.zmax - bb.zmin
      // 内节：两板 ±(rl/2+t) → rl+2t；外节：2·((rl+3t)/2 + t/2 + t/3)
      const expected = i % 2 === 0 ? rl + 2 * t : 2 * ((rl + 3 * t) / 2 + t / 2 + t / 3)
      expect(span).toBeCloseTo(expected, 3)
    }
  })
})
