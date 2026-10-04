/**
 * api/appearance 单元测试：颜色归一化、外观合并、Shape 方法挂载。
 *
 * 设计文档 2026-10-05 v2 §4.1/§4.2：外观不是 op，是 Shape 实例方法
 * （`box1.setColor(...)` 走 `asm1.solve()` 同款成员调用语句形态）；
 * `appearance` 字段随 Shape 走双链路（编辑器只读字段，不依赖方法）。
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeColor,
  mergeAppearance,
  attachAppearanceMethods,
  type PbrAppearance,
} from './appearance'
import type { Shape } from '../mesh/types'

function fakeShape(appearance?: PbrAppearance): Shape {
  return {
    positions: new Float32Array(9),
    indices: new Uint32Array(3),
    appearance,
  }
}

describe('normalizeColor', () => {
  it('hex #rgb → sRGB 0–1（无 alpha）', () => {
    expect(normalizeColor('#f00')).toEqual({ rgb: [1, 0, 0] })
    expect(normalizeColor('#0f0')).toEqual({ rgb: [0, 1, 0] })
  })

  it('hex #rrggbb → sRGB 0–1', () => {
    expect(normalizeColor('#e53935')).toEqual({ rgb: [0xe5 / 255, 0x39 / 255, 0x35 / 255] })
    expect(normalizeColor('#000000')).toEqual({ rgb: [0, 0, 0] })
    expect(normalizeColor('#ffffff')).toEqual({ rgb: [1, 1, 1] })
  })

  it('hex #rrggbbaa → rgb + alpha（alpha 等价 opacity）', () => {
    expect(normalizeColor('#ff000080')).toEqual({ rgb: [1, 0, 0], alpha: 0x80 / 255 })
  })

  it('数组 [r,g,b] / [r,g,b,a]（sRGB 0–1）', () => {
    expect(normalizeColor([0.2, 0.4, 0.6])).toEqual({ rgb: [0.2, 0.4, 0.6] })
    expect(normalizeColor([0.2, 0.4, 0.6, 0.5])).toEqual({ rgb: [0.2, 0.4, 0.6], alpha: 0.5 })
  })

  it('越界/非法输入抛错（内部 API 参数严格）', () => {
    expect(() => normalizeColor([1.1, 0, 0])).toThrow(/0\.\.1/)
    expect(() => normalizeColor([0, -0.1, 0])).toThrow(/0\.\.1/)
    expect(() => normalizeColor('#12345')).toThrow(/invalid hex/)
    expect(() => normalizeColor('#12zzzz')).toThrow(/non-hex/)
    expect(() => normalizeColor('red')).toThrow(/unsupported color/)
  })
})

describe('mergeAppearance', () => {
  it('spec 中 undefined 字段不覆盖旧值', () => {
    const cur: PbrAppearance = { color: [1, 0, 0], opacity: 0.5, metalness: 0.9 }
    const merged = mergeAppearance(cur, { metalness: 0.2, roughness: 0.4, color: undefined })
    expect(merged).toEqual({ color: [1, 0, 0], opacity: 0.5, metalness: 0.2, roughness: 0.4 })
  })

  it('cur 为 undefined 时只取 spec', () => {
    expect(mergeAppearance(undefined, { roughness: 0.3 })).toEqual({ roughness: 0.3 })
  })
})

describe('attachAppearanceMethods（Shape 方法）', () => {
  it('挂载后方法可用：setColor hex → color 归一、无 alpha 不动 opacity', () => {
    const s = attachAppearanceMethods(fakeShape())
    const ret = s.setColor('#e53935')
    expect(ret).toBe(s) // 返回 this 可链式
    expect(s.appearance).toEqual({ color: [0xe5 / 255, 0x39 / 255, 0x35 / 255] })
  })

  it('setColor #rrggbbaa：alpha 归一为 opacity（权威字段）', () => {
    const s = attachAppearanceMethods(fakeShape())
    s.setColor('#ff000080')
    expect(s.appearance).toEqual({ color: [1, 0, 0], opacity: 0x80 / 255 })
  })

  it('setColor 数组 [r,g,b,a]：alpha 归入 opacity；后续无 alpha 的 setColor 不动 opacity', () => {
    const s = attachAppearanceMethods(fakeShape())
    s.setColor([1, 0, 0, 0.25])
    expect(s.appearance).toEqual({ color: [1, 0, 0], opacity: 0.25 })
    s.setColor('#00ff00') // 无 alpha → opacity 保留
    expect(s.appearance).toEqual({ color: [0, 1, 0], opacity: 0.25 })
  })

  it('setMaterial 合并材质参数（不含 color/opacity）', () => {
    const s = attachAppearanceMethods(fakeShape())
    s.setColor('#e53935').setMaterial({ metalness: 0.8, roughness: 0.2 })
    expect(s.appearance).toEqual({
      color: [0xe5 / 255, 0x39 / 255, 0x35 / 255],
      metalness: 0.8,
      roughness: 0.2,
    })
  })

  it('setOpacity 校验 0–1；链式返回 this', () => {
    const s = attachAppearanceMethods(fakeShape())
    expect(s.setOpacity(0.5).setMaterial({ unlit: true })).toBe(s)
    expect(s.appearance).toEqual({ opacity: 0.5, unlit: true })
    expect(() => s.setOpacity(1.5)).toThrow(/opacity/)
    expect(() => s.setOpacity(-0.1)).toThrow(/opacity/)
  })

  it('getAppearance：初始 undefined，设置后返回当前外观（只读视图）', () => {
    const s = attachAppearanceMethods(fakeShape())
    expect(s.getAppearance()).toBeUndefined()
    s.setColor('#ffffff')
    expect(s.getAppearance()).toEqual({ color: [1, 1, 1] })
  })

  it('幂等：重复挂载不覆盖已挂方法', () => {
    const s = attachAppearanceMethods(fakeShape())
    const again = attachAppearanceMethods(s)
    expect(again).toBe(s)
    expect(again.setColor('#000000')).toBe(s)
  })

  it('已有 appearance 的 Shape（继承/导入）挂载后方法在其上合并', () => {
    const s = attachAppearanceMethods(fakeShape({ metalness: 0.9 }))
    s.setColor('#ff0000')
    expect(s.appearance).toEqual({ metalness: 0.9, color: [1, 0, 0] })
  })
})
