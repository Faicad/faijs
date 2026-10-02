/**
 * new-gear-math — 新增 5 类的**纯数学**装配量快检（不建体、不初始化 wasm）
 *
 * 锁死 1:1 翻译里最容易抄错的两处：
 * - `hyperbolicGearGeometry` 的 `twist_angle` 覆盖 + `throat_r` 公式；
 * - `crossedPairAlignAngle` 的对齿/对齐角公式（含齿轮数为偶时 base=0 的分支）。
 *
 * 实体构造（sew/makeSolid）由 T2 的 export-ours + compare-all 覆盖，这里只验数学，
 * 让「公式抄错」在秒级暴露，而不是等到 10+ 个 wasm 实体逐个 build 才发现。
 */

import { describe, expect, it } from 'vitest'
import {
  crossedPairAlignAngle,
  hyperbolicPairExportParts,
  crossedPairExportParts,
} from './crossed_pair'
import { planetaryExportParts } from './planetary'
import {
  hyperbolicGearGeometry, gearGeometryForClass, spurGearGeometry,
} from './profile'

describe('HyperbolicGear 几何（twist 覆盖 + throat_r）', () => {
  it('helix=0 基底 + 显式 twist_angle 覆盖 + throat_r 公式', () => {
    const g = hyperbolicGearGeometry({
      module: 1.0, teeth_number: 20, width: 5.0, twist_angle: 30.0,
    })
    // 基类以 helix=0 构造 ⇒ twistAngle 初值 0、surfaceSplines=2
    expect(g.surfaceSplines).toBe(2)
    // 显式覆盖：twistAngle = radians(30)
    expect(Math.abs(g.twistAngle - (30.0 * Math.PI) / 180.0)).toBeLessThan(1e-12)
    // r0 = m·z/2 = 10
    expect(Math.abs(g.r0 - 10.0)).toBeLessThan(1e-12)
    // throat_r = sqrt(rpx² + rpy²)，rpx=(r0+ln)/2，rpy=ht/2，ln=cos(twist)·r0，ht=sin(twist)·r0
    const twist = g.twistAngle
    const ln = Math.cos(twist) * g.r0
    const ht = Math.sin(twist) * g.r0
    const rpx = (g.r0 + ln) / 2.0
    const rpy = ht / 2.0
    const throatR = Math.sqrt(rpx * rpx + rpy * rpy)
    expect(Math.abs(g.throatR - throatR)).toBeLessThan(1e-12)
    // 数值锚点（twist=30°、r0=10 ⇒ ≈ 9.660
    expect(Math.abs(g.throatR - 9.660)).toBeLessThan(1e-3)
  })

  it('gearGeometryForClass 分派到 HyperbolicGear', () => {
    const g = gearGeometryForClass('HyperbolicGear', {
      module: 1.0, teeth_number: 12, width: 4.0, twist_angle: 15.0,
    })
    expect('z' in g && g.z).toBe(12)
    expect('throatR' in g).toBe(true)
  })
})

describe('crossedPairAlignAngle 公式', () => {
  it('gear2.z 为偶时 base=180/z，align = 180/z + (g2.twist + g1.twist·ratio)/2', () => {
    // cq：`align_angle = 0.0 if gear2.z % 2 else 180.0/gear2.z` ⇒ 偶 z 取 180/z。
    const g1Twist = 0.30
    const g2Twist = 0.45
    const ratio = 20 / 20
    const alignDeg = (crossedPairAlignAngle(20, g1Twist, 20, g2Twist) * 180.0) / Math.PI
    const expectedDeg = 180 / 20 + ((g2Twist * 180 / Math.PI) + (g1Twist * 180 / Math.PI) * ratio) / 2.0
    expect(Math.abs(alignDeg - expectedDeg)).toBeLessThan(1e-9)
  })

  it('gear2.z 为奇时 base=0，align = (g2.twist + g1.twist·ratio)/2', () => {
    // gear2.z=15（奇）：base = 0
    const g1Twist = 0.10
    const g2Twist = 0.20
    const ratio = 30 / 15
    const align = crossedPairAlignAngle(30, g1Twist, 15, g2Twist)
    expect(Math.abs(align - (g2Twist + g1Twist * ratio) / 2.0)).toBeLessThan(1e-12)
  })
})

describe('导出条目函数（名字 + 缺件跳过）', () => {
  it('crossedPairExportParts：仅 gear1 时只出一零件', () => {
    const parts = crossedPairExportParts({ gear1Geometry: spurGearGeometry({ module: 1, teeth_number: 10, width: 2 }), gear2Geometry: spurGearGeometry({ module: 1, teeth_number: 10, width: 2 }), shaftAngleRad: 1, gear1: { __occtWasm: true } as never })
    expect(parts.map((p) => p.name)).toEqual(['gear1'])
  })

  it('hyperbolicPairExportParts：两件齐全', () => {
    const parts = hyperbolicPairExportParts({
      gear1Geometry: hyperbolicGearGeometry({ module: 1, teeth_number: 10, width: 2, twist_angle: 10 }),
      gear2Geometry: hyperbolicGearGeometry({ module: 1, teeth_number: 10, width: 2, twist_angle: 10 }),
      shaftAngleRad: 1, gear1: { __occtWasm: true } as never, gear2: { __occtWasm: true } as never,
    })
    expect(parts.map((p) => p.name)).toEqual(['gear1', 'gear2'])
  })

  it('planetaryExportParts：sun → planet_00.. → ring 顺序', () => {
    const parts = planetaryExportParts({
      sunGeometry: spurGearGeometry({ module: 1, teeth_number: 10, width: 2 }),
      planetGeometry: spurGearGeometry({ module: 1, teeth_number: 10, width: 2 }),
      ringGeometry: spurGearGeometry({ module: 1, teeth_number: 10, width: 2 }),
      orbitR: 5, nPlanets: 3,
      planets: [{ __occtWasm: true } as never, { __occtWasm: true } as never, { __occtWasm: true } as never],
      sun: { __occtWasm: true } as never, ring: { __occtWasm: true } as never,
    })
    expect(parts.map((p) => p.name)).toEqual(['sun', 'planet_00', 'planet_01', 'planet_02', 'ring'])
  })
})
