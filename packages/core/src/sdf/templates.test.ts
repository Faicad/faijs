import { describe, it, expect } from 'vitest'
import { SDF_TEMPLATES } from './templates'
import { parseParamDefs, defaultParamValues } from './types'
import { compileSdf, tryCompileBounds } from './sdf-core'

// P14b（§2.6.4）：补齐 schwarzP / diamond 两个 TPMS 模板，替代引入 brepjs lattice 模块
// （233 行 + Rust voxel-wasm 依赖）。每个模板都是可编译的纯 JS：结构上可 parse 出
// period/thickness 参数、可编译 sdf/bounds，并对零场点做符号冒烟（壳内/壳外）。
const TPMS_ADDED = ['schwarzP', 'diamond'] as const

describe('SDF TPMS 模板（P14b 补齐，§2.6.4）', () => {
  for (const id of TPMS_ADDED) {
    const tpl = SDF_TEMPLATES.find((t) => t.id === id)

    it(`${id} 已登记为 periodic 模板`, () => {
      expect(tpl).toBeDefined()
      expect(tpl?.category).toBe('periodic')
      expect(tpl?.code).toContain('function sdf')
      expect(tpl?.code).toContain('function bounds')
    })

    it(`${id} 参数可解析且默认值可注入`, () => {
      const defs = parseParamDefs(tpl!.code)
      const names = defs.map((d) => d.name)
      expect(names).toContain('period')
      expect(names).toContain('thickness')
      const vals = defaultParamValues(defs)
      expect(typeof vals.period).toBe('number')
      expect(typeof vals.thickness).toBe('number')
    })

    it(`${id} 可编译且 sdf 冒烟符号正确`, () => {
      const defs = parseParamDefs(tpl!.code)
      const vals = defaultParamValues(defs)
      const sdf = compileSdf(tpl!.code, vals)
      // 零场点（TPMS 曲面经过原点）：diamond 四项在原点全 0 → |d|=0 → 壳内(>0)；
      // schwarzP 在原点 cos0×3=3 → |p|>thickness → 壳外(<0)。
      const atOrigin = sdf(0, 0, 0)
      expect(Number.isFinite(atOrigin)).toBe(true)
      if (id === 'diamond') expect(atOrigin).toBeGreaterThan(0)
      else expect(atOrigin).toBeLessThan(0)
      // 盒角点应有限（远离壳，负值）
      const far = sdf(vals.period, vals.period, vals.period)
      expect(Number.isFinite(far)).toBe(true)
    })

    it(`${id} bounds() 可编译并返回对称盒`, () => {
      const defs = parseParamDefs(tpl!.code)
      const vals = defaultParamValues(defs)
      const box = tryCompileBounds(tpl!.code, vals)
      expect(box).not.toBeNull()
      expect(box!.min[0]).toBeCloseTo(-vals.period)
      expect(box!.max[0]).toBeCloseTo(vals.period)
    })
  }

  it('DEFAULT_SDF_TEMPLATE 仍为球体（模板数组头部不变）', () => {
    expect(SDF_TEMPLATES[0].id).toBe('sphere')
  })
})
