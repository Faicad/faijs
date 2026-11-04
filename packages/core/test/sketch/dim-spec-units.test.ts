/**
 * sketch dim-spec 与单位常量直呼单元测试——历史 L1 缺口补账：
 * `shapesDimSpec` / `constraintsDimSpec` / `contoursDimSpec` / `LENGTH`。
 *
 * dim-spec 是 `cad.sketch` 参数表的维度描述（doc-sync 类型等价 / 参数维度检查的
 * 真源）：length 字段 → LENGTH、angle 字段 → 角度、纯数字 → plain。
 */
import { describe, expect, it } from 'vitest'
import { shapesDimSpec, constraintsDimSpec, contoursDimSpec } from '../../src/sketch/dim-spec'
import { LENGTH, AREA, VOLUME } from '../../src/units'
import type { DimSpec } from '../../src/sketch/dim-spec'

/** 在 spec 树里按键下行：object → fields[key]；tagged → cases[key]；array → 透传键给 item。 */
function leafAt(spec: DimSpec, ...keys: string[]): DimSpec {
  let cur: DimSpec = spec
  for (const key of keys) {
    if (cur.kind === 'object') {
      cur = (cur as { fields: Record<string, DimSpec> }).fields[key]!
    } else if (cur.kind === 'tagged') {
      cur = (cur as { cases: Record<string, DimSpec> }).cases[key] ?? cur
    } else if (cur.kind === 'array') {
      // array 本身不消费键：键透传给 item 继续匹配（item 可能还是容器）
      const item = (cur as { item: DimSpec }).item
      cur = leafAt(item, key)
    } else {
      throw new Error(`cannot descend into ${cur.kind} via "${key}"`)
    }
  }
  return cur
}

describe('dim-spec 直呼（sketch 参数维度真源）', () => {
  it('shapesDimSpec：rect 的 w/d 是 length、angle 是角度；line 的 from 是 [length,length]', () => {
    const spec = shapesDimSpec()
    const w = leafAt(spec, 'rect', 'w')
    expect(w).toEqual({ kind: 'dim', dim: 'length' })
    const angle = leafAt(spec, 'rect', 'angle')
    expect(angle).toEqual({ kind: 'dim', dim: 'angle' })
    const from = leafAt(spec, 'line', 'from')
    expect(from).toEqual({ kind: 'array', item: { kind: 'dim', dim: 'length' } })
  })

  it('constraintsDimSpec：length 约束的 value 是 length 维度', () => {
    const spec = constraintsDimSpec()
    const value = leafAt(spec, 'length', 'value')
    expect(value).toEqual({ kind: 'dim', dim: 'length' })
  })

  it('contoursDimSpec：contours[].segments[] 按 kind 分派', () => {
    const spec = contoursDimSpec()
    expect(spec.kind).toBe('object')
    const segments = leafAt(spec, 'contours', 'segments')
    expect(segments.kind).toBe('array')
  })
})

describe('units LENGTH 直呼', () => {
  it('LENGTH = 长度^1（与 AREA/VOLUME 的幂次构成 1/2/3 阶）', () => {
    expect(LENGTH).toEqual({ length: 1 })
    expect(AREA).toEqual({ length: 2 })
    expect(VOLUME).toEqual({ length: 3 })
  })
})
